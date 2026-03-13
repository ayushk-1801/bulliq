import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "~/server/db";
import {
  competition,
  competitionStock,
  niftyCompany,
  niftyFinancialMetric,
} from "~/server/db/schema";

const HISTORICAL_CHART_START_YEAR = 2022;
const HISTORICAL_RANGE_START_DATE = "2016-01-01";
const labelCollator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

type RouteContext = {
  params: Promise<{
    competitionId: string;
  }>;
};

function toDateOnly(value: string | Date): string {
  if (typeof value === "string") {
    return value;
  }

  return value.toISOString().slice(0, 10);
}

function getFiscalYearEnd(startDate: string): number {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const previousDay = new Date(start.getTime() - 24 * 60 * 60 * 1000);
  return previousDay.getUTCFullYear();
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
      startDate: competition.startDate,
      durationMonths: competition.durationMonths,
    })
    .from(competition)
    .where(eq(competition.id, parsedCompetitionId))
    .limit(1);

  if (!competitionRow) {
    return NextResponse.json({ message: "Competition not found." }, { status: 404 });
  }

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

  if (stockRows.length === 0) {
    const competitionStartDate = toDateOnly(competitionRow.startDate);
    return NextResponse.json({
      range: {
        startDate: HISTORICAL_RANGE_START_DATE,
        endDateExclusive: competitionStartDate,
        fiscalYearStart: HISTORICAL_CHART_START_YEAR,
        fiscalYearEnd: getFiscalYearEnd(competitionStartDate),
      },
      companies: [],
    });
  }

  const competitionStartDate = toDateOnly(competitionRow.startDate);
  const rangeEndDateExclusive = competitionStartDate;
  const fiscalYearEnd = getFiscalYearEnd(competitionStartDate);
  const symbols = stockRows.map((row) => row.symbol);

  if (fiscalYearEnd < HISTORICAL_CHART_START_YEAR) {
    return NextResponse.json({
      range: {
        startDate: HISTORICAL_RANGE_START_DATE,
        endDateExclusive: rangeEndDateExclusive,
        fiscalYearStart: HISTORICAL_CHART_START_YEAR,
        fiscalYearEnd,
      },
      companies: stockRows.map((stock) => ({
        symbol: stock.redactedSymbol ?? stock.symbol,
        redactedDate: competitionStartDate,
        companyName: stock.redactedCompanyName ?? stock.companyName,
        rows: [],
      })).sort((a, b) => {
        const bySymbol = labelCollator.compare(a.symbol, b.symbol);
        if (bySymbol !== 0) return bySymbol;
        return labelCollator.compare(a.companyName ?? "", b.companyName ?? "");
      }),
    });
  }

  const rows = await db
    .select({
      symbol: niftyFinancialMetric.symbol,
      statementType: niftyFinancialMetric.statementType,
      fiscalYear: niftyFinancialMetric.fiscalYear,
      metric: niftyFinancialMetric.metric,
      numericValue: niftyFinancialMetric.numericValue,
      rawValue: niftyFinancialMetric.rawValue,
    })
    .from(niftyFinancialMetric)
    .where(
      and(
        inArray(niftyFinancialMetric.symbol, symbols),
        gte(niftyFinancialMetric.fiscalYear, HISTORICAL_CHART_START_YEAR),
        lte(niftyFinancialMetric.fiscalYear, fiscalYearEnd),
      ),
    )
    .orderBy(
      asc(niftyFinancialMetric.symbol),
      asc(niftyFinancialMetric.statementType),
      asc(niftyFinancialMetric.metric),
      desc(niftyFinancialMetric.fiscalYear),
    );

  const rowsBySymbol = new Map<string, typeof rows>();

  for (const row of rows) {
    const current = rowsBySymbol.get(row.symbol) ?? [];
    current.push(row);
    rowsBySymbol.set(row.symbol, current);
  }

  const companies = stockRows.map((stock) => ({
    symbol: stock.redactedSymbol ?? stock.symbol,
    redactedDate: competitionStartDate,
    companyName: stock.redactedCompanyName ?? stock.companyName,
    rows: (rowsBySymbol.get(stock.symbol) ?? []).map((row) => ({
      statementType: row.statementType,
      fiscalYear: row.fiscalYear,
      metric: row.metric,
      numericValue: row.numericValue,
      rawValue: row.rawValue,
    })),
  })).sort((a, b) => {
    const bySymbol = labelCollator.compare(a.symbol, b.symbol);
    if (bySymbol !== 0) return bySymbol;
    return labelCollator.compare(a.companyName ?? "", b.companyName ?? "");
  });

  return NextResponse.json({
    range: {
      startDate: HISTORICAL_RANGE_START_DATE,
      endDateExclusive: rangeEndDateExclusive,
      fiscalYearStart: HISTORICAL_CHART_START_YEAR,
      fiscalYearEnd,
    },
    companies,
  });
}
