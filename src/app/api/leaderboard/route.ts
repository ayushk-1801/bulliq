import { asc, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "~/server/db";
import { competitionResult, leaderboard, user } from "~/server/db/schema";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const rawLimit = Number.parseInt(searchParams.get("limit") ?? "20", 10);
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(100, rawLimit)) : 20;

  const rows = await db
    .select({
      userId: leaderboard.userId,
      name: user.name,
      image: user.image,
      rating: leaderboard.rating,
      competitionsPlayed: leaderboard.competitionsPlayed,
      wins: leaderboard.wins,
      averageReturnPct: leaderboard.averageReturnPct,
      bestReturnPct: leaderboard.bestReturnPct,
      lastRatingDelta: leaderboard.lastRatingDelta,
      lastPlayedAt: leaderboard.lastPlayedAt,
    })
    .from(leaderboard)
    .innerJoin(user, eq(leaderboard.userId, user.id))
    .orderBy(
      desc(leaderboard.rating),
      desc(leaderboard.wins),
      desc(leaderboard.averageReturnPct),
      asc(user.name),
    )
    .limit(limit);

  const entries = rows.map((row, index) => ({
    rank: index + 1,
    userId: row.userId,
    name: row.name,
    image: row.image,
    rating: row.rating,
    competitionsPlayed: row.competitionsPlayed,
    wins: row.wins,
    averageReturnPct: row.averageReturnPct,
    bestReturnPct: row.bestReturnPct,
    lastRatingDelta: row.lastRatingDelta,
    lastPlayedAt: row.lastPlayedAt,
  }));

  const competitionIdRaw = searchParams.get("competitionId");
  const competitionId = competitionIdRaw ? Number.parseInt(competitionIdRaw, 10) : null;

  if (!competitionId || !Number.isInteger(competitionId) || competitionId <= 0) {
    return NextResponse.json({ entries });
  }

  const competitionRows = await db
    .select({
      userId: competitionResult.userId,
      name: user.name,
      returnPct: competitionResult.returnPct,
      finalPortfolioValue: competitionResult.finalPortfolioValue,
      rank: competitionResult.rank,
      participantsCount: competitionResult.participantsCount,
      ratingDelta: competitionResult.ratingDelta,
      ratingAfter: competitionResult.ratingAfter,
      completedAt: competitionResult.completedAt,
    })
    .from(competitionResult)
    .innerJoin(user, eq(competitionResult.userId, user.id))
    .where(eq(competitionResult.competitionId, competitionId))
    .orderBy(asc(competitionResult.rank), asc(competitionResult.completedAt));

  return NextResponse.json({
    entries,
    competitionStandings: competitionRows,
  });
}
