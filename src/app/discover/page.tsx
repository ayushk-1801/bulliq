"use client";

import React, { useState } from "react";
import { cn } from "~/lib/utils";
import { StockAnalysisLoader } from "~/components/stock-analysis-loader";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";

// ─── Utility helpers ──────────────────────────────────────────────────────────

function fmt(n: number | null | undefined, dec = 2): string {
  if (n == null || isNaN(n as number)) return "N/A";
  return Number(n).toLocaleString("en-IN", { maximumFractionDigits: dec });
}
function fmtPct(n: number | null | undefined): string {
  if (n == null || isNaN(n as number)) return "N/A";
  return `${Number(n) > 0 ? "+" : ""}${Number(n).toFixed(2)}%`;
}
function fmtMult(n: number | null | undefined, mult = 100, dec = 1): string {
  if (n == null || isNaN(n as number)) return "N/A";
  return `${(Number(n) * mult).toFixed(dec)}%`;
}

function signalCls(signal: string | undefined) {
  const s = (signal ?? "").toUpperCase();
  if (s === "BUY") return "text-emerald-400";
  if (s === "SELL") return "text-rose-400";
  return "text-yellow-400";
}
function signalBorder(signal: string | undefined) {
  const s = (signal ?? "").toUpperCase();
  if (s === "BUY") return "border-emerald-500/40 bg-emerald-500/8";
  if (s === "SELL") return "border-rose-500/40 bg-rose-500/8";
  return "border-yellow-500/40 bg-yellow-500/8";
}
function pillCls(signal: string | undefined) {
  const s = (signal ?? "").toUpperCase();
  if (s === "BUY" || s?.includes("BULLISH"))
    return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
  if (s === "SELL" || s?.includes("BEARISH"))
    return "bg-rose-500/15 text-rose-400 border-rose-500/30";
  return "bg-yellow-500/15 text-yellow-400 border-yellow-500/30";
}

// ─── Types (minimal – rely on `unknown` for deep nesting) ─────────────────────

interface NewsItem {
  source: string;
  title: string;
  published_at?: string;
  sentiment_score?: number;
  domain?: string;
  domain_trust?: string;
  url?: string;
  company_name?: string;
}

interface PriceLevel {
  label: string;
  price: number;
  type: string;
}

interface ScoringFactor {
  0: string;
  1: number;
  2: number;
  [k: number]: string | number;
}

interface AnalysisReport {
  report_id: string;
  symbol: string;
  timeframe: string;
  start_timestamp?: string;
  end_timestamp?: string;
  final_signal: string;
  confidence: number;
  confluence_scores: { buy: number; sell: number; no_trade: number };
  risk_plan?: {
    summary?: string;
    llm_reasoning?: string;
    position_size?: number;
    stop_loss?: number;
    target?: number;
    risk_reward?: number;
    detail?: { capital?: number; risk_budget?: number; one_risk?: number; atr?: number };
  };
  final_conclusion?: {
    signal: string;
    confidence: number;
    when_to_buy?: string;
    expected_holding_duration?: string;
    stop_loss?: number;
    targets?: number[];
    target?: number;
    playbook_title?: string;
    thesis?: string;
    execution_style?: string;
    risk_flag?: string;
    invalidation?: string;
    simple_summary?: string;
    simple_explanation?: string;
    beginner_plan?: (string | Record<string, string>)[];
    normal_person_plan?: (string | Record<string, string>)[];
    summary?: string;
    analyst_consensus?: {
      target_price?: number;
      target_high?: number;
      target_low?: number;
      n_analysts?: number;
      implied_upside_pct?: number;
    };
    price_52w?: { high?: number; low?: number; current?: number; position_pct?: number; change_1y_pct?: number };
    key_price_levels?: PriceLevel[];
  };
  long_term_outlook?: {
    stance: string;
    confidence: number;
    score?: number;
    summary?: string;
    llm_reasoning?: string;
    evidence?: {
      history_bars?: number;
      history_start?: string;
      history_end?: string;
      coverage_ratio?: number;
      sparse_long_term?: boolean;
      return_1y_pct?: number;
      return_3y_pct?: number;
      return_5y_pct?: number;
      return_10y_pct?: number;
      cagr_3y_pct?: number;
      cagr_5y_pct?: number;
      cagr_10y_pct?: number;
      price_vs_sma200_pct?: number;
      max_drawdown_5y_pct?: number;
      annualized_volatility_pct?: number;
      news_avg_sentiment?: number;
      news_stock_avg_sentiment?: number;
      news_industry_avg_sentiment?: number;
      news_macro_avg_sentiment?: number;
      stock_news_count?: number;
      industry_news_count?: number;
      macro_news_count?: number;
      sector?: string;
      position_52w_pct?: number;
      change_1y_pct?: number;
      analyst_upside_pct?: number;
      analyst_count?: number;
      held_pct_institutions?: number;
      dividend_yield?: number;
      operating_margins?: number;
      dividend_yield_trend?: string;
      india_sentiment_signal?: string;
      us_trend_signal?: string;
      scoring_factors?: ScoringFactor[];
    };
  };
  agent_outputs?: Record<string, {
    signal: string;
    confidence: number;
    summary: string;
    llm_reasoning?: string;
  }>;
  agent_guidance?: unknown;
  market_setup?: {
    signal: string;
    confidence: number;
    summary?: string;
    setup_label?: string;
    detail?: {
      recent_return_5d_pct?: number;
      recent_return_20d_pct?: number;
      volume_ratio_5d_vs_20d?: number;
      distance_to_support_pct?: number;
      distance_to_resistance_pct?: number;
      momentum_score?: number;
      buy_votes?: number;
      sell_votes?: number;
    };
  };
  catalyst_context?: {
    signal: string;
    confidence: number;
    summary?: string;
    catalyst_label?: string;
    detail?: {
      avg_sentiment?: number;
      analyst_upside_pct?: number;
      position_52w_pct?: number;
      buy_votes?: number;
      sell_votes?: number;
      fundamental_signals?: string[];
    };
  };
  trader_intel?: {
    signal: string;
    confidence: number;
    verdict_label?: string;
    playbook_title?: string;
    thesis?: string;
    execution_style?: string;
    risk_flag?: string;
    entry_trigger?: string;
    invalidation?: string;
    why_now?: string;
    why_not_now?: string;
    risky_intraday_play?: boolean;
    risky_prediction?: { signal: string; confidence: number; text: string };
    summary?: string;
    intraday_execution_easy?: string[];
    intraday_easy_one_liner?: string;
  };
  top_news?: NewsItem[];
  top_industry_news?: NewsItem[];
  top_macro_news?: NewsItem[];
  price_52w?: { high?: number; low?: number; current?: number; position_pct?: number; change_1y_pct?: number };
  analyst_consensus?: {
    target_price?: number;
    target_high?: number;
    target_low?: number;
    n_analysts?: number;
    implied_upside_pct?: number;
  };
  fundamental_signals?: { type: string; text: string }[];
  key_price_levels?: PriceLevel[];
  momentum_score?: number;
  qualitative_labels?: {
    moving_averages?: string;
    trend_channel?: string;
    rsi?: string;
    macd?: string;
    [k: string]: string | undefined;
  };
  valuation_snapshot?: {
    pe_trailing?: number;
    peg_ratio?: number;
    ev_to_ebitda?: number;
    ev_to_revenue?: number;
    gross_margins?: number;
    operating_margins?: number;
    ebitda_margins?: number;
    book_value?: number;
    dividend_yield?: number;
    enterprise_value?: number;
    roe?: number;
    debt_to_equity?: number;
    price_to_book?: number;
    total_revenue?: number;
    total_debt?: number;
    total_cash?: number;
  };
  master_reasoning?: { model?: string; text?: string };
  llm_usage?: {
    calls?: unknown[];
    total_input_tokens?: number;
    total_output_tokens?: number;
    total_tokens?: number;
    pricing?: { input_cost_per_1m?: number; output_cost_per_1m?: number; estimated_total_cost_usd?: number };
  };
  saved_files?: { json?: string; markdown?: string };
  risky_intraday_play?: string;
  asset_bytes_base64?: { chart_png?: string; long_term_chart_png?: string };
  asset_mime_types?: { chart_png?: string; long_term_chart_png?: string };
  rich_report?: string;
  chart_path?: string;
  long_term_chart_path?: string;
}

// ─── Primitive UI atoms ───────────────────────────────────────────────────────

function Pill({ signal, extra }: { signal: string; extra?: string }) {
  return (
    <span className={cn(
      "inline-flex items-center rounded-full border px-2.5 py-0.5 font-mono text-[11px] font-bold tracking-wider uppercase",
      pillCls(signal),
    )}>
      {signal}{extra ? ` · ${extra}` : ""}
    </span>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-4 mt-1 font-mono text-[10px] font-semibold tracking-[0.22em] text-muted-foreground/60 uppercase">
      {children}
    </p>
  );
}

function SectionDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="h-px flex-1 bg-border/40" />
      <span className="font-mono text-[10px] font-bold tracking-[0.25em] text-muted-foreground/50 uppercase">
        {label}
      </span>
      <div className="h-px flex-1 bg-border/40" />
    </div>
  );
}

function Panel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn(
      "rounded-xl border border-border/60 bg-card/50 p-5 backdrop-blur",
      className,
    )}>
      {children}
    </div>
  );
}

function PanelHead({
  title,
  signal,
  extra,
  children,
}: {
  title: string;
  signal?: string;
  extra?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-sm font-semibold text-foreground/90">{title}</h2>
      <div className="flex items-center gap-2">
        {signal && <Pill signal={signal} extra={extra} />}
        {children}
      </div>
    </div>
  );
}

function MiniMetric({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <strong className={cn("font-mono text-sm font-semibold text-foreground", valueClass)}>
        {value}
      </strong>
    </div>
  );
}

function MiniGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
      {children}
    </div>
  );
}

function ConfBar({ value }: { value: number }) {
  const pct = Math.min(Math.max(value * 100, 0), 100);
  const col = pct >= 65 ? "bg-emerald-500" : pct >= 40 ? "bg-yellow-500" : "bg-rose-500";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted/40">
        <div className={cn("h-full rounded-full", col)} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 text-right font-mono text-[10px] text-muted-foreground">
        {pct.toFixed(0)}%
      </span>
    </div>
  );
}

function Collapsible({ summary, children }: { summary: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 py-1.5 text-left text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
      >
        <span className="text-[10px]">{open ? "▼" : "▶"}</span>
        {summary}
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}

function LevelRow({ lvl }: { lvl: PriceLevel }) {
  const isS = lvl.type?.toLowerCase().includes("support");
  const isR = lvl.type?.toLowerCase().includes("resistance");
  return (
    <div className={cn(
      "flex items-center justify-between rounded-lg border px-3 py-2",
      isS && "border-emerald-500/25 bg-emerald-500/5",
      isR && "border-rose-500/25 bg-rose-500/5",
      !isS && !isR && "border-border/40 bg-muted/10",
    )}>
      <span className="text-xs text-muted-foreground">{lvl.label}</span>
      <strong className="font-mono text-sm">₹{fmt(lvl.price)}</strong>
    </div>
  );
}

function levelBucket(lvl: PriceLevel): "resistance" | "support" | "current" | "breakdown" | "other" {
  const text = `${lvl.type ?? ""} ${lvl.label ?? ""}`.toLowerCase();
  if (text.includes("resistance")) return "resistance";
  if (text.includes("support")) return "support";
  if (text.includes("current")) return "current";
  if (text.includes("breakdown")) return "breakdown";
  return "other";
}

function bucketTitle(bucket: ReturnType<typeof levelBucket>) {
  if (bucket === "resistance") return "Resistance";
  if (bucket === "support") return "Support";
  if (bucket === "current") return "Current";
  if (bucket === "breakdown") return "Breakdown";
  return "Other Levels";
}

function bucketStyle(bucket: ReturnType<typeof levelBucket>) {
  if (bucket === "resistance") return "border-rose-500/25 bg-rose-500/5";
  if (bucket === "support") return "border-emerald-500/25 bg-emerald-500/5";
  if (bucket === "current") return "border-sky-500/25 bg-sky-500/5";
  if (bucket === "breakdown") return "border-amber-500/25 bg-amber-500/5";
  return "border-border/40 bg-muted/10";
}

function KeyPriceLevelsSection({ levels }: { levels: PriceLevel[] }) {
  const buckets: Record<ReturnType<typeof levelBucket>, PriceLevel[]> = {
    resistance: [],
    support: [],
    current: [],
    breakdown: [],
    other: [],
  };

  for (const lvl of levels) {
    buckets[levelBucket(lvl)].push(lvl);
  }

  const order: Array<ReturnType<typeof levelBucket>> = ["resistance", "support", "current", "breakdown", "other"];

  return (
    <Panel>
      <PanelHead title="Key Price Levels" />
      <div className="space-y-4">
        {order.map((bucket) => {
          const group = buckets[bucket];
          if (group.length === 0) return null;
          return (
            <div key={bucket}>
              <p className="mb-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                {bucketTitle(bucket)} ({group.length})
              </p>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {group.map((lvl, idx) => (
                  <div
                    key={`${bucket}-${lvl.label}-${idx}`}
                    className={cn("rounded-lg border px-3 py-2", bucketStyle(bucket))}
                  >
                    <p className="text-[11px] text-muted-foreground">{lvl.label}</p>
                    <p className="font-mono text-base font-semibold">₹{fmt(lvl.price)}</p>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function Base64Chart({
  b64,
  mime = "image/png",
  alt,
}: {
  b64: string;
  mime?: string;
  alt: string;
}) {
  return (
    <img
      src={`data:${mime};base64,${b64}`}
      alt={alt}
      className="w-full rounded-lg border border-border/40 object-contain"
      style={{ maxHeight: 480 }}
    />
  );
}

function NewsCard({ items, title }: { items: NewsItem[]; title: string }) {
  return (
    <Panel>
      <PanelHead title={title} />
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No news available in this category.</p>
      ) : (
        <ul className="space-y-2.5">
          {items.map((n, i) => {
          const sc = n.sentiment_score ?? 0;
          const dot =
            sc >= 0.3 ? "bg-emerald-500" : sc <= -0.3 ? "bg-rose-500" : "bg-yellow-500";
          return (
            <li key={i} className="flex items-start gap-2.5 text-sm">
              <span className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", dot)} />
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 leading-snug">{n.title}</p>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
                  <span>{n.source}</span>
                  {n.published_at && (
                    <>
                      <span>·</span>
                      <span>{n.published_at.split("T")[0]}</span>
                    </>
                  )}
                  {n.domain_trust && (
                    <>
                      <span>·</span>
                      <span className="capitalize">{n.domain_trust}</span>
                    </>
                  )}
                  {n.url && (
                    <>
                      <span>·</span>
                      <a
                        href={n.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-400 underline"
                      >
                        open
                      </a>
                    </>
                  )}
                </div>
              </div>
            </li>
          );
          })}
        </ul>
      )}
    </Panel>
  );
}

// ─── Step renderer for plan arrays ───────────────────────────────────────────

function StepList({ steps }: { steps: (string | Record<string, string>)[] }) {
  return (
    <ol className="space-y-2">
      {steps.map((step, i) => {
        const text =
          typeof step === "string"
            ? step
            : Object.values(step)
                .filter(Boolean)
                .join(" — ");
        return (
          <li key={i} className="flex gap-2.5 text-sm">
            <span className="bg-primary/10 text-primary flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-mono text-[10px] font-bold">
              {i + 1}
            </span>
            <span className="leading-relaxed">{text}</span>
          </li>
        );
      })}
    </ol>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

// § 1 HERO
function HeroSection({ d }: { d: AnalysisReport }) {
  const ti = d.trader_intel;
  const fc = d.final_conclusion;
  const p52 = d.price_52w ?? fc?.price_52w;

  return (
    <div className="grid gap-4 md:grid-cols-[1fr_260px]">
      {/* Left copy */}
      <Panel>
        <p className="font-mono text-[11px] tracking-widest text-muted-foreground uppercase">
          {d.symbol} · {d.timeframe} swing map
        </p>
        <h1 className="mt-1 font-mono text-4xl font-bold tracking-tight text-foreground">
          {p52?.current ? `₹${fmt(p52.current)}` : d.symbol}
        </h1>

        {/* timestamp + confluence row */}
        <div className="mt-3 flex flex-wrap gap-2">
          {d.start_timestamp && (
            <span className="rounded-full border border-border/50 bg-muted/30 px-2.5 py-0.5 font-mono text-[11px] text-muted-foreground">
              From {d.start_timestamp}
            </span>
          )}
          {d.end_timestamp && (
            <span className="rounded-full border border-border/50 bg-muted/30 px-2.5 py-0.5 font-mono text-[11px] text-muted-foreground">
              To {d.end_timestamp}
            </span>
          )}
          <span className="rounded-full border border-border/50 bg-muted/30 px-2.5 py-0.5 font-mono text-[11px] text-muted-foreground">
            Confluence B {d.confluence_scores.buy} / S {d.confluence_scores.sell}
          </span>
        </div>

        {/* Thesis strip */}
        {ti?.thesis && (
          <div className="mt-4 rounded-lg border border-border/50 bg-muted/20 px-4 py-3">
            <strong className="block text-xs font-semibold text-muted-foreground">
              {ti.playbook_title ?? fc?.playbook_title ?? "Trader read"}
            </strong>
            <p className="mt-0.5 text-sm leading-relaxed">{ti.thesis}</p>
          </div>
        )}

        {/* Why Now / Why Not Now */}
        {(ti?.why_now ?? ti?.why_not_now) && (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {ti?.why_now && (
              <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-3 py-2.5">
                <p className="mb-0.5 text-[10px] font-bold tracking-widest text-emerald-400 uppercase">Why Now</p>
                <p className="text-xs leading-relaxed">{ti.why_now}</p>
              </div>
            )}
            {ti?.why_not_now && (
              <div className="rounded-lg border border-rose-500/25 bg-rose-500/5 px-3 py-2.5">
                <p className="mb-0.5 text-[10px] font-bold tracking-widest text-rose-400 uppercase">Why Not Now</p>
                <p className="text-xs leading-relaxed">{ti.why_not_now}</p>
              </div>
            )}
          </div>
        )}
      </Panel>

      {/* Verdict card */}
      <Panel className={cn("flex flex-col gap-2 text-center", signalBorder(d.final_signal))}>
        <p className="font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
          Swing verdict
        </p>
        <h2 className={cn("text-2xl font-bold", signalCls(d.final_signal))}>
          {ti?.verdict_label ?? d.final_signal}
        </h2>
        <Pill signal={d.final_signal} />
        <p className="text-xs text-muted-foreground leading-relaxed">
          {ti?.why_now ?? fc?.playbook_title ?? ""}
        </p>
        <div className="mt-auto rounded-lg border border-border/40 bg-muted/20 px-3 py-2 font-mono text-xs">
          Confidence {(d.confidence * 100).toFixed(0)}%
        </div>

        {/* Confluence votes */}
        <div className="grid grid-cols-3 gap-1.5 text-center">
          <div className="rounded border border-emerald-500/25 bg-emerald-500/5 py-1.5">
            <div className="font-mono text-lg font-bold text-emerald-400">{d.confluence_scores.buy}</div>
            <div className="text-[9px] text-muted-foreground">BUY</div>
          </div>
          <div className="rounded border border-rose-500/25 bg-rose-500/5 py-1.5">
            <div className="font-mono text-lg font-bold text-rose-400">{d.confluence_scores.sell}</div>
            <div className="text-[9px] text-muted-foreground">SELL</div>
          </div>
          <div className="rounded border border-yellow-500/25 bg-yellow-500/5 py-1.5">
            <div className="font-mono text-lg font-bold text-yellow-400">{d.confluence_scores.no_trade}</div>
            <div className="text-[9px] text-muted-foreground">WAIT</div>
          </div>
        </div>
      </Panel>
    </div>
  );
}

function cleanSummary(text?: string) {
  if (!text) return "";
  return text
    .replace(/\*\*/g, "")
    .replace(/^FINAL CONCLUSION\s*/i, "")
    .trim();
}

function getIntradayPlanSteps(d: AnalysisReport): (string | Record<string, string>)[] {
  const fromTrader = d.trader_intel?.intraday_execution_easy;
  if (fromTrader && fromTrader.length > 0) return fromTrader;

  const fromNormal = d.final_conclusion?.normal_person_plan;
  if (fromNormal && fromNormal.length > 0) return fromNormal;

  const fromBeginner = d.final_conclusion?.beginner_plan;
  if (fromBeginner && fromBeginner.length > 0) return fromBeginner;

  return [];
}

function toNarrativePoints(text?: string) {
  if (!text) return [] as string[];
  return text
    .replace(/---+/g, "\n")
    .replace(/\r/g, "")
    .split(/\n+/)
    .flatMap((line) => line.split(/\s-\s/g))
    .map((part) => part.trim())
    .filter(Boolean);
}

function cleanReasoningText(text?: string) {
  if (!text) return "";
  return text.replace(/\r/g, "").trim();
}

function ReportSections({ d }: { d: AnalysisReport }) {
  const ti = d.trader_intel;
  const fc = d.final_conclusion;
  const longTerm = d.long_term_outlook;

  const intradayChartB64 = d.asset_bytes_base64?.chart_png;
  const intradayChartMime = d.asset_mime_types?.chart_png ?? "image/png";
  const longTermChartB64 = d.asset_bytes_base64?.long_term_chart_png;
  const longTermChartMime = d.asset_mime_types?.long_term_chart_png ?? "image/png";

  const intradaySteps = getIntradayPlanSteps(d);
  const riskyText = ti?.risky_prediction?.text ?? d.risky_intraday_play;
  const longTermText = longTerm?.summary ?? longTerm?.llm_reasoning;
  const longTermPoints = toNarrativePoints(longTermText);
  const hasAgentReasoning = Object.values(d.agent_outputs ?? {}).some((agent) => Boolean(agent.llm_reasoning));
  const mergedFundamentalSignals = [
    ...(d.fundamental_signals?.map((s) => s.text).filter(Boolean) ?? []),
    ...(d.catalyst_context?.detail?.fundamental_signals?.filter(Boolean) ?? []),
  ];

  return (
    <div className="space-y-6">
      <SectionDivider label="Intraday" />
      <Panel>
        <PanelHead
          title="Intraday Overview"
          signal={d.final_signal}
          extra={`${(d.confidence * 100).toFixed(0)}%`}
        />
        <p className="text-sm leading-relaxed text-foreground/90">
          {ti?.summary ?? cleanSummary(fc?.summary) ?? "Intraday setup summary is unavailable."}
        </p>

        <MiniGrid>
          <MiniMetric label="Momentum score" value={fmt(d.momentum_score, 1)} />
          <MiniMetric
            label="Market setup"
            value={d.market_setup?.signal ?? "N/A"}
            valueClass={signalCls(d.market_setup?.signal)}
          />
          <MiniMetric
            label="Catalyst"
            value={d.catalyst_context?.signal ?? "N/A"}
            valueClass={signalCls(d.catalyst_context?.signal)}
          />
          <MiniMetric
            label="Volatility (ATR)"
            value={fmt(d.risk_plan?.detail?.atr, 2)}
          />
        </MiniGrid>

        {intradayChartB64 && (
          <div className="mt-4">
            <Base64Chart
              b64={intradayChartB64}
              mime={intradayChartMime}
              alt={`${d.symbol} intraday plot`}
            />
          </div>
        )}
      </Panel>

      <SectionDivider label="Intraday Specific Trade Cases" />
      <Panel>
        <PanelHead title="Intraday Specific Trade Cases" signal={d.final_signal} />

        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-3">
            <p className="text-[10px] font-bold tracking-widest text-emerald-400 uppercase">Trigger Case</p>
            <p className="mt-1 text-xs leading-relaxed">
              {fc?.when_to_buy ?? ti?.entry_trigger ?? "Wait for a clear trigger with volume confirmation."}
            </p>
          </div>
          <div className="rounded-lg border border-rose-500/25 bg-rose-500/5 p-3">
            <p className="text-[10px] font-bold tracking-widest text-rose-400 uppercase">Invalidation Case</p>
            <p className="mt-1 text-xs leading-relaxed">
              {fc?.invalidation ?? ti?.invalidation ?? "No invalidation level provided."}
            </p>
          </div>
          <div className="rounded-lg border border-yellow-500/25 bg-yellow-500/5 p-3">
            <p className="text-[10px] font-bold tracking-widest text-yellow-400 uppercase">Risk Case</p>
            <p className="mt-1 text-xs leading-relaxed">
              {fc?.risk_flag ?? ti?.risk_flag ?? ti?.why_not_now ?? "Risk conditions are neutral."}
            </p>
          </div>
        </div>

        {intradaySteps.length > 0 && (
          <div className="mt-4 rounded-lg border border-border/40 bg-muted/10 p-3">
            <p className="mb-2 text-xs font-semibold text-muted-foreground">Execution steps</p>
            <StepList steps={intradaySteps} />
          </div>
        )}

        {!!(fc?.stop_loss || fc?.target || (fc?.targets?.length ?? 0) > 0) && (
          <div className="mt-4 flex flex-wrap items-center gap-2 font-mono text-xs">
            {fc?.stop_loss && (
              <span className="rounded-full border border-rose-500/35 bg-rose-500/8 px-3 py-1">
                Stop ₹{fmt(fc.stop_loss)}
              </span>
            )}
            {(fc?.targets?.length ?? 0) > 0 && (
              <span className="rounded-full border border-emerald-500/35 bg-emerald-500/8 px-3 py-1">
                Targets {fc?.targets?.map((t) => `₹${fmt(t)}`).join(" → ")}
              </span>
            )}
            {!(fc?.targets?.length ?? 0) && fc?.target && (
              <span className="rounded-full border border-emerald-500/35 bg-emerald-500/8 px-3 py-1">
                Target ₹{fmt(fc.target)}
              </span>
            )}
          </div>
        )}

        {/* {intradayChartB64 && (
          <div className="mt-4">
            <Base64Chart
              b64={intradayChartB64}
              mime={intradayChartMime}
              alt={`${d.symbol} intraday trade-case plot`}
            />
          </div>
        )} */}
      </Panel>

      <>
        <SectionDivider label="Intraday Risky Version" />
        <Panel className="border-rose-500/30 bg-rose-500/5">
          <PanelHead
            title="Intraday Risky Version"
            signal={ti?.risky_prediction?.signal ?? d.final_signal}
            extra={
              ti?.risky_prediction?.confidence != null
                ? `${(ti.risky_prediction.confidence * 100).toFixed(0)}%`
                : undefined
            }
          />
          {ti?.intraday_easy_one_liner && (
            <p className="mb-2 rounded-lg border border-border/40 bg-muted/20 px-3 py-2 text-sm">
              {ti.intraday_easy_one_liner}
            </p>
          )}
          <p className="text-sm leading-relaxed text-rose-100/90">
            {riskyText ?? "No dedicated risky intraday setup is available for this report."}
          </p>
          <p className="mt-2 text-[11px] text-rose-200/70">
            High-risk setup: use strict intraday stops and avoid swing allocation.
          </p>

          {intradayChartB64 && (
            <div className="mt-4">
              <Base64Chart
                b64={intradayChartB64}
                mime={intradayChartMime}
                alt={`${d.symbol} risky intraday plot`}
              />
            </div>
          )}
        </Panel>
      </>

      <SectionDivider label="Long Term" />
      <Panel>
        <PanelHead
          title="Long-Term Outlook"
          signal={longTerm?.stance ?? "NO_TRADE"}
          extra={longTerm?.confidence != null ? `${(longTerm.confidence * 100).toFixed(0)}%` : undefined}
        />

        {cleanReasoningText(longTerm?.llm_reasoning) && (
          <div className="mb-4 rounded-xl border border-sky-500/35 bg-sky-500/10 p-4">
            <p className="mb-2 font-mono text-[11px] font-semibold tracking-wide text-sky-300 uppercase">
              Long-Term Desk Reasoning
            </p>
            <p className="text-sm leading-relaxed text-sky-50/95">
              {cleanReasoningText(longTerm?.llm_reasoning)}
            </p>
          </div>
        )}

        {longTermPoints.length > 0 ? (
          <div className="space-y-2">
            <ul className="space-y-1.5">
              {longTermPoints.slice(0, 14).map((point, idx) => (
                <li key={`${idx}-${point.slice(0, 20)}`} className="text-sm leading-relaxed text-foreground/90">
                  • {point}
                </li>
              ))}
            </ul>
            {longTermPoints.length > 14 && (
              <Collapsible summary={`Show ${longTermPoints.length - 14} more long-term points`}>
                <ul className="space-y-1.5">
                  {longTermPoints.slice(14).map((point, idx) => (
                    <li key={`more-${idx}-${point.slice(0, 20)}`} className="text-sm leading-relaxed text-foreground/80">
                      • {point}
                    </li>
                  ))}
                </ul>
              </Collapsible>
            )}
          </div>
        ) : (
          <p className="text-sm leading-relaxed text-foreground/90">Long-term outlook details are unavailable.</p>
        )}

        {longTerm?.evidence && (
          <MiniGrid>
            <MiniMetric label="1Y return" value={fmtPct(longTerm.evidence.return_1y_pct)} />
            <MiniMetric label="3Y return" value={fmtPct(longTerm.evidence.return_3y_pct)} />
            <MiniMetric label="5Y CAGR" value={fmt(longTerm.evidence.cagr_5y_pct, 2)} />
            <MiniMetric label="10Y CAGR" value={fmt(longTerm.evidence.cagr_10y_pct, 2)} />
          </MiniGrid>
        )}

        {longTerm?.evidence && (
          <div className="mt-4 rounded-lg border border-border/40 bg-muted/10 p-3">
            <p className="mb-2 text-xs font-semibold text-muted-foreground">Historical Performance (Detailed)</p>
            <MiniGrid>
              <MiniMetric label="History bars" value={fmt(longTerm.evidence.history_bars, 0)} />
              <MiniMetric label="Coverage" value={fmtMult(longTerm.evidence.coverage_ratio)} />
              <MiniMetric label="1Y return" value={fmtPct(longTerm.evidence.return_1y_pct)} />
              <MiniMetric label="3Y return" value={fmtPct(longTerm.evidence.return_3y_pct)} />
              <MiniMetric label="5Y return" value={fmtPct(longTerm.evidence.return_5y_pct)} />
              <MiniMetric label="10Y return" value={fmtPct(longTerm.evidence.return_10y_pct)} />
              <MiniMetric label="3Y CAGR" value={fmt(longTerm.evidence.cagr_3y_pct, 2)} />
              <MiniMetric label="5Y CAGR" value={fmt(longTerm.evidence.cagr_5y_pct, 2)} />
              <MiniMetric label="10Y CAGR" value={fmt(longTerm.evidence.cagr_10y_pct, 2)} />
              <MiniMetric label="Price vs 200DMA" value={fmtPct(longTerm.evidence.price_vs_sma200_pct)} />
              <MiniMetric label="Max Drawdown 5Y" value={fmtPct(longTerm.evidence.max_drawdown_5y_pct)} />
              <MiniMetric label="Annual Volatility" value={fmtPct(longTerm.evidence.annualized_volatility_pct)} />
            </MiniGrid>
            {(longTerm.evidence.history_start || longTerm.evidence.history_end) && (
              <p className="mt-2 text-xs text-muted-foreground">
                Window: {longTerm.evidence.history_start ?? "N/A"} → {longTerm.evidence.history_end ?? "N/A"}
              </p>
            )}
          </div>
        )}

        <div className="mt-4 rounded-lg border border-border/40 bg-muted/10 p-3">
          <p className="mb-2 text-xs font-semibold text-muted-foreground">Financial Snapshot</p>
          <MiniGrid>
            <MiniMetric label="P/E" value={fmt(d.valuation_snapshot?.pe_trailing, 2)} />
            <MiniMetric label="Price/Book" value={fmt(d.valuation_snapshot?.price_to_book, 2)} />
            <MiniMetric label="ROE" value={fmtMult(d.valuation_snapshot?.roe)} />
            <MiniMetric label="Debt/Equity" value={fmt(d.valuation_snapshot?.debt_to_equity, 2)} />
            <MiniMetric label="Op. Margin" value={fmtMult(d.valuation_snapshot?.operating_margins)} />
            <MiniMetric label="Dividend Yield" value={fmtMult(d.valuation_snapshot?.dividend_yield)} />
            <MiniMetric label="52w Position" value={fmtMult(d.price_52w?.position_pct, 1, 1)} />
            <MiniMetric label="Analyst Upside" value={fmtPct(d.analyst_consensus?.implied_upside_pct)} />
            <MiniMetric label="Total Revenue" value={fmt(d.valuation_snapshot?.total_revenue, 0)} />
            <MiniMetric label="Total Debt" value={fmt(d.valuation_snapshot?.total_debt, 0)} />
            <MiniMetric label="Total Cash" value={fmt(d.valuation_snapshot?.total_cash, 0)} />
            <MiniMetric label="EV/Revenue" value={fmt(d.valuation_snapshot?.ev_to_revenue, 2)} />
            <MiniMetric label="EV/EBITDA" value={fmt(d.valuation_snapshot?.ev_to_ebitda, 2)} />
            <MiniMetric label="Gross Margin" value={fmtMult(d.valuation_snapshot?.gross_margins)} />
          </MiniGrid>
        </div>

        <div className="mt-4 rounded-lg border border-border/40 bg-muted/10 p-3">
          <p className="mb-2 text-xs font-semibold text-muted-foreground">Fundamental Signals (Detailed)</p>
          {mergedFundamentalSignals.length > 0 ? (
            <ul className="space-y-1.5">
              {mergedFundamentalSignals.map((signal, idx) => (
                <li key={`${idx}-${signal.slice(0, 20)}`} className="text-sm leading-relaxed text-foreground/90">
                  • {signal}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No explicit fundamental signals were returned in this report.</p>
          )}
        </div>

        <div className="mt-4 rounded-lg border border-border/40 bg-muted/10 p-3">
          <p className="mb-2 text-xs font-semibold text-muted-foreground">LLM Reasoning (Detailed)</p>

          {cleanReasoningText(d.risk_plan?.llm_reasoning) && (
            <Collapsible summary="Risk-plan reasoning">
              <pre className="overflow-x-auto whitespace-pre-wrap text-xs leading-relaxed text-foreground/90">
                {cleanReasoningText(d.risk_plan?.llm_reasoning)}
              </pre>
            </Collapsible>
          )}

          {hasAgentReasoning && (
            <Collapsible summary="Agent reasoning blocks">
              <div className="space-y-3">
                {Object.entries(d.agent_outputs ?? {}).map(([name, agent]) => {
                  if (!agent.llm_reasoning) return null;
                  return (
                    <div key={name} className="rounded-lg border border-border/35 bg-background/30 p-2.5">
                      <p className="mb-1 font-mono text-[11px] font-semibold uppercase">
                        {name} · {agent.signal} · {(agent.confidence * 100).toFixed(0)}%
                      </p>
                      <pre className="overflow-x-auto whitespace-pre-wrap text-xs leading-relaxed text-foreground/90">
                        {cleanReasoningText(agent.llm_reasoning)}
                      </pre>
                    </div>
                  );
                })}
              </div>
            </Collapsible>
          )}

          {!cleanReasoningText(longTerm?.llm_reasoning) &&
            !cleanReasoningText(d.risk_plan?.llm_reasoning) &&
            !hasAgentReasoning && (
              <p className="text-sm text-muted-foreground">No detailed reasoning text was returned by the analysis payload.</p>
            )}
        </div>

        {(longTermChartB64 || intradayChartB64) && (
          <div className="mt-4">
            <Base64Chart
              b64={longTermChartB64 ?? intradayChartB64!}
              mime={longTermChartB64 ? longTermChartMime : intradayChartMime}
              alt={`${d.symbol} long-term plot`}
            />
          </div>
        )}
      </Panel>
    </div>
  );
}

export default function DiscoverPage() {
  const [symbol, setSymbol] = useState("Reliance");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<AnalysisReport | null>(null);

  async function runAnalysis(e: React.FormEvent) {
    e.preventDefault();
    const cleaned = symbol.trim();
    if (!cleaned) {
      setError("Please enter a stock name.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stock_symbol: cleaned }),
      });

      const data = (await res.json()) as AnalysisReport & { error?: string; detail?: string };
      if (!res.ok) {
        throw new Error(data.error ?? data.detail ?? `Request failed with status ${res.status}`);
      }

      setReport(data);
    } catch (err) {
      setReport(null);
      setError(err instanceof Error ? err.message : "Something went wrong while running analysis.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main
      className={cn(
        "mx-auto flex w-full max-w-6xl flex-col space-y-6 px-4 py-6 sm:px-6 lg:px-8",
        !report && !loading && !error && "min-h-[calc(100vh-5rem)] justify-center",
      )}
    >
      <section className="w-full max-w-4xl self-center rounded-2xl border border-border/70 bg-linear-to-b from-card/70 to-card/35 p-5 shadow-sm backdrop-blur">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] font-semibold tracking-[0.22em] text-muted-foreground/70 uppercase">
              Discover
            </p>
            <h1 className="mt-1 text-lg font-semibold tracking-tight text-foreground">AI Stock Discovery</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Enter a stock name to generate intraday and long-term analysis.
            </p>
          </div>
          <span className="rounded-full border border-border/60 bg-muted/20 px-2.5 py-1 font-mono text-[10px] text-muted-foreground">
            Live analysis
          </span>
        </div>

        <form onSubmit={runAnalysis} className="space-y-2">
          <label htmlFor="discover-symbol" className="block text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Stock name
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="discover-symbol"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              placeholder="e.g. Reliance, TCS, Infosys"
              autoComplete="off"
              className="h-11 flex-1 rounded-xl border-border/70 bg-background/70 px-3.5 text-sm"
            />
            <Button type="submit" disabled={loading} className="h-11 rounded-xl px-5 sm:min-w-40">
              {loading ? "Analyzing..." : "Analyze Stock"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground/85">
            Tip: You can use common names like Reliance or ticker formats like RELIANCE.NS.
          </p>
        </form>
      </section>

      {loading && <StockAnalysisLoader symbol={symbol.trim() || "Stock"} />}

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {report && (
        <>
          <HeroSection d={report} />
          <ReportSections d={report} />

          <div className="space-y-4">
            {(report.key_price_levels?.length ?? 0) > 0 && (
              <KeyPriceLevelsSection levels={report.key_price_levels!} />
            )}

            <SectionDivider label="News By Category" />
            <div className="grid gap-4 xl:grid-cols-3">
              <NewsCard items={report.top_news ?? []} title="Company News" />
              <NewsCard items={report.top_industry_news ?? []} title="Industry News" />
              <NewsCard items={report.top_macro_news ?? []} title="Macro News" />
            </div>
          </div>
        </>
      )}
    </main>
  );
}
