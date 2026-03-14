"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

import { IntradayCandlestickChart } from "~/components/compete/intraday-candlestick-chart";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Spinner } from "~/components/ui/spinner";

// ── Types ──────────────────────────────────────────────────────────────────────

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

type IntradayDay = {
  id: number;
  symbol: string;
  tradeDate: string;
};

type IntradayRevealDay = IntradayDay & {
  volatilityPct: number;
  open: number;
  high: number;
  low: number;
  close: number;
  totalVolume: number;
  drasticChangeTime: string;
  drasticChangePct: number;
};

type IntradaySessionResponse = {
  day: IntradayDay;
  totalCandles: number;
  initialCandles: MinuteCandle[];
  remainingCandles: MinuteCandle[];
};

type Decision = "BUY" | "SELL" | "HOLD";
type HitType = "sl" | "tp" | "eod";

type DecisionLog = {
  decision: Decision;
  candleTime: string;
  stepNumber: number;
};

type SubmitDecision = DecisionLog;

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

type SubmitResponse = {
  status: "submitted";
  summary: {
    totalDecisions: number;
    correctDecisions: number;
    accuracyPct: number;
    endOfDayReached: boolean;
  };
  day: IntradayRevealDay;
  decisions: Array<
    SubmitDecision & { expectedAction: Decision; isCorrect: boolean }
  >;
  aiReview?: {
    status: "available" | "unavailable" | "error";
    model: "gemini-3.1-flash-lite-preview";
    error?: string;
    analysis?: AiDecisionAnalysis;
  };
};

// ── Constants ──────────────────────────────────────────────────────────────────

/** Candles added to the chart per animation tick. */
const STREAM_BATCH = 3;
/** Milliseconds between animation ticks (~5 s for a typical 375-candle day). */
const STREAM_INTERVAL_MS = 40;

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatDate(dateString: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${dateString}T00:00:00.000Z`));
}

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(date);
}

function formatNumber(value: number, maxFractionDigits = 2): string {
  return new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: maxFractionDigits,
  }).format(value);
}

function formatPct(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

/**
 * Scan `candles` and return the first index where SL or TP is triggered.
 * `stopAt` is 1-based exclusive — we reveal candles[0…stopAt-1].
 *
 * Within the same minute candle, SL is checked before TP (pessimistic
 * assumption for long trades, mirrors real-market behaviour).
 */
function findTriggerIndex(
  decision: Decision,
  candles: MinuteCandle[],
  sl: number | null,
  tp: number | null,
): { stopAt: number; hitType: HitType } {
  if (decision === "HOLD" || (sl === null && tp === null)) {
    return { stopAt: candles.length, hitType: "eod" };
  }

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]!;
    if (decision === "BUY") {
      if (sl !== null && c.low <= sl) return { stopAt: i + 1, hitType: "sl" };
      if (tp !== null && c.high >= tp) return { stopAt: i + 1, hitType: "tp" };
    } else {
      // SELL / short — SL is above entry, TP is below
      if (sl !== null && c.high >= sl) return { stopAt: i + 1, hitType: "sl" };
      if (tp !== null && c.low <= tp) return { stopAt: i + 1, hitType: "tp" };
    }
  }

  return { stopAt: candles.length, hitType: "eod" };
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function IntradayPlayPage() {
  const params = useParams<{ symbol: string; tradeDate: string }>();

  // ── Session data ──────────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [day, setDay] = useState<IntradayDay | null>(null);
  const [initialCandles, setInitialCandles] = useState<MinuteCandle[]>([]);
  const [remainingCandles, setRemainingCandles] = useState<MinuteCandle[]>([]);

  // ── Game state ────────────────────────────────────────────────────────────────
  const [revealedCount, setRevealedCount] = useState(0);
  const [decisionLog, setDecisionLog] = useState<DecisionLog[]>([]);
  const [selectedDecision, setSelectedDecision] = useState<Decision | null>(
    null,
  );
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingComplete, setStreamingComplete] = useState(false);
  /** Exclusive upper bound of the stream animation (index into remainingCandles). */
  const [streamStopAt, setStreamStopAt] = useState(0);
  /** What caused the stream to stop. */
  const [hitType, setHitType] = useState<HitType | null>(null);

  // ── SL / TP inputs (string so the number input stays controlled) ──────────────
  const [stopLoss, setStopLoss] = useState("");
  const [takeProfit, setTakeProfit] = useState("");
  /** Which level the user is currently picking from the chart, or null. */
  const [slTpMode, setSlTpMode] = useState<"sl" | "tp" | null>(null);

  // ── Submission ────────────────────────────────────────────────────────────────
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<SubmitResponse | null>(null);

  const streamIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Load session ──────────────────────────────────────────────────────────────
  useEffect(() => {
    let mounted = true;

    const loadSession = async () => {
      const symbolParam = params.symbol;
      const tradeDateParam = params.tradeDate;

      if (!symbolParam || !tradeDateParam) {
        if (mounted) {
          setError("Invalid route params.");
          setLoading(false);
        }
        return;
      }

      try {
        setLoading(true);

        const response = await fetch(
          `/api/competitions/intraday/${encodeURIComponent(symbolParam)}/${tradeDateParam}`,
          { method: "GET", cache: "no-store" },
        );

        if (!response.ok) {
          throw new Error(
            `Failed to load intraday session (${response.status})`,
          );
        }

        const payload = (await response.json()) as IntradaySessionResponse;

        if (mounted) {
          setDay(payload.day);
          setInitialCandles(payload.initialCandles);
          setRemainingCandles(payload.remainingCandles);
          setRevealedCount(0);
          setDecisionLog([]);
          setSelectedDecision(null);
          setIsStreaming(false);
          setStreamingComplete(false);
          setStreamStopAt(0);
          setHitType(null);
          setStopLoss("");
          setTakeProfit("");
          setSlTpMode(null);
          setSubmitting(false);
          setSubmitError(null);
          setResult(null);
          setError(null);
        }
      } catch (err) {
        if (mounted) {
          setError("Unable to load intraday day candles.");
          console.error(err);
        }
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void loadSession();

    return () => {
      mounted = false;
    };
  }, [params.symbol, params.tradeDate]);

  // Clean up streaming interval on unmount
  useEffect(() => {
    return () => {
      if (streamIntervalRef.current) clearInterval(streamIntervalRef.current);
    };
  }, []);

  // ── Derived values ────────────────────────────────────────────────────────────

  /** Close of the last initial candle — the trade entry price. */
  const entryPrice = useMemo(
    () => initialCandles.at(-1)?.close ?? null,
    [initialCandles],
  );

  /** ISO time of the drastic candle — drives the vertical Start line on the chart. */
  const startTime = useMemo(
    () => remainingCandles[0]?.time,
    [remainingCandles],
  );

  const stopLossNum = useMemo(() => {
    const n = parseFloat(stopLoss);
    return isNaN(n) ? null : n;
  }, [stopLoss]);

  const takeProfitNum = useMemo(() => {
    const n = parseFloat(takeProfit);
    return isNaN(n) ? null : n;
  }, [takeProfit]);

  const revealedCandles = useMemo(
    () => remainingCandles.slice(0, revealedCount),
    [remainingCandles, revealedCount],
  );

  const chartPoints = useMemo(
    () => [...initialCandles, ...revealedCandles],
    [initialCandles, revealedCandles],
  );

  /** 0–100 progress while streaming toward the trigger point. */
  const streamingProgress =
    streamStopAt > 0
      ? Math.min(100, Math.round((revealedCount / streamStopAt) * 100))
      : 0;

  const hasDecisionMade = decisionLog.length > 0;

  /** Inline validation hint for the SL field. */
  const slWarning = useMemo(() => {
    if (!entryPrice || !selectedDecision || stopLossNum === null) return null;
    if (selectedDecision === "BUY" && stopLossNum >= entryPrice)
      return "SL should be below entry price for a Buy";
    if (selectedDecision === "SELL" && stopLossNum <= entryPrice)
      return "SL should be above entry price for a Sell";
    return null;
  }, [entryPrice, selectedDecision, stopLossNum]);

  /** Inline validation hint for the TP field. */
  const tpWarning = useMemo(() => {
    if (!entryPrice || !selectedDecision || takeProfitNum === null) return null;
    if (selectedDecision === "BUY" && takeProfitNum <= entryPrice)
      return "TP should be above entry price for a Buy";
    if (selectedDecision === "SELL" && takeProfitNum >= entryPrice)
      return "TP should be below entry price for a Sell";
    return null;
  }, [entryPrice, selectedDecision, takeProfitNum]);

  /**
   * Exit price after streaming:
   *  • SL hit → stop-loss price
   *  • TP hit → take-profit price
   *  • EOD   → close of the last revealed candle
   */
  const exitPrice = useMemo(() => {
    if (!streamingComplete || streamStopAt === 0) return null;
    if (hitType === "sl" && stopLossNum !== null) return stopLossNum;
    if (hitType === "tp" && takeProfitNum !== null) return takeProfitNum;
    return remainingCandles[streamStopAt - 1]?.close ?? null;
  }, [
    streamingComplete,
    streamStopAt,
    hitType,
    stopLossNum,
    takeProfitNum,
    remainingCandles,
  ]);

  /** Percentage P&L of the simulated trade. */
  const pnlPct = useMemo(() => {
    if (exitPrice === null || entryPrice === null || !decisionLog[0])
      return null;
    const { decision } = decisionLog[0];
    if (decision === "BUY")
      return ((exitPrice - entryPrice) / entryPrice) * 100;
    if (decision === "SELL")
      return ((entryPrice - exitPrice) / entryPrice) * 100;
    return null;
  }, [exitPrice, entryPrice, decisionLog]);

  /** Called by the chart when the user clicks a price in pick mode. */
  const handlePriceSelected = useCallback(
    (price: number, type: "sl" | "tp") => {
      if (type === "sl") setStopLoss(price.toFixed(2));
      else setTakeProfit(price.toFixed(2));
      setSlTpMode(null);
    },
    [],
  );

  // ── Confirm decision & start streaming ────────────────────────────────────────
  const onConfirmDecision = () => {
    if (!selectedDecision || result || isStreaming || hasDecisionMade) return;
    if (remainingCandles.length === 0) return;

    const drasticCandle = remainingCandles[0]!;

    setDecisionLog([
      {
        decision: selectedDecision,
        candleTime: drasticCandle.time,
        stepNumber: 1,
      },
    ]);
    setSelectedDecision(null);

    // Find the first candle where SL or TP fires (or EOD if neither)
    const { stopAt, hitType: hit } = findTriggerIndex(
      selectedDecision,
      remainingCandles,
      stopLossNum,
      takeProfitNum,
    );

    setStreamStopAt(stopAt);
    setHitType(hit);
    setIsStreaming(true);

    let count = 0;
    streamIntervalRef.current = setInterval(() => {
      count += STREAM_BATCH;
      if (count >= stopAt) {
        count = stopAt;
        if (streamIntervalRef.current) {
          clearInterval(streamIntervalRef.current);
          streamIntervalRef.current = null;
        }
        setRevealedCount(count);
        setIsStreaming(false);
        setStreamingComplete(true);
      } else {
        setRevealedCount(count);
      }
    }, STREAM_INTERVAL_MS);
  };

  // ── Submit session ────────────────────────────────────────────────────────────
  const onSubmitSession = async () => {
    if (decisionLog.length === 0 || !streamingComplete || result) return;

    try {
      setSubmitting(true);
      setSubmitError(null);

      const response = await fetch(
        `/api/competitions/intraday/${encodeURIComponent(day?.symbol ?? "")}/${day?.tradeDate ?? ""}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decisions: decisionLog }),
        },
      );

      if (!response.ok)
        throw new Error(`Failed to submit session (${response.status})`);

      const payload = (await response.json()) as SubmitResponse;
      setResult(payload);
    } catch (err) {
      setSubmitError("Could not submit your session. Please retry.");
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <main className="bg-background min-h-screen">
      <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        {/* Nav */}
        <div className="mb-6 flex flex-wrap items-center gap-2">
          <Button variant="outline" asChild>
            <Link href="/compete/intraday">Back</Link>
          </Button>
          <Button variant="ghost" asChild>
            <Link href="/compete">All Modes</Link>
          </Button>
        </div>

        {loading ? (
          <div className="border-border/70 bg-card/40 flex min-h-48 items-center justify-center rounded-none border">
            <Spinner className="mr-2 h-4 w-4" />
            <p className="text-muted-foreground text-sm">
              Loading intraday simulation…
            </p>
          </div>
        ) : error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : !day ? (
          <Alert variant="destructive">
            <AlertDescription>
              Intraday day details are unavailable.
            </AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-5">
            {/* ── Page header ─────────────────────────────────────────────────── */}
            <div className="space-y-2">
              <p className="text-muted-foreground text-xs font-medium tracking-[0.2em] uppercase">
                Intra Day Simulation
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                  {day.symbol} &mdash; {formatDate(day.tradeDate)}
                </h1>
                <Badge variant="outline">Metrics Hidden</Badge>
                <Badge variant="secondary">Reveal after submit</Badge>
              </div>
              <p className="text-muted-foreground text-sm">
                Study the price action, set your stop-loss and take-profit, then
                make your one call at the key market moment. After confirming,
                the day fast-forwards to your trigger point — full details
                unlock on final submission.
              </p>
            </div>

            {/* ── Row 1: Chart (left) | Decision controls (right) ──────────────── */}
            <div className="grid gap-5 lg:grid-cols-3">
              {/* Chart */}
              <Card className="border-border/70 bg-card border lg:col-span-2">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Price Action</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <IntradayCandlestickChart
                    points={chartPoints}
                    isStreaming={isStreaming}
                    startTime={startTime}
                    entryPrice={entryPrice ?? undefined}
                    stopLossPrice={stopLossNum ?? undefined}
                    takeProfitPrice={takeProfitNum ?? undefined}
                    slTpMode={hasDecisionMade ? null : slTpMode}
                    onPriceSelected={handlePriceSelected}
                  />

                  {/* Chart footer status row */}
                  <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span>
                      Candles visible:{" "}
                      <span className="text-foreground font-medium">
                        {chartPoints.length}
                      </span>
                    </span>
                    {isStreaming ? (
                      <span className="flex items-center gap-1.5 text-amber-500 dark:text-amber-400">
                        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500 dark:bg-amber-400" />
                        Streaming to trigger point…
                      </span>
                    ) : streamingComplete ? (
                      <span
                        className={
                          hitType === "tp"
                            ? "text-emerald-600 dark:text-emerald-400"
                            : hitType === "sl"
                              ? "text-red-500"
                              : "text-muted-foreground"
                        }
                      >
                        {hitType === "tp"
                          ? "Take profit hit"
                          : hitType === "sl"
                            ? "Stop loss triggered"
                            : "Full day revealed"}
                      </span>
                    ) : (
                      <span>
                        Hidden candles:{" "}
                        <span className="text-foreground font-medium">
                          {remainingCandles.length}
                        </span>
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* ── Right column: all panels stacked ─────────────────────────── */}
              <div className="flex flex-col gap-5">
                {/* Decision controls */}
                <Card className="border-border/70 bg-card border">
                  <CardHeader>
                    <CardTitle className="text-base">Decision Panel</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* ── Phase 1: one-time decision ─────────────────────────────── */}
                    {!hasDecisionMade &&
                      !isStreaming &&
                      !streamingComplete &&
                      !result && (
                        <div className="space-y-4">
                          {/* Key-moment banner */}
                          <div className="rounded-none border border-amber-500/40 bg-amber-50/60 px-3 py-2.5 dark:bg-amber-900/20">
                            <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                              Key moment ahead
                            </p>
                            <p className="mt-0.5 text-xs text-amber-600 dark:text-amber-300">
                              Unusual activity is approaching. This is your one
                              decision for the day — set your levels and choose
                              carefully.
                            </p>
                          </div>

                          {/* Entry price display */}
                          {entryPrice !== null && (
                            <div className="border-border/70 bg-muted/20 flex items-center justify-between rounded-none border px-3 py-2 text-xs">
                              <span className="text-muted-foreground">
                                Entry price
                              </span>
                              <span className="font-semibold text-amber-600 dark:text-amber-400">
                                &#8377;{formatNumber(entryPrice)}
                              </span>
                            </div>
                          )}

                          {/* SL / TP inputs */}
                          <div className="space-y-3">
                            {/* Stop Loss */}
                            <div className="space-y-1">
                              <label className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
                                Stop Loss (&#8377;)
                                {entryPrice !== null &&
                                  stopLossNum !== null && (
                                    <span className="font-semibold text-red-500">
                                      {formatPct(
                                        ((stopLossNum - entryPrice) /
                                          entryPrice) *
                                          100,
                                      )}
                                    </span>
                                  )}
                              </label>
                              <div className="flex gap-1.5">
                                <Input
                                  type="number"
                                  step="0.01"
                                  placeholder={
                                    entryPrice !== null
                                      ? `e.g. ${(entryPrice * 0.98).toFixed(2)}`
                                      : "Price…"
                                  }
                                  value={stopLoss}
                                  onChange={(e) => setStopLoss(e.target.value)}
                                  className={`min-w-0 flex-1 ${slWarning ? "border-red-500/60" : ""}`}
                                />
                                <button
                                  type="button"
                                  onClick={() =>
                                    setSlTpMode(slTpMode === "sl" ? null : "sl")
                                  }
                                  className={[
                                    "h-8 shrink-0 rounded-none border px-2 text-[11px] font-semibold transition-colors",
                                    slTpMode === "sl"
                                      ? "border-red-500 bg-red-500 text-white"
                                      : "border-red-500/50 text-red-500 hover:bg-red-500/10",
                                  ].join(" ")}
                                  title="Click on the chart to set your stop loss"
                                >
                                  {slTpMode === "sl" ? "Cancel" : "Pick"}
                                </button>
                              </div>
                              {slWarning && (
                                <p className="text-xs text-red-500">
                                  {slWarning}
                                </p>
                              )}
                            </div>

                            {/* Take Profit */}
                            <div className="space-y-1">
                              <label className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
                                Take Profit (&#8377;)
                                {entryPrice !== null &&
                                  takeProfitNum !== null && (
                                    <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                                      {formatPct(
                                        ((takeProfitNum - entryPrice) /
                                          entryPrice) *
                                          100,
                                      )}
                                    </span>
                                  )}
                              </label>
                              <div className="flex gap-1.5">
                                <Input
                                  type="number"
                                  step="0.01"
                                  placeholder={
                                    entryPrice !== null
                                      ? `e.g. ${(entryPrice * 1.02).toFixed(2)}`
                                      : "Price…"
                                  }
                                  value={takeProfit}
                                  onChange={(e) =>
                                    setTakeProfit(e.target.value)
                                  }
                                  className={`min-w-0 flex-1 ${tpWarning ? "border-red-500/60" : ""}`}
                                />
                                <button
                                  type="button"
                                  onClick={() =>
                                    setSlTpMode(slTpMode === "tp" ? null : "tp")
                                  }
                                  className={[
                                    "h-8 shrink-0 rounded-none border px-2 text-[11px] font-semibold transition-colors",
                                    slTpMode === "tp"
                                      ? "border-emerald-500 bg-emerald-500 text-white"
                                      : "border-emerald-500/50 text-emerald-600 hover:bg-emerald-500/10",
                                  ].join(" ")}
                                  title="Click on the chart to set your take profit"
                                >
                                  {slTpMode === "tp" ? "Cancel" : "Pick"}
                                </button>
                              </div>
                              {tpWarning && (
                                <p className="text-xs text-red-500">
                                  {tpWarning}
                                </p>
                              )}
                            </div>
                          </div>

                          {/* Direction buttons */}
                          <div className="space-y-2">
                            <p className="text-muted-foreground text-xs">
                              Your position at this juncture:
                            </p>
                            <div className="grid grid-cols-3 gap-2">
                              <Button
                                variant={
                                  selectedDecision === "BUY"
                                    ? "default"
                                    : "outline"
                                }
                                onClick={() => setSelectedDecision("BUY")}
                              >
                                Buy
                              </Button>
                              <Button
                                variant={
                                  selectedDecision === "SELL"
                                    ? "destructive"
                                    : "outline"
                                }
                                onClick={() => setSelectedDecision("SELL")}
                              >
                                Sell
                              </Button>
                              <Button
                                variant={
                                  selectedDecision === "HOLD"
                                    ? "secondary"
                                    : "outline"
                                }
                                onClick={() => setSelectedDecision("HOLD")}
                              >
                                Hold
                              </Button>
                            </div>
                          </div>

                          <Button
                            className="w-full"
                            disabled={!selectedDecision}
                            onClick={onConfirmDecision}
                          >
                            Confirm &amp; Play Out the Day
                          </Button>
                        </div>
                      )}

                    {/* ── Phase 2: streaming in progress ─────────────────────────── */}
                    {isStreaming && (
                      <div className="space-y-3">
                        <div className="flex items-center gap-2">
                          <Spinner className="h-3.5 w-3.5 text-amber-500" />
                          <p className="text-sm font-medium text-amber-600 dark:text-amber-400">
                            Fast-forwarding to trigger point…
                          </p>
                        </div>
                        <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
                          <div
                            className="h-full rounded-full bg-amber-500 transition-all duration-75 ease-linear"
                            style={{ width: `${streamingProgress}%` }}
                          />
                        </div>
                        <p className="text-muted-foreground text-right text-xs">
                          {streamingProgress}%
                        </p>

                        {/* Show the locked-in decision while streaming */}
                        {decisionLog[0] && (
                          <div className="border-border/70 bg-muted/20 rounded-none border px-3 py-2 text-xs">
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">
                                Direction
                              </span>
                              <span
                                className={
                                  decisionLog[0].decision === "BUY"
                                    ? "font-semibold text-emerald-600 dark:text-emerald-400"
                                    : decisionLog[0].decision === "SELL"
                                      ? "font-semibold text-red-500"
                                      : "text-muted-foreground"
                                }
                              >
                                {decisionLog[0].decision}
                              </span>
                            </div>
                            {entryPrice !== null && (
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">
                                  Entry
                                </span>
                                <span className="text-foreground font-medium">
                                  &#8377;{formatNumber(entryPrice)}
                                </span>
                              </div>
                            )}
                            {stopLossNum !== null && (
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">
                                  SL
                                </span>
                                <span className="font-medium text-red-500">
                                  &#8377;{formatNumber(stopLossNum)}
                                </span>
                              </div>
                            )}
                            {takeProfitNum !== null && (
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">
                                  TP
                                </span>
                                <span className="font-medium text-emerald-600 dark:text-emerald-400">
                                  &#8377;{formatNumber(takeProfitNum)}
                                </span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* ── Phase 3: trade outcome + submit ─────────────────────────── */}
                    {streamingComplete && !result && (
                      <div className="space-y-3">
                        {/* Hit result banner */}
                        <div
                          className={[
                            "rounded-none border px-3 py-3",
                            hitType === "tp"
                              ? "border-emerald-500/40 bg-emerald-50/60 dark:bg-emerald-900/20"
                              : hitType === "sl"
                                ? "border-red-500/40 bg-red-50/60 dark:bg-red-900/20"
                                : "border-border/70 bg-muted/20",
                          ].join(" ")}
                        >
                          <p
                            className={[
                              "text-xs font-bold",
                              hitType === "tp"
                                ? "text-emerald-700 dark:text-emerald-400"
                                : hitType === "sl"
                                  ? "text-red-600 dark:text-red-400"
                                  : "text-foreground",
                            ].join(" ")}
                          >
                            {hitType === "tp"
                              ? "✓ Take profit hit"
                              : hitType === "sl"
                                ? "✗ Stop loss triggered"
                                : "~ End of day reached"}
                          </p>

                          <div className="mt-2 space-y-1 text-xs">
                            {entryPrice !== null && (
                              <div className="text-muted-foreground flex justify-between">
                                <span>Entry</span>
                                <span className="text-foreground font-medium">
                                  &#8377;{formatNumber(entryPrice)}
                                </span>
                              </div>
                            )}
                            {exitPrice !== null && (
                              <div className="text-muted-foreground flex justify-between">
                                <span>Exit</span>
                                <span className="text-foreground font-medium">
                                  &#8377;{formatNumber(exitPrice)}
                                </span>
                              </div>
                            )}
                            {pnlPct !== null && (
                              <div className="flex justify-between font-bold">
                                <span className="text-muted-foreground">
                                  P&amp;L
                                </span>
                                <span
                                  className={
                                    pnlPct >= 0
                                      ? "text-emerald-600 dark:text-emerald-400"
                                      : "text-red-500"
                                  }
                                >
                                  {formatPct(pnlPct)}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>

                        <Alert>
                          <AlertDescription>
                            Submit to reveal full day details and your accuracy
                            score.
                          </AlertDescription>
                        </Alert>

                        <Button
                          className="w-full"
                          onClick={onSubmitSession}
                          disabled={submitting}
                        >
                          {submitting
                            ? "Submitting…"
                            : "Submit & Reveal Details"}
                        </Button>

                        {submitError && (
                          <p className="text-destructive text-xs">
                            {submitError}
                          </p>
                        )}
                      </div>
                    )}

                    {/* ── Phase 4: submitted ─────────────────────────────────────── */}
                    {result && (
                      <div className="space-y-3">
                        <Alert>
                          <AlertDescription>
                            Session submitted — full details unlocked below.
                          </AlertDescription>
                        </Alert>

                        {pnlPct !== null && (
                          <div className="border-border/70 bg-muted/20 rounded-none border px-3 py-2 text-xs">
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">
                                Trade P&amp;L
                              </span>
                              <span
                                className={`font-bold ${pnlPct >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}`}
                              >
                                {formatPct(pnlPct)}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">
                                Accuracy
                              </span>
                              <span className="text-foreground font-medium">
                                {formatNumber(result.summary.accuracyPct)}%
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Day Metrics */}
                <Card className="border-border/70 bg-card border">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Day Metrics</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {!result ? (
                      <p className="text-muted-foreground text-xs">
                        Hidden until you complete the session and submit.
                      </p>
                    ) : (
                      <div className="space-y-1 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Open</span>
                          <span className="font-medium">
                            &#8377;{formatNumber(result.day.open)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">High</span>
                          <span className="font-medium">
                            &#8377;{formatNumber(result.day.high)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Low</span>
                          <span className="font-medium">
                            &#8377;{formatNumber(result.day.low)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Close</span>
                          <span className="font-medium">
                            &#8377;{formatNumber(result.day.close)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">
                            Volatility
                          </span>
                          <span className="font-medium">
                            {formatNumber(result.day.volatilityPct)}%
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Volume</span>
                          <span className="font-medium">
                            {formatNumber(result.day.totalVolume, 0)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">
                            Drastic time
                          </span>
                          <span className="font-medium">
                            {formatDateTime(result.day.drasticChangeTime)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">
                            Drastic move
                          </span>
                          <span
                            className={
                              result.day.drasticChangePct >= 0
                                ? "font-medium text-emerald-600 dark:text-emerald-400"
                                : "font-medium text-red-500"
                            }
                          >
                            {formatPct(result.day.drasticChangePct)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">
                            Accuracy
                          </span>
                          <span className="font-medium">
                            {formatNumber(result.summary.accuracyPct)}%
                          </span>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Decision Log */}
                <Card className="border-border/70 bg-card border">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Decision Log</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {decisionLog.length === 0 ? (
                      <p className="text-muted-foreground text-xs">
                        No decision recorded yet.
                      </p>
                    ) : (
                      <div className="space-y-2 text-xs">
                        {decisionLog.map((entry) => {
                          const scored = result?.decisions.find(
                            (d) => d.stepNumber === entry.stepNumber,
                          );
                          return (
                            <div
                              key={`${entry.stepNumber}-${entry.candleTime}`}
                              className="border-border/70 bg-muted/20 rounded-none border px-3 py-2"
                            >
                              <div className="flex items-center justify-between">
                                <span className="text-muted-foreground">
                                  Direction
                                </span>
                                <span
                                  className={
                                    entry.decision === "BUY"
                                      ? "font-semibold text-emerald-600 dark:text-emerald-400"
                                      : entry.decision === "SELL"
                                        ? "font-semibold text-red-500"
                                        : "text-muted-foreground"
                                  }
                                >
                                  {entry.decision}
                                </span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-muted-foreground">
                                  At
                                </span>
                                <span className="text-foreground">
                                  {formatDateTime(entry.candleTime)}
                                </span>
                              </div>
                              {entryPrice !== null && (
                                <div className="flex items-center justify-between">
                                  <span className="text-muted-foreground">
                                    Entry
                                  </span>
                                  <span className="text-foreground font-medium">
                                    &#8377;{formatNumber(entryPrice)}
                                  </span>
                                </div>
                              )}
                              {stopLossNum !== null && (
                                <div className="flex items-center justify-between">
                                  <span className="text-muted-foreground">
                                    SL
                                  </span>
                                  <span className="font-medium text-red-500">
                                    &#8377;{formatNumber(stopLossNum)}
                                  </span>
                                </div>
                              )}
                              {takeProfitNum !== null && (
                                <div className="flex items-center justify-between">
                                  <span className="text-muted-foreground">
                                    TP
                                  </span>
                                  <span className="font-medium text-emerald-600 dark:text-emerald-400">
                                    &#8377;{formatNumber(takeProfitNum)}
                                  </span>
                                </div>
                              )}
                              {hitType && (
                                <div className="flex items-center justify-between">
                                  <span className="text-muted-foreground">
                                    Outcome
                                  </span>
                                  <span
                                    className={
                                      hitType === "tp"
                                        ? "font-semibold text-emerald-600 dark:text-emerald-400"
                                        : hitType === "sl"
                                          ? "font-semibold text-red-500"
                                          : "text-muted-foreground"
                                    }
                                  >
                                    {hitType === "tp"
                                      ? "TP hit"
                                      : hitType === "sl"
                                        ? "SL hit"
                                        : "EOD"}
                                  </span>
                                </div>
                              )}
                              {pnlPct !== null && (
                                <div className="flex items-center justify-between font-bold">
                                  <span className="text-muted-foreground">
                                    P&amp;L
                                  </span>
                                  <span
                                    className={
                                      pnlPct >= 0
                                        ? "text-emerald-600 dark:text-emerald-400"
                                        : "text-red-500"
                                    }
                                  >
                                    {formatPct(pnlPct)}
                                  </span>
                                </div>
                              )}
                              {scored && (
                                <div className="border-border/40 mt-1 flex items-center justify-between border-t pt-1">
                                  <span className="text-muted-foreground">
                                    Direction grade
                                  </span>
                                  <span
                                    className={
                                      scored.isCorrect
                                        ? "font-semibold text-emerald-600 dark:text-emerald-400"
                                        : "font-semibold text-red-500"
                                    }
                                  >
                                    {scored.isCorrect
                                      ? "✓ Correct"
                                      : `✗ Expected ${scored.expectedAction}`}
                                  </span>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
              {/* end right column */}
            </div>

            {/* AI Reasoning - Below chart, full width */}
            {result?.aiReview && (
              <Card className="border-border/70 bg-card border">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">AI Reasoning</CardTitle>
                </CardHeader>
                <CardContent>
                  {result.aiReview.status !== "available" ||
                  !result.aiReview.analysis ? (
                    <p className="text-muted-foreground text-xs">
                      {result.aiReview.error ??
                        "AI reasoning is currently unavailable."}
                    </p>
                  ) : (
                    <div className="space-y-3 text-xs">
                      <div className="border-border/70 bg-muted/20 rounded-none border px-3 py-2">
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Model</span>
                          <span className="font-medium">
                            {result.aiReview.model}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center justify-between">
                          <span className="text-muted-foreground">
                            Actual label
                          </span>
                          <span
                            className={
                              result.aiReview.analysis.actualLabel ===
                              "BUY"
                                ? "font-semibold text-emerald-600 dark:text-emerald-400"
                                : result.aiReview.analysis.actualLabel ===
                                    "SELL"
                                  ? "font-semibold text-red-500"
                                  : "font-medium"
                            }
                          >
                            {result.aiReview.analysis.actualLabel}
                          </span>
                        </div>
                        {typeof result.aiReview.analysis.confidence ===
                          "number" && (
                          <div className="mt-1 flex items-center justify-between">
                            <span className="text-muted-foreground">
                              Confidence
                            </span>
                            <span className="font-medium">
                              {formatNumber(
                                result.aiReview.analysis.confidence * 100,
                              )}
                              %
                            </span>
                          </div>
                        )}
                      </div>

                      {result.aiReview.analysis.summary && (
                        <p className="text-muted-foreground">
                          {result.aiReview.analysis.summary}
                        </p>
                      )}

                      {result.aiReview.analysis.candlestickReasoning && (
                        <div className="border-border/70 rounded-none border px-3 py-2">
                          <p className="text-foreground font-medium">
                            Candlestick reasoning
                          </p>
                          <p className="text-muted-foreground mt-1">
                            {result.aiReview.analysis.candlestickReasoning}
                          </p>
                        </div>
                      )}

                      {(result.aiReview.analysis.futureOutlook ||
                        result.aiReview.analysis.futureScenarios.length >
                          0) && (
                        <div className="space-y-2">
                          <p className="text-foreground font-medium">
                            What can happen next
                          </p>
                          {result.aiReview.analysis.futureOutlook && (
                            <p className="text-muted-foreground">
                              {result.aiReview.analysis.futureOutlook}
                            </p>
                          )}
                          {result.aiReview.analysis.futureScenarios.map(
                            (scenario, idx) => (
                              <div
                                key={`${scenario.scenario}-${idx}`}
                                className="border-border/70 bg-muted/20 rounded-none border px-3 py-2"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-semibold">
                                    {scenario.scenario}
                                  </span>
                                  {typeof scenario.probabilityPct ===
                                    "number" && (
                                    <span className="text-muted-foreground font-medium">
                                      {formatNumber(scenario.probabilityPct)}%
                                    </span>
                                  )}
                                </div>
                                {scenario.timeframe && (
                                  <p className="text-muted-foreground mt-1">
                                    Timeframe: {scenario.timeframe}
                                  </p>
                                )}
                                {scenario.trigger && (
                                  <p className="text-muted-foreground mt-1">
                                    Trigger: {scenario.trigger}
                                  </p>
                                )}
                                {scenario.invalidation && (
                                  <p className="text-muted-foreground mt-1">
                                    Invalidation: {scenario.invalidation}
                                  </p>
                                )}
                                {scenario.expectedMove && (
                                  <p className="text-muted-foreground mt-1">
                                    Expected move: {scenario.expectedMove}
                                  </p>
                                )}
                                {scenario.suggestedAction && (
                                  <p className="text-muted-foreground mt-1">
                                    Suggested action: {scenario.suggestedAction}
                                  </p>
                                )}
                              </div>
                            ),
                          )}
                        </div>
                      )}

                      {result.aiReview.analysis.indicators.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-foreground font-medium">
                            Indicator breakdown
                          </p>
                          {result.aiReview.analysis.indicators.map(
                            (indicator, idx) => (
                              <div
                                key={`${indicator.name}-${idx}`}
                                className="border-border/70 bg-muted/20 rounded-none border px-3 py-2"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-semibold">
                                    {indicator.name}
                                  </span>
                                  <span
                                    className={
                                      indicator.signal === "bullish"
                                        ? "text-emerald-600 dark:text-emerald-400"
                                        : indicator.signal === "bearish"
                                          ? "text-red-500"
                                          : "text-muted-foreground"
                                    }
                                  >
                                    {indicator.signal}
                                  </span>
                                </div>
                                {indicator.value && (
                                  <p className="text-muted-foreground mt-1">
                                    Value: {indicator.value}
                                  </p>
                                )}
                                {indicator.howItWorks && (
                                  <p className="text-muted-foreground mt-1">
                                    How it works: {indicator.howItWorks}
                                  </p>
                                )}
                                {indicator.explanation && (
                                  <p className="text-muted-foreground mt-1">
                                    Why now: {indicator.explanation}
                                  </p>
                                )}
                                {indicator.buySellInference && (
                                  <p className="text-muted-foreground mt-1">
                                    Buy/Sell read: {indicator.buySellInference}
                                  </p>
                                )}
                              </div>
                            ),
                          )}
                        </div>
                      )}

                      {result.aiReview.analysis.riskNotes.length > 0 && (
                        <div className="space-y-1">
                          <p className="text-foreground font-medium">
                            Risk notes
                          </p>
                          {result.aiReview.analysis.riskNotes.map(
                            (note, idx) => (
                              <p
                                key={`${note}-${idx}`}
                                className="text-muted-foreground"
                              >
                                - {note}
                              </p>
                            ),
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
