import { and, asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { env } from "~/env";
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

type AiIndicatorSignal = "bullish" | "bearish" | "neutral";

type AiIndicatorExplanation = {
  name: string;
  value: string;
  signal: AiIndicatorSignal;
  explanation: string;
  howItWorks: string;
  buySellInference: string;
};

type AiFutureScenario = {
  scenario: string;
  probabilityPct: number | null;
  timeframe: string;
  trigger: string;
  invalidation: string;
  expectedMove: string;
  suggestedAction: string;
};

type AiDecisionAnalysis = {
  summary: string;
  actualLabel: Decision;
  isLabelAligned: boolean;
  confidence: number | null;
  candlestickReasoning: string;
  futureOutlook: string;
  futureScenarios: AiFutureScenario[];
  indicators: AiIndicatorExplanation[];
  riskNotes: string[];
};

type AiReview = {
  status: "available" | "unavailable" | "error";
  model: "gemini-3.1-flash-lite-preview";
  error?: string;
  analysis?: AiDecisionAnalysis;
};

type GeminiClient = {
  models: {
    generateContent: (args: {
      model: string;
      contents: string;
      config?: {
        temperature?: number;
        responseMimeType?: string;
      };
    }) => Promise<{ text?: string }>;
  };
};

type GoogleGenAiModule = {
  GoogleGenAI: new (args: { apiKey: string }) => GeminiClient;
};

function expectedActionFromMinuteChange(minuteChangePct: number | null): Decision {
  if (minuteChangePct === null) return "HOLD";
  if (minuteChangePct > 0) return "BUY";
  if (minuteChangePct < 0) return "SELL";
  return "HOLD";
}

function formatSignedPct(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "N/A";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function buildGroundTruthSummary(args: {
  actualLabel: Decision;
  userDecision: Decision;
  minuteChangePct: number | null;
}): string {
  const base =
    args.minuteChangePct === null
      ? "Ground-truth label uses the decision candle and minuteChangePct was unavailable, so label defaults to HOLD."
      : `Ground-truth label uses the decision candle minuteChangePct (${formatSignedPct(args.minuteChangePct)}), which maps to ${args.actualLabel}.`;

  const alignment =
    args.userDecision === args.actualLabel
      ? ` Your decision (${args.userDecision}) is aligned with this rule.`
      : ` Your decision (${args.userDecision}) is not aligned; expected ${args.actualLabel}.`;

  return `${base}${alignment}`;
}

function buildGroundTruthCandlestickReasoning(args: {
  actualLabel: Decision;
  minuteChangePct: number | null;
}): string {
  if (args.minuteChangePct === null) {
    return "At the decision candle, minuteChangePct is unavailable, so the scoring rule classifies the action as HOLD.";
  }

  if (args.actualLabel === "BUY") {
    return `At decision time, the candle closed above its open with minuteChangePct ${formatSignedPct(args.minuteChangePct)}, so the rule classifies BUY.`;
  }

  if (args.actualLabel === "SELL") {
    return `At decision time, the candle closed below its open with minuteChangePct ${formatSignedPct(args.minuteChangePct)}, so the rule classifies SELL.`;
  }

  return `At decision time, minuteChangePct was ${formatSignedPct(args.minuteChangePct)}, so the rule classifies HOLD.`;
}

function clampProbability(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Number(value.toFixed(2))));
}

function buildFallbackFutureScenarios(actualLabel: Decision): AiFutureScenario[] {
  if (actualLabel === "BUY") {
    return [
      {
        scenario: "Bullish continuation",
        probabilityPct: null,
        timeframe: "next 15-45 minutes",
        trigger: "Higher highs and higher lows continue with stable-to-rising volume.",
        invalidation: "Break below the latest swing low with heavy sell volume.",
        expectedMove: "Upside extension from entry zone.",
        suggestedAction: "Hold longs; trail stop under higher low structure.",
      },
      {
        scenario: "Bull trap reversal",
        probabilityPct: null,
        timeframe: "next 5-20 minutes",
        trigger: "Failed breakout and immediate rejection of highs.",
        invalidation: "Clean reclaim and hold above breakout area.",
        expectedMove: "Fast pullback toward recent support.",
        suggestedAction: "Reduce long exposure; wait for re-entry confirmation.",
      },
    ];
  }

  if (actualLabel === "SELL") {
    return [
      {
        scenario: "Bearish continuation",
        probabilityPct: null,
        timeframe: "next 15-45 minutes",
        trigger: "Lower highs/lows persist and breakdown candles expand with volume.",
        invalidation: "Strong reclaim above the last breakdown zone.",
        expectedMove: "Further downside extension.",
        suggestedAction: "Hold shorts; trail stop above lower-high pivots.",
      },
      {
        scenario: "Short-covering bounce",
        probabilityPct: null,
        timeframe: "next 5-20 minutes",
        trigger: "Exhaustion wick followed by momentum reversal candle.",
        invalidation: "Price fails to reclaim prior resistance.",
        expectedMove: "Sharp counter-trend bounce.",
        suggestedAction: "Take partial profits on shorts; avoid late entries.",
      },
    ];
  }

  return [
    {
      scenario: "Range continuation",
      probabilityPct: null,
      timeframe: "next 10-30 minutes",
      trigger: "Price oscillates between nearby support and resistance without breakout.",
      invalidation: "Decisive close outside range with volume expansion.",
      expectedMove: "Sideways chop.",
      suggestedAction: "Stay neutral or use tight risk around range edges.",
    },
  ];
}

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

function extractJsonFromText(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    // Handle fenced JSON blocks if the model wraps output in markdown.
    const fencedRegex = /```(?:json)?\s*([\s\S]*?)```/i;
    const fenced = fencedRegex.exec(trimmed);
    if (fenced?.[1]) {
      return JSON.parse(fenced[1].trim());
    }
    throw new Error("Model output was not valid JSON.");
  }
}

function normalizeIndicatorSignal(value: unknown): AiIndicatorSignal {
  if (value === "bullish" || value === "bearish" || value === "neutral") {
    return value;
  }
  return "neutral";
}

function normalizeDecisionAnalysis(
  data: unknown,
  args: {
    actualLabel: Decision;
    userDecision: Decision;
    minuteChangePct: number | null;
  },
): AiDecisionAnalysis | null {
  if (typeof data !== "object" || data === null) return null;

  const source = data as {
    summary?: unknown;
    actualLabel?: unknown;
    isLabelAligned?: unknown;
    confidence?: unknown;
    candlestickReasoning?: unknown;
    futureOutlook?: unknown;
    futureScenarios?: unknown;
    indicators?: unknown;
    riskNotes?: unknown;
  };

  const indicators = Array.isArray(source.indicators)
    ? source.indicators.flatMap((item) => {
        if (typeof item !== "object" || item === null) return [];
        const row = item as {
          name?: unknown;
          value?: unknown;
          signal?: unknown;
          explanation?: unknown;
          howItWorks?: unknown;
          buySellInference?: unknown;
        };

        if (typeof row.name !== "string" || row.name.length === 0) return [];

        return [
          {
            name: row.name,
            value: typeof row.value === "string" ? row.value : "",
            signal: normalizeIndicatorSignal(row.signal),
            explanation: typeof row.explanation === "string" ? row.explanation : "",
            howItWorks: typeof row.howItWorks === "string" ? row.howItWorks : "",
            buySellInference:
              typeof row.buySellInference === "string" ? row.buySellInference : "",
          },
        ];
      })
    : [];

  const riskNotes = Array.isArray(source.riskNotes)
    ? source.riskNotes.filter((note): note is string => typeof note === "string")
    : [];

  const futureScenarios = Array.isArray(source.futureScenarios)
    ? source.futureScenarios.flatMap((item) => {
        if (typeof item !== "object" || item === null) return [];

        const row = item as {
          scenario?: unknown;
          probabilityPct?: unknown;
          timeframe?: unknown;
          trigger?: unknown;
          invalidation?: unknown;
          expectedMove?: unknown;
          suggestedAction?: unknown;
        };

        if (typeof row.scenario !== "string" || row.scenario.length === 0) {
          return [];
        }

        return [
          {
            scenario: row.scenario,
            probabilityPct: clampProbability(row.probabilityPct),
            timeframe: typeof row.timeframe === "string" ? row.timeframe : "",
            trigger: typeof row.trigger === "string" ? row.trigger : "",
            invalidation: typeof row.invalidation === "string" ? row.invalidation : "",
            expectedMove: typeof row.expectedMove === "string" ? row.expectedMove : "",
            suggestedAction:
              typeof row.suggestedAction === "string" ? row.suggestedAction : "",
          },
        ];
      })
    : [];

  return {
    summary: buildGroundTruthSummary({
      actualLabel: args.actualLabel,
      userDecision: args.userDecision,
      minuteChangePct: args.minuteChangePct,
    }),
    // The backend label is the source of truth; never let model output override it.
    actualLabel: args.actualLabel,
    isLabelAligned: args.userDecision === args.actualLabel,
    confidence:
      typeof source.confidence === "number" && Number.isFinite(source.confidence)
        ? source.confidence
        : null,
    candlestickReasoning: buildGroundTruthCandlestickReasoning({
      actualLabel: args.actualLabel,
      minuteChangePct: args.minuteChangePct,
    }),
    futureOutlook:
      typeof source.futureOutlook === "string"
        ? source.futureOutlook
        : "Use triggers and invalidation levels to adapt as intraday structure evolves.",
    futureScenarios:
      futureScenarios.length > 0
        ? futureScenarios
        : buildFallbackFutureScenarios(args.actualLabel),
    indicators,
    riskNotes,
  };
}

async function generateAiReview(args: {
  symbol: string;
  tradeDate: string;
  ohlcvBeforeEntry: MinuteCandle[];
  userDecision: Decision;
  actualLabel: Decision;
  minuteChangePct: number | null;
  decisionTime: string;
}): Promise<AiReview> {
  if (!env.GEMINI_API_KEY) {
    return {
      status: "unavailable",
      model: "gemini-3.1-flash-lite-preview",
      error: "GEMINI_API_KEY is not configured.",
    };
  }

  const { GoogleGenAI } = (await import("@google/genai/node")) as unknown as GoogleGenAiModule;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

  const candlesWindow = args.ohlcvBeforeEntry.slice(-120).map((candle) => ({
    time: candle.time,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
  }));

  const prompt = {
    role: "You are a strict intraday market structure analyst.",
    task: "Explain the trade label and forecast what is most likely to happen next in the same intraday session using only provided OHLCV candles before entry.",
    instructions: [
      "Respect the ground-truth rule from context. Never invent a different label.",
      `The ground truth for this decision is: actualLabel = "${args.actualLabel}". Base all explanations on this fact.`,
      "Analyze every candlestick in the provided window for bearish or bullish signals: higher highs/lows, volume patterns, wick formations, close positions.",
      "Classify candlestick patterns as bearish (downtrend, lower highs/lows, heavy selling) or bullish (uptrend, higher highs/lows, heavy buying).",
      "Use candlestick behavior and indicator logic grounded in provided OHLCV data only.",
      "Compare userDecision with actualLabel and explain the mismatch briefly when present.",
      "Provide STRICTLY intraday scenarios—forecast ONLY the next 5-60 minutes within this same trading session, no daily/weekly/multi-day outlook.",
      "Each future scenario must include trigger, invalidation, expected move, suggested action, and timeframe in minutes.",
      "Give probabilities as realistic percentage estimates (0-100) based on candlestick structure and momentum at the decision point.",
      "Keep explanations concise and practical for active intraday decision-making.",
      "Return only JSON. No markdown.",
      "If evidence is mixed, mark indicator signal as neutral and mention uncertainty in risk notes.",
    ],
    outputSchema: {
      summary: "string",
      actualLabel: "BUY | SELL | HOLD",
      isLabelAligned: "boolean",
      confidence: "number between 0 and 1",
      candlestickReasoning: "string",
      futureOutlook: "string",
      futureScenarios: [
        {
          scenario: "string",
          probabilityPct: "number between 0 and 100",
          timeframe: "string",
          trigger: "string",
          invalidation: "string",
          expectedMove: "string",
          suggestedAction: "string",
        },
      ],
      indicators: [
        {
          name: "string",
          value: "string",
          signal: "bullish | bearish | neutral",
          explanation: "string",
          howItWorks: "string",
          buySellInference: "string",
        },
      ],
      riskNotes: ["string"],
    },
    context: {
      symbol: args.symbol,
      tradeDate: args.tradeDate,
      decisionTime: args.decisionTime,
      userDecision: args.userDecision,
      actualLabel: args.actualLabel,
      groundTruthRule:
        "Label = BUY if decision candle minuteChangePct > 0, SELL if < 0, HOLD if 0 or null.",
      decisionCandleMinuteChangePct: args.minuteChangePct,
      dataGranularity: "1-minute candles within a single trading day",
      forecastHorizon: "strictly next 5-60 minutes in this same intraday session",
      candlestickAnalysisRequired: true,
      bearishFactors: "lower highs/lows, higher volume on down candles, rejection at highs, weak closes",
      bullishFactors: "higher highs/lows, higher volume on up candles, breaks above resistance, strong closes",
      ohlcvBeforeEntry: candlesWindow,
    },
  };

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.1-flash-lite-preview",
      contents: JSON.stringify(prompt),
      config: {
        temperature: 0.2,
        responseMimeType: "application/json",
      },
    });

    const outputText = response.text?.trim() ?? "";

    if (!outputText) {
      return {
        status: "error",
        model: "gemini-3.1-flash-lite-preview",
        error: "Gemini response had no text output.",
      };
    }

    const parsed = extractJsonFromText(outputText);
    const analysis = normalizeDecisionAnalysis(parsed, {
      actualLabel: args.actualLabel,
      userDecision: args.userDecision,
      minuteChangePct: args.minuteChangePct,
    });

    if (!analysis) {
      return {
        status: "error",
        model: "gemini-3.1-flash-lite-preview",
        error: "Unable to parse Gemini JSON response.",
      };
    }

    return {
      status: "available",
      model: "gemini-3.1-flash-lite-preview",
      analysis,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: "error",
      model: "gemini-3.1-flash-lite-preview",
      error: message,
    };
  }
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
    const expectedAction = expectedActionFromMinuteChange(
      candle?.minuteChangePct ?? null,
    );

    const isCorrect = entry.decision === expectedAction;
    if (isCorrect) correctCount += 1;

    return {
      ...entry,
      expectedAction,
      isCorrect,
    };
  });

  const firstScoredDecision = scoredDecisions[0];
  const decisionCandleIndex = firstScoredDecision
    ? candles.findIndex(
        (candle) =>
          normalizeTimeKey(candle.time) ===
          normalizeTimeKey(firstScoredDecision.candleTime),
      )
    : -1;

  const ohlcvBeforeEntry =
    decisionCandleIndex > 0
      ? candles.slice(0, decisionCandleIndex)
      : candles.slice(0, Math.max(1, Math.floor(candles.length / 2)));

  const aiReview = firstScoredDecision
    ? await generateAiReview({
        symbol,
        tradeDate,
        ohlcvBeforeEntry,
        userDecision: firstScoredDecision.decision,
        actualLabel: firstScoredDecision.expectedAction,
        minuteChangePct:
          candleByTime.get(normalizeTimeKey(firstScoredDecision.candleTime))
            ?.minuteChangePct ?? null,
        decisionTime: firstScoredDecision.candleTime,
      })
    : ({
        status: "unavailable",
        model: "gemini-3.1-flash-lite-preview",
        error: "No decision found for AI analysis.",
      } as AiReview);

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
    aiReview,
  });
}
