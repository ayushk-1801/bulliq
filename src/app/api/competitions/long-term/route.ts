import { eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "~/server/db";
import { competition } from "~/server/db/schema";

type DurationOption = {
  durationMonths: number;
  title: string;
  totalChallenges: number;
};

const allowedDurations = [6, 12, 18, 24] as const;

function toDurationTitle(months: number): string {
  return `${months} Month Challenges`;
}

export async function GET() {
  const counts = await db
    .select({
      durationMonths: competition.durationMonths,
      totalChallenges: sql<number>`count(*)::int`,
    })
    .from(competition)
    .where(eq(competition.status, "completed"))
    .groupBy(competition.durationMonths);

  const countMap = new Map<number, number>(
    counts.map((row) => [row.durationMonths, row.totalChallenges]),
  );

  const options: DurationOption[] = allowedDurations.map((durationMonths) => ({
    durationMonths,
    title: toDurationTitle(durationMonths),
    totalChallenges: countMap.get(durationMonths) ?? 0,
  }));

  return NextResponse.json({
    mode: "long-term",
    options,
  });
}
