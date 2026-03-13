import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "~/server/db";
import {
  competition,
  competitionNews,
  competitionStock,
  niftyCompany,
  niftyStockDaily,
} from "~/server/db/schema";

const HISTORICAL_CHART_START_DATE = "2022-01-01";

type RouteContext = {
  params: Promise<{
    competitionId: string;
  }>;
};

type StockSeriesPoint = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
};

type StockSeries = {
  symbol: string;
  redactedDate: string | null;
  companyName: string | null;
  points: StockSeriesPoint[];
};

type NewsCategory = "finance" | "global" | "company" | "industry";

type NewsArticle = {
  title: string;
  link: string;
  publishedAt: string | null;
  source: string | null;
  rank: number;
};

type StockNews = {
  symbol: string;
  companyName: string | null;
  categories: Record<NewsCategory, NewsArticle[]>;
};

const labelCollator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

function toDateOnly(value: string | Date): string {
  if (typeof value === "string") {
    return value;
  }

  return value.toISOString().slice(0, 10);
}

export async function GET(_request: Request, context: RouteContext) {
  const { competitionId } = await context.params;
  const parsedCompetitionId = Number.parseInt(competitionId, 10);

  if (!Number.isInteger(parsedCompetitionId) || parsedCompetitionId <= 0) {
    return NextResponse.json({ message: "Invalid competition id." }, { status: 400 });
  }

  const [competitionRow] = await db
    .select({
      id: competition.id,
      name: competition.name,
      durationMonths: competition.durationMonths,
      startDate: competition.startDate,
      endDate: competition.endDate,
      startingCapital: competition.startingCapital,
      status: competition.status,
    })
    .from(competition)
    .where(eq(competition.id, parsedCompetitionId))
    .limit(1);

  if (!competitionRow) {
    return NextResponse.json({ message: "Competition not found." }, { status: 404 });
  }

  const competitionStartDate = toDateOnly(competitionRow.startDate);
  const competitionEndDate = toDateOnly(competitionRow.endDate);

  const stockRows = await db
    .select({
      symbol: competitionStock.symbol,
      redactedSymbol: competitionStock.redactedSymbol,
      redactedCompanyName: competitionStock.redactedCompanyName,
      redactedDate: competitionStock.redactedDate,
      companyName: niftyCompany.companyName,
    })
    .from(competitionStock)
    .leftJoin(niftyCompany, eq(competitionStock.symbol, niftyCompany.symbol))
    .where(eq(competitionStock.competitionId, parsedCompetitionId))
    .orderBy(asc(competitionStock.symbol));

  const newsRows = await db
    .select({
      symbol: competitionNews.symbol,
      category: competitionNews.category,
      rank: competitionNews.rank,
      title: competitionNews.title,
      link: competitionNews.link,
      publishedAt: competitionNews.publishedAt,
      source: competitionNews.source,
    })
    .from(competitionNews)
    .where(eq(competitionNews.competitionId, parsedCompetitionId))
    .orderBy(
      asc(competitionNews.symbol),
      asc(competitionNews.category),
      asc(competitionNews.rank),
    );

  const aliasBySymbol = new Map(
    stockRows.map((row) => [
      row.symbol,
      {
        symbol: row.redactedSymbol ?? row.symbol,
        companyName: row.redactedCompanyName ?? row.companyName,
      },
    ]),
  );

  const emptyCategories = (): Record<NewsCategory, NewsArticle[]> => ({
    finance: [],
    global: [],
    company: [],
    industry: [],
  });

  const newsBySymbol = new Map<string, StockNews>();
  for (const row of newsRows) {
    const alias = aliasBySymbol.get(row.symbol);
    const displayedSymbol = alias?.symbol ?? row.symbol;

    if (!newsBySymbol.has(displayedSymbol)) {
      newsBySymbol.set(displayedSymbol, {
        symbol: displayedSymbol,
        companyName: alias?.companyName ?? null,
        categories: emptyCategories(),
      });
    }

    const entry = newsBySymbol.get(displayedSymbol);
    const category = row.category as NewsCategory;

    if (!entry || !(category in entry.categories)) {
      continue;
    }

    entry.categories[category].push({
      title: row.title,
      link: row.link,
      publishedAt: row.publishedAt ? toDateOnly(row.publishedAt) : null,
      source: row.source,
      rank: row.rank,
    });
  }

  const news = Array.from(newsBySymbol.values()).sort((a, b) =>
    labelCollator.compare(a.symbol, b.symbol),
  );

  const symbols = stockRows.map((row) => row.symbol);

  if (symbols.length === 0) {
    return NextResponse.json({
      competition: {
        ...competitionRow,
        startDate: competitionStartDate,
        endDate: competitionEndDate,
      },
      stocks: [] as StockSeries[],
      news: [] as StockNews[],
    });
  }

  const dailyRows = await db
    .select({
      symbol: niftyStockDaily.symbol,
      tradeDate: niftyStockDaily.tradeDate,
      open: niftyStockDaily.open,
      high: niftyStockDaily.high,
      low: niftyStockDaily.low,
      close: niftyStockDaily.close,
      volume: niftyStockDaily.volume,
    })
    .from(niftyStockDaily)
    .where(
      and(
        inArray(niftyStockDaily.symbol, symbols),
        gte(niftyStockDaily.tradeDate, HISTORICAL_CHART_START_DATE),
        lte(niftyStockDaily.tradeDate, competitionEndDate),
      ),
    )
    .orderBy(asc(niftyStockDaily.symbol), asc(niftyStockDaily.tradeDate));

  const pointsBySymbol = new Map<string, StockSeriesPoint[]>();

  for (const row of dailyRows) {
    if (
      row.open === null ||
      row.high === null ||
      row.low === null ||
      row.close === null
    ) {
      continue;
    }

    const points = pointsBySymbol.get(row.symbol) ?? [];
    points.push({
      time: toDateOnly(row.tradeDate),
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      volume: row.volume,
    });
    pointsBySymbol.set(row.symbol, points);
  }

  const stocks: StockSeries[] = stockRows
    .map((stock) => ({
      symbol: stock.redactedSymbol ?? stock.symbol,
      redactedDate: competitionStartDate,
      companyName: stock.redactedCompanyName ?? stock.companyName,
      points: pointsBySymbol.get(stock.symbol) ?? [],
    }))
    .filter((stock) => stock.points.length > 0)
    .sort((a, b) => {
      const bySymbol = labelCollator.compare(a.symbol, b.symbol);
      if (bySymbol !== 0) return bySymbol;
      return labelCollator.compare(a.companyName ?? "", b.companyName ?? "");
    });

  return NextResponse.json({
    competition: {
      ...competitionRow,
      startDate: competitionStartDate,
      endDate: competitionEndDate,
    },
    stocks,
    news,
  });
}
