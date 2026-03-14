import { and, asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "~/server/db";
import { volatileDaySummary, volatileMinuteCandle } from "~/server/db/schema";

type RouteContext = {
  params: Promise<{
    symbol: string;
    tradeDate: string;
  }>;
};

type MinuteCandle = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  minuteChangePct: number | null;
  isDrasticMoment: boolean;
};

type Decision = "BUY" | "SELL" | "HOLD";

type SubmitDecision = {
  decision: Decision;
  candleTime: string;
  stepNumber: number;
};

function isValidTradeDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function toDateOnly(value: string | Date): string {
  if (typeof value === "string") return value;
  return value.toISOString().slice(0, 10);
}

function toIso(value: string | Date): string {
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
  }

  return value.toISOString();
}

function isDecision(value: unknown): value is Decision {
  return value === "BUY" || value === "SELL" || value === "HOLD";
}

function normalizeTimeKey(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

async function getDayWithCandles(symbol: string, tradeDate: string) {
  const [day] = await db
    .select({
      id: volatileDaySummary.id,
      symbol: volatileDaySummary.symbol,
      tradeDate: volatileDaySummary.tradeDate,
      volatilityPct: volatileDaySummary.volatilityPct,
      open: volatileDaySummary.open,
      high: volatileDaySummary.high,
      low: volatileDaySummary.low,
      close: volatileDaySummary.close,
      totalVolume: volatileDaySummary.totalVolume,
      drasticChangeTime: volatileDaySummary.drasticChangeTime,
      drasticChangePct: volatileDaySummary.drasticChangePct,
    })
    .from(volatileDaySummary)
    .where(
      and(
        eq(volatileDaySummary.symbol, symbol),
        eq(volatileDaySummary.tradeDate, tradeDate),
      ),
    )
    .limit(1);

  if (!day) {
    return null;
  }

  const minuteRows = await db
    .select({
      candleTime: volatileMinuteCandle.candleTime,
      open: volatileMinuteCandle.open,
      high: volatileMinuteCandle.high,
      low: volatileMinuteCandle.low,
      close: volatileMinuteCandle.close,
      volume: volatileMinuteCandle.volume,
      minuteChangePct: volatileMinuteCandle.minuteChangePct,
      isDrasticMoment: volatileMinuteCandle.isDrasticMoment,
    })
    .from(volatileMinuteCandle)
    .where(
      and(
        eq(volatileMinuteCandle.symbol, symbol),
        eq(volatileMinuteCandle.tradeDate, tradeDate),
      ),
    )
    .orderBy(asc(volatileMinuteCandle.candleTime));

  if (minuteRows.length === 0) {
    return { day, candles: [] as MinuteCandle[] };
  }

  const candles: MinuteCandle[] = minuteRows.map((row) => ({
    time: toIso(row.candleTime),
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: row.volume,
    minuteChangePct: row.minuteChangePct,
    isDrasticMoment: row.isDrasticMoment,
  }));

  return { day, candles };
}

export async function GET(_request: Request, context: RouteContext) {
  const { symbol: rawSymbol, tradeDate } = await context.params;
  const symbol = decodeURIComponent(rawSymbol).trim().toUpperCase();

  if (!symbol) {
    return NextResponse.json({ message: "Invalid symbol." }, { status: 400 });
  }

  if (!isValidTradeDate(tradeDate)) {
    return NextResponse.json({ message: "Invalid trade date." }, { status: 400 });
  }

  const sessionData = await getDayWithCandles(symbol, tradeDate);

  if (!sessionData) {
    return NextResponse.json({ message: "Volatile day not found." }, { status: 404 });
  }

  const { day, candles } = sessionData;

  if (candles.length === 0) {
    return NextResponse.json({ message: "No minute candles found for this day." }, { status: 404 });
  }

  const drasticIndex = candles.findIndex((candle) => candle.isDrasticMoment);
  const splitIndex =
    drasticIndex > 0
      ? drasticIndex
      : Math.max(1, Math.min(candles.length - 1, Math.floor(candles.length / 2)));

  const initialCandles = candles.slice(0, splitIndex);
  const remainingCandles = candles.slice(splitIndex);

  return NextResponse.json({
    day: {
      id: day.id,
      symbol: day.symbol,
      tradeDate: toDateOnly(day.tradeDate),
    },
    totalCandles: candles.length,
    initialCandles,
    remainingCandles,
  });
}

export async function POST(request: Request, context: RouteContext) {
  const { symbol: rawSymbol, tradeDate } = await context.params;
  const symbol = decodeURIComponent(rawSymbol).trim().toUpperCase();

  if (!symbol) {
    return NextResponse.json({ message: "Invalid symbol." }, { status: 400 });
  }

  if (!isValidTradeDate(tradeDate)) {
    return NextResponse.json({ message: "Invalid trade date." }, { status: 400 });
  }

  const sessionData = await getDayWithCandles(symbol, tradeDate);
  if (!sessionData) {
    return NextResponse.json({ message: "Volatile day not found." }, { status: 404 });
  }

  const { day, candles } = sessionData;
  if (candles.length === 0) {
    return NextResponse.json({ message: "No minute candles found for this day." }, { status: 404 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ message: "Invalid JSON body." }, { status: 400 });
  }

  const decisions =
    typeof payload === "object" && payload !== null && "decisions" in payload
      ? (payload as { decisions?: unknown }).decisions
      : undefined;

  if (!Array.isArray(decisions) || decisions.length === 0) {
    return NextResponse.json({ message: "Decision log is required." }, { status: 400 });
  }

  const parsedDecisions: SubmitDecision[] = [];

  for (const decisionItem of decisions) {
    if (typeof decisionItem !== "object" || decisionItem === null) {
      return NextResponse.json({ message: "Invalid decision item." }, { status: 400 });
    }

    const row = decisionItem as {
      decision?: unknown;
      candleTime?: unknown;
      stepNumber?: unknown;
    };

    if (!isDecision(row.decision)) {
      return NextResponse.json({ message: "Invalid decision value." }, { status: 400 });
    }

    if (typeof row.candleTime !== "string" || row.candleTime.length === 0) {
      return NextResponse.json({ message: "Invalid candleTime value." }, { status: 400 });
    }

    if (typeof row.stepNumber !== "number" || !Number.isFinite(row.stepNumber)) {
      return NextResponse.json({ message: "Invalid stepNumber value." }, { status: 400 });
    }

    parsedDecisions.push({
      decision: row.decision,
      candleTime: row.candleTime,
      stepNumber: row.stepNumber,
    });
  }

  const candleByTime = new Map<string, MinuteCandle>();
  for (const candle of candles) {
    candleByTime.set(normalizeTimeKey(candle.time), candle);
  }

  let correctCount = 0;

  const scoredDecisions = parsedDecisions.map((entry) => {
    const candle = candleByTime.get(normalizeTimeKey(entry.candleTime));
    let expectedAction: Decision = "HOLD";

    if (candle && candle.minuteChangePct !== null) {
      if (candle.minuteChangePct > 0) expectedAction = "BUY";
      else if (candle.minuteChangePct < 0) expectedAction = "SELL";
    }

    const isCorrect = entry.decision === expectedAction;
    if (isCorrect) correctCount += 1;

    return {
      ...entry,
      expectedAction,
      isCorrect,
    };
  });

  return NextResponse.json({
    status: "submitted",
    summary: {
      totalDecisions: parsedDecisions.length,
      correctDecisions: correctCount,
      accuracyPct:
        parsedDecisions.length === 0
          ? 0
          : Number(((correctCount / parsedDecisions.length) * 100).toFixed(2)),
      endOfDayReached: parsedDecisions.length > 0,
    },
    day: {
      id: day.id,
      symbol: day.symbol,
      tradeDate: toDateOnly(day.tradeDate),
      volatilityPct: day.volatilityPct,
      open: day.open,
      high: day.high,
      low: day.low,
      close: day.close,
      totalVolume: day.totalVolume,
      drasticChangeTime: toIso(day.drasticChangeTime),
      drasticChangePct: day.drasticChangePct,
    },
    decisions: scoredDecisions,
  });
}
