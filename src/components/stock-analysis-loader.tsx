"use client";

import React, { useEffect, useState } from "react";
import { cn } from "~/lib/utils";

// ─── Scrolling ticker tape data ───────────────────────────────────────────────
const TICKER_ITEMS = [
  { symbol: "NIFTY 50", price: "24,832.15", change: "+0.42%", up: true },
  { symbol: "SENSEX", price: "81,520.30", change: "+0.38%", up: true },
  { symbol: "RELIANCE", price: "2,945.60", change: "+1.12%", up: true },
  { symbol: "TCS", price: "3,812.45", change: "-0.27%", up: false },
  { symbol: "INFY", price: "1,634.80", change: "+0.55%", up: true },
  { symbol: "HDFCBANK", price: "1,724.90", change: "-0.14%", up: false },
  { symbol: "ICICIBANK", price: "1,312.35", change: "+0.73%", up: true },
  { symbol: "BHARTIARTL", price: "1,875.20", change: "+2.01%", up: true },
  { symbol: "ITC", price: "468.75", change: "+0.19%", up: true },
  { symbol: "WIPRO", price: "541.10", change: "-0.63%", up: false },
  { symbol: "AXISBANK", price: "1,198.55", change: "+0.94%", up: true },
  { symbol: "LT", price: "3,654.00", change: "+1.30%", up: true },
  { symbol: "KOTAKBANK", price: "2,074.40", change: "-0.08%", up: false },
  { symbol: "BAJFINANCE", price: "7,210.85", change: "+0.66%", up: true },
  { symbol: "SBIN", price: "812.30", change: "+0.47%", up: true },
  { symbol: "HINDUNILVR", price: "2,389.10", change: "-0.31%", up: false },
  { symbol: "MARUTI", price: "12,540.75", change: "+1.88%", up: true },
  { symbol: "TATAMOTORS", price: "872.40", change: "+2.34%", up: true },
  { symbol: "POWERGRID", price: "318.60", change: "-0.22%", up: false },
  { symbol: "ADANIENT", price: "2,612.30", change: "+1.05%", up: true },
];

// ─── Sequential analysis steps ────────────────────────────────────────────────
const LOADING_STEPS = [
  { label: "Fetching live market data", icon: "📡" },
  { label: "Running technical indicators (RSI · MACD · Stoch)", icon: "📊" },
  { label: "Scanning candlestick patterns", icon: "🕯️" },
  { label: "Identifying key price levels", icon: "🎯" },
  { label: "Analysing news & sentiment", icon: "📰" },
  { label: "Evaluating macro & US market trends", icon: "🌍" },
  { label: "Checking relative strength vs NIFTY", icon: "💪" },
  { label: "Analysing fundamentals & earnings", icon: "💰" },
  { label: "Generating AI risk plan", icon: "🛡️" },
  { label: "Composing final trading conclusion", icon: "⚡" },
];

// ─── Decorative candlestick data ──────────────────────────────────────────────
const CANDLES = [
  { open: 38, close: 55, high: 62, low: 32, up: true },
  { open: 53, close: 44, high: 58, low: 40, up: false },
  { open: 44, close: 63, high: 70, low: 40, up: true },
  { open: 61, close: 50, high: 66, low: 46, up: false },
  { open: 50, close: 72, high: 78, low: 46, up: true },
  { open: 70, close: 58, high: 76, low: 53, up: false },
  { open: 58, close: 78, high: 84, low: 54, up: true },
  { open: 76, close: 62, high: 82, low: 58, up: false },
  { open: 62, close: 82, high: 88, low: 58, up: true },
  { open: 80, close: 68, high: 86, low: 64, up: false },
  { open: 68, close: 86, high: 92, low: 64, up: true },
  { open: 84, close: 74, high: 90, low: 70, up: false },
  { open: 74, close: 90, high: 96, low: 70, up: true },
  { open: 88, close: 78, high: 94, low: 74, up: false },
];

// ─── Mini sparkline numbers (fake price series) ───────────────────────────────
const SPARKLINE = [42, 45, 43, 50, 48, 55, 53, 60, 57, 65, 62, 70, 68, 75, 80];

function CandlestickChart() {
  const CHART_H = 88;
  const COL_W = 16;
  const GAP = 4;

  return (
    <div className="relative flex h-[88px] items-end overflow-hidden">
      <div className="flex items-end gap-[4px]">
        {CANDLES.map((c, i) => {
          const bodyTop = Math.min(c.open, c.close);
          const bodyH = Math.abs(c.close - c.open);

          const wickTopPx = CHART_H - (c.high / 100) * CHART_H;
          const wickBotPx = CHART_H - (c.low / 100) * CHART_H;
          const bodyTopPx = CHART_H - ((bodyTop + bodyH) / 100) * CHART_H;
          const bodyHPx = Math.max((bodyH / 100) * CHART_H, 3);

          return (
            <div
              key={i}
              className="relative flex-shrink-0 opacity-0"
              style={{
                width: COL_W,
                height: CHART_H,
                animation: `fadeInUp 0.35s ease forwards`,
                animationDelay: `${i * 60}ms`,
              }}
            >
              {/* Wick */}
              <div
                className={cn(
                  "absolute left-1/2 w-[2px] -translate-x-px rounded-full",
                  c.up ? "bg-emerald-500/60" : "bg-rose-500/60",
                )}
                style={{ top: wickTopPx, height: wickBotPx - wickTopPx }}
              />
              {/* Body */}
              <div
                className={cn(
                  "absolute rounded-[2px]",
                  c.up ? "bg-emerald-500" : "bg-rose-500",
                )}
                style={{
                  left: 3,
                  width: COL_W - 6,
                  top: bodyTopPx,
                  height: bodyHPx,
                }}
              />
            </div>
          );
        })}
      </div>

      {/* Moving average dashed line */}
      <svg
        className="pointer-events-none absolute inset-0"
        width={CANDLES.length * (COL_W + GAP)}
        height={CHART_H}
        viewBox={`0 0 ${CANDLES.length * (COL_W + GAP)} ${CHART_H}`}
      >
        <polyline
          fill="none"
          stroke="rgb(250 204 21 / 0.65)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="4 3"
          points={CANDLES.map((c, i) => {
            const x = i * (COL_W + GAP) + COL_W / 2;
            const y = CHART_H - ((c.open + c.close) / 2 / 100) * CHART_H;
            return `${x},${y}`;
          }).join(" ")}
        />
      </svg>
    </div>
  );
}

function Sparkline() {
  const W = 120;
  const H = 36;
  const max = Math.max(...SPARKLINE);
  const min = Math.min(...SPARKLINE);
  const range = max - min || 1;
  const pts = SPARKLINE.map((v, i) => {
    const x = (i / (SPARKLINE.length - 1)) * W;
    const y = H - ((v - min) / range) * H;
    return `${x},${y}`;
  }).join(" ");

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="opacity-60">
      <defs>
        <linearGradient id="sparkGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="rgb(52 211 153)" stopOpacity="0.4" />
          <stop offset="100%" stopColor="rgb(52 211 153)" stopOpacity="1" />
        </linearGradient>
      </defs>
      <polyline
        fill="none"
        stroke="url(#sparkGrad)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={pts}
      />
    </svg>
  );
}

function TickerTape() {
  const doubled = [...TICKER_ITEMS, ...TICKER_ITEMS];
  return (
    <div className="border-border/40 bg-muted/20 w-full overflow-hidden border-y py-1.5">
      <div
        className="flex gap-8 whitespace-nowrap"
        style={{ animation: "tickerScroll 40s linear infinite" }}
      >
        {doubled.map((item, i) => (
          <span
            key={i}
            className="flex flex-shrink-0 items-center gap-1.5 font-mono text-xs"
          >
            <span className="text-foreground/80 font-semibold">
              {item.symbol}
            </span>
            <span className="text-muted-foreground">{item.price}</span>
            <span
              className={cn(
                "font-medium",
                item.up ? "text-emerald-500" : "text-rose-500",
              )}
            >
              {item.up ? "▲" : "▼"} {item.change}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

interface StockAnalysisLoaderProps {
  symbol: string;
}

export function StockAnalysisLoader({ symbol }: StockAnalysisLoaderProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<number[]>([]);
  const [dots, setDots] = useState(".");

  // Animate dots for the current step label
  useEffect(() => {
    const id = setInterval(() => {
      setDots((d) => (d.length >= 3 ? "." : d + "."));
    }, 400);
    return () => clearInterval(id);
  }, []);

  // Advance steps on a realistic cadence
  useEffect(() => {
    if (currentStep >= LOADING_STEPS.length - 1) return;

    // Each step takes between 2.8s–4.5s to look organic
    const delays = [2800, 3200, 3500, 3000, 4000, 3800, 2900, 4200, 3600, 3000];
    const timeout = delays[currentStep] ?? 3200;

    const id = setTimeout(() => {
      setCompletedSteps((prev) => [...prev, currentStep]);
      setCurrentStep((s) => s + 1);
    }, timeout);

    return () => clearTimeout(id);
  }, [currentStep]);

  const progress = Math.round(
    (completedSteps.length / LOADING_STEPS.length) * 100,
  );

  return (
    <>
      {/* Keyframe injection */}
      <style>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes tickerScroll {
          from { transform: translateX(0); }
          to   { transform: translateX(-50%); }
        }
        @keyframes pulse-ring {
          0%   { transform: scale(1);   opacity: 0.6; }
          50%  { transform: scale(1.4); opacity: 0;   }
          100% { transform: scale(1);   opacity: 0;   }
        }
        @keyframes blink-cursor {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0; }
        }
        @keyframes bar-grow {
          from { width: 0%; }
          to   { width: var(--target-w); }
        }
      `}</style>

      <div className="bg-background flex min-h-[calc(100vh-4rem)] flex-col">
        {/* Ticker tape */}
        <TickerTape />

        {/* Main content */}
        <div className="flex flex-1 items-center justify-center px-4 py-10">
          <div className="w-full max-w-lg space-y-8">
            {/* Header */}
            <div className="space-y-2 text-center">
              <div className="text-muted-foreground border-border/50 bg-muted/30 inline-flex items-center gap-2 rounded-full border px-3 py-1 font-mono text-xs tracking-widest uppercase">
                <span className="relative flex h-2 w-2">
                  <span
                    className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"
                    style={{ animation: "pulse-ring 1.4s ease-out infinite" }}
                  />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                </span>
                Analysing
              </div>

              <h1 className="font-mono text-4xl font-bold tracking-tight">
                {symbol}
                <span
                  className="text-primary ml-1"
                  style={{ animation: "blink-cursor 1s step-end infinite" }}
                >
                  |
                </span>
              </h1>
              <p className="text-muted-foreground text-sm">
                Running multi-agent AI analysis · this takes 1–3 minutes
              </p>
            </div>

            {/* Candlestick chart card */}
            <div className="border-border/60 bg-card/60 rounded-xl border px-5 pt-4 pb-3 backdrop-blur">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-muted-foreground font-mono text-xs tracking-wider uppercase">
                  {symbol} · 1D
                </span>
                <Sparkline />
              </div>
              <CandlestickChart />
              <div className="text-muted-foreground/50 mt-2 flex justify-between font-mono text-[10px]">
                {["Open", "High", "Low", "Close", "Volume"].map((l) => (
                  <span key={l}>{l}</span>
                ))}
              </div>
            </div>

            {/* Progress bar */}
            <div className="space-y-2">
              <div className="text-muted-foreground flex justify-between font-mono text-xs">
                <span>Analysis progress</span>
                <span>{progress}%</span>
              </div>
              <div className="bg-muted/50 h-1.5 w-full overflow-hidden rounded-full">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-emerald-500 via-yellow-400 to-emerald-400 transition-all duration-700 ease-out"
                  style={{ width: `${Math.max(progress, 3)}%` }}
                />
              </div>
            </div>

            {/* Step list */}
            <div className="border-border/50 bg-card/40 divide-border/30 divide-y overflow-hidden rounded-xl border">
              {LOADING_STEPS.map((step, i) => {
                const isDone = completedSteps.includes(i);
                const isActive = i === currentStep;
                const isPending = i > currentStep;

                return (
                  <div
                    key={i}
                    className={cn(
                      "flex items-center gap-3 px-4 py-2.5 text-sm transition-colors duration-300",
                      isDone && "bg-emerald-500/5",
                      isActive && "bg-primary/5",
                      isPending && "opacity-40",
                    )}
                  >
                    {/* Status icon */}
                    <span className="w-5 flex-shrink-0 text-center text-base">
                      {isDone ? (
                        <span className="text-emerald-500">✓</span>
                      ) : isActive ? (
                        <span
                          className="inline-block"
                          style={{
                            animation: "blink-cursor 0.9s step-end infinite",
                          }}
                        >
                          {step.icon}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/40">○</span>
                      )}
                    </span>

                    {/* Label */}
                    <span
                      className={cn(
                        "flex-1 font-mono text-xs",
                        isDone && "text-emerald-400",
                        isActive && "text-foreground",
                        isPending && "text-muted-foreground",
                      )}
                    >
                      {isActive ? `${step.label}${dots}` : step.label}
                    </span>

                    {/* Time badge */}
                    {isDone && (
                      <span className="ml-auto flex-shrink-0 font-mono text-[10px] text-emerald-500/60">
                        done
                      </span>
                    )}
                    {isActive && (
                      <span className="ml-auto flex-shrink-0 animate-pulse font-mono text-[10px] text-yellow-500/80">
                        running
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Bottom disclaimer */}
            <p className="text-muted-foreground/50 text-center font-mono text-[11px]">
              AI-powered analysis is for informational purposes only · not
              financial advice
            </p>
          </div>
        </div>

        {/* Second ticker tape at the bottom */}
        <TickerTape />
      </div>
    </>
  );
}
