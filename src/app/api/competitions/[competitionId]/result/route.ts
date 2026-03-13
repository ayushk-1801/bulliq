import { and, asc, desc, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getSession } from "~/server/better-auth/server";
import { db } from "~/server/db";
import { competition, competitionResult, leaderboard } from "~/server/db/schema";

type RouteContext = {
  params: Promise<{
    competitionId: string;
  }>;
};

type ResultPayload = {
  finalPortfolioValue: number;
  profitLoss: number;
  returnPct: number;
};

const BASE_RATING = 1000;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function toPayload(body: unknown): ResultPayload | null {
  if (!body || typeof body !== "object") {
    return null;
  }

  const record = body as Record<string, unknown>;
  const finalPortfolioValue = Number(record.finalPortfolioValue);
  const profitLoss = Number(record.profitLoss);
  const returnPct = Number(record.returnPct);

  if (
    !Number.isFinite(finalPortfolioValue) ||
    !Number.isFinite(profitLoss) ||
    !Number.isFinite(returnPct)
  ) {
    return null;
  }

  return {
    finalPortfolioValue,
    profitLoss,
    returnPct,
  };
}

export async function POST(request: Request, context: RouteContext) {
  const session = await getSession();

  if (!session?.user?.id) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const { competitionId } = await context.params;
  const parsedCompetitionId = Number.parseInt(competitionId, 10);

  if (!Number.isInteger(parsedCompetitionId) || parsedCompetitionId <= 0) {
    return NextResponse.json({ message: "Invalid competition id." }, { status: 400 });
  }

  const payload = toPayload(await request.json().catch(() => null));

  if (!payload) {
    return NextResponse.json(
      { message: "Expected numeric finalPortfolioValue, profitLoss and returnPct." },
      { status: 400 },
    );
  }

  const [competitionRow] = await db
    .select({ id: competition.id })
    .from(competition)
    .where(eq(competition.id, parsedCompetitionId))
    .limit(1);

  if (!competitionRow) {
    return NextResponse.json({ message: "Competition not found." }, { status: 404 });
  }

  const userId = session.user.id;

  const result = await db.transaction(async (tx) => {
    const now = new Date();

    await tx
      .insert(leaderboard)
      .values({ userId })
      .onConflictDoNothing({ target: leaderboard.userId });

    const [leaderboardRow] = await tx
      .select({ rating: leaderboard.rating })
      .from(leaderboard)
      .where(eq(leaderboard.userId, userId))
      .limit(1);

    const currentRating = leaderboardRow?.rating ?? BASE_RATING;

    await tx
      .insert(competitionResult)
      .values({
        competitionId: parsedCompetitionId,
        userId,
        finalPortfolioValue: payload.finalPortfolioValue,
        profitLoss: payload.profitLoss,
        returnPct: payload.returnPct,
        ratingBefore: currentRating,
        ratingDelta: 0,
        ratingAfter: currentRating,
        completedAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [competitionResult.competitionId, competitionResult.userId],
        set: {
          finalPortfolioValue: payload.finalPortfolioValue,
          profitLoss: payload.profitLoss,
          returnPct: payload.returnPct,
          ratingBefore: currentRating,
          updatedAt: now,
        },
      });

    const standingsRows = await tx
      .select({
        userId: competitionResult.userId,
        returnPct: competitionResult.returnPct,
        finalPortfolioValue: competitionResult.finalPortfolioValue,
        completedAt: competitionResult.completedAt,
        currentRating: sql<number>`coalesce(${leaderboard.rating}, ${BASE_RATING})`,
      })
      .from(competitionResult)
      .leftJoin(leaderboard, eq(competitionResult.userId, leaderboard.userId))
      .where(eq(competitionResult.competitionId, parsedCompetitionId))
      .orderBy(
        desc(competitionResult.returnPct),
        desc(competitionResult.finalPortfolioValue),
        asc(competitionResult.completedAt),
      );

    const participantsCount = standingsRows.length;
    const rank = standingsRows.findIndex((row) => row.userId === userId) + 1;

    const opponentRatings = standingsRows
      .filter((row) => row.userId !== userId)
      .map((row) => row.currentRating);

    const averageOpponentRating =
      opponentRatings.length === 0
        ? currentRating
        : opponentRatings.reduce((sum, rating) => sum + rating, 0) / opponentRatings.length;

    const expectedScore = 1 / (1 + 10 ** ((averageOpponentRating - currentRating) / 400));
    const actualScore =
      participantsCount <= 1
        ? 1
        : (participantsCount - rank) / (participantsCount - 1);

    const kFactor = clamp(28 + participantsCount * 2, 24, 48);
    const returnBonus = clamp(Math.round(payload.returnPct / 2), -12, 12);
    const ratingDelta = Math.round(kFactor * (actualScore - expectedScore) + returnBonus);
    const ratingAfter = Math.max(100, currentRating + ratingDelta);

    // Keep rank/participants in sync for all entries in this competition.
    for (let i = 0; i < standingsRows.length; i += 1) {
      const row = standingsRows[i];
      if (!row) continue;

      await tx
        .update(competitionResult)
        .set({
          rank: i + 1,
          participantsCount,
          updatedAt: now,
        })
        .where(
          and(
            eq(competitionResult.competitionId, parsedCompetitionId),
            eq(competitionResult.userId, row.userId),
          ),
        );
    }

    await tx
      .update(competitionResult)
      .set({
        rank,
        participantsCount,
        ratingBefore: currentRating,
        ratingDelta,
        ratingAfter,
        updatedAt: now,
      })
      .where(
        and(
          eq(competitionResult.competitionId, parsedCompetitionId),
          eq(competitionResult.userId, userId),
        ),
      );

    const [statsRow] = await tx
      .select({
        competitionsPlayed: sql<number>`count(*)::int`,
        wins: sql<number>`count(*) FILTER (WHERE ${competitionResult.rank} = 1)::int`,
        averageReturnPct: sql<number>`coalesce(avg(${competitionResult.returnPct}), 0)::float`,
        bestReturnPct: sql<number>`max(${competitionResult.returnPct})::float`,
      })
      .from(competitionResult)
      .where(eq(competitionResult.userId, userId));

    await tx
      .update(leaderboard)
      .set({
        rating: ratingAfter,
        competitionsPlayed: statsRow?.competitionsPlayed ?? 1,
        wins: statsRow?.wins ?? 0,
        averageReturnPct: statsRow?.averageReturnPct ?? payload.returnPct,
        bestReturnPct: statsRow?.bestReturnPct ?? payload.returnPct,
        lastRatingDelta: ratingDelta,
        lastPlayedAt: now,
        updatedAt: now,
      })
      .where(eq(leaderboard.userId, userId));

    return {
      rank,
      participantsCount,
      ratingBefore: currentRating,
      ratingDelta,
      ratingAfter,
    };
  });

  return NextResponse.json({
    competitionId: parsedCompetitionId,
    ...result,
  });
}
