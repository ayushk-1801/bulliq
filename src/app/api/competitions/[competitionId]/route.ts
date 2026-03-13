import { and, asc, eq, gte, inArray, lt } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "~/server/db";
import {
  competition,
  competitionStock,
  niftyCompany,
  niftyStockDaily,
} from "~/server/db/schema";

const HISTORICAL_CHART_START_DATE = "2022-01-01";
const REDACTED_COMPETITION_START_DATE = "2020-01-01";

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

const labelCollator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

function toDateOnly(value: string | Date): string {
  if (typeof value === "string") {
    return value;
  }

  return value.toISOString().slice(0, 10);
}

function addMonthsUtc(dateOnly: string, months: number): string {
  const [year, month, day] = dateOnly.split("-").map(Number);
  if (!year || !month || !day) {
    return dateOnly;
  }

  const result = new Date(Date.UTC(year, month - 1 + months, day));
  return result.toISOString().slice(0, 10);
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
  const redactedStartDate = REDACTED_COMPETITION_START_DATE;
  const redactedEndDate = addMonthsUtc(
    REDACTED_COMPETITION_START_DATE,
    competitionRow.durationMonths,
  );

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

  const symbols = stockRows.map((row) => row.symbol);

  if (symbols.length === 0) {
    return NextResponse.json({
      competition: {
        ...competitionRow,
        startDate: redactedStartDate,
        endDate: redactedEndDate,
      },
      stocks: [] as StockSeries[],
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
        lt(niftyStockDaily.tradeDate, competitionStartDate),
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
      redactedDate: redactedStartDate,
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
      startDate: redactedStartDate,
      endDate: redactedEndDate,
    },
    stocks,
  });
}
