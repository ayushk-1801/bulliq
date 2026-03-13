import { and, asc, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "~/server/db";
import { competition, competitionStock, niftyCompany } from "~/server/db/schema";

type RouteContext = {
  params: Promise<{
    duration: string;
  }>;
};

type ChallengeResponse = {
  id: number;
  name: string;
  durationMonths: number;
  startDate: string;
  endDate: string;
  startingCapital: number;
  status: string;
  stocks: Array<{
    symbol: string;
    redactedDate: string | null;
    companyName: string | null;
  }>;
};

const labelCollator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

const allowedDurations = new Set([6, 12, 18, 24]);

function toDateOnly(value: string | Date): string {
  if (typeof value === "string") {
    return value;
  }

  return value.toISOString().slice(0, 10);
}

export async function GET(_request: Request, context: RouteContext) {
  const { duration } = await context.params;
  const parsedDuration = Number.parseInt(duration, 10);

  if (!allowedDurations.has(parsedDuration)) {
    return NextResponse.json(
      { message: "Duration must be one of 6, 12, 18, or 24." },
      { status: 400 },
    );
  }

  const competitions = await db
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
    .where(
      and(
        eq(competition.durationMonths, parsedDuration),
        eq(competition.status, "completed"),
      ),
    )
    .orderBy(asc(competition.id));

  if (competitions.length === 0) {
    return NextResponse.json({
      durationMonths: parsedDuration,
      totalChallenges: 0,
      challenges: [] as ChallengeResponse[],
    });
  }

  const competitionIds = competitions.map((row) => row.id);

  const stockRows = await db
    .select({
      competitionId: competitionStock.competitionId,
      symbol: competitionStock.symbol,
      redactedSymbol: competitionStock.redactedSymbol,
      redactedCompanyName: competitionStock.redactedCompanyName,
      redactedDate: competitionStock.redactedDate,
      companyName: niftyCompany.companyName,
    })
    .from(competitionStock)
    .leftJoin(niftyCompany, eq(competitionStock.symbol, niftyCompany.symbol))
    .where(inArray(competitionStock.competitionId, competitionIds))
    .orderBy(competitionStock.competitionId, competitionStock.symbol);

  const stocksByCompetition = new Map<
    number,
    Array<{
      symbol: string;
      redactedDate: string | null;
      companyName: string | null;
    }>
  >();

  for (const row of stockRows) {
    const current = stocksByCompetition.get(row.competitionId) ?? [];
    const competitionForStock = competitions.find((competitionRow) => competitionRow.id === row.competitionId);
    current.push({
      symbol: row.redactedSymbol ?? row.symbol,
      redactedDate: competitionForStock ? toDateOnly(competitionForStock.startDate) : null,
      companyName: row.redactedCompanyName ?? row.companyName,
    });
    stocksByCompetition.set(row.competitionId, current);
  }

  const challenges: ChallengeResponse[] = competitions.map((row) => ({
    id: row.id,
    name: row.name,
    durationMonths: row.durationMonths,
    startDate: toDateOnly(row.startDate),
    endDate: toDateOnly(row.endDate),
    startingCapital: row.startingCapital,
    status: row.status,
    stocks: (stocksByCompetition.get(row.id) ?? []).sort((a, b) => {
      const bySymbol = labelCollator.compare(a.symbol, b.symbol);
      if (bySymbol !== 0) return bySymbol;
      return labelCollator.compare(a.companyName ?? "", b.companyName ?? "");
    }),
  }));

  return NextResponse.json({
    durationMonths: parsedDuration,
    totalChallenges: challenges.length,
    challenges,
  });
}
