"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  LineStyle,
  type UTCTimestamp,
  createChart,
  type CandlestickData,
  type HistogramData,
} from "lightweight-charts";

type MinutePoint = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type IntradayCandlestickChartProps = {
  points: MinutePoint[];
  isStreaming?: boolean;
  /** ISO timestamp – draws a vertical amber "Start" line (the drastic moment) */
  startTime?: string;
  /** Horizontal amber solid line – the trade entry price */
  entryPrice?: number;
  /** Horizontal red dashed line – stop-loss level */
  stopLossPrice?: number;
  /** Horizontal green dashed line – take-profit level */
  takeProfitPrice?: number;
  /**
   * When set, the chart renders a transparent crosshair overlay so the user
   * can click to pick a price for the given level.
   */
  slTpMode?: "sl" | "tp" | null;
  /** Called with the picked price and which level it was for. */
  onPriceSelected?: (price: number, type: "sl" | "tp") => void;
};

function toUtcTimestamp(isoTime: string): UTCTimestamp {
  return Math.floor(new Date(isoTime).getTime() / 1000) as UTCTimestamp;
}

function toCandle(point: MinutePoint): CandlestickData<UTCTimestamp> {
  return {
    time: toUtcTimestamp(point.time),
    open: point.open,
    high: point.high,
    low: point.low,
    close: point.close,
  };
}

function toVolumeBar(point: MinutePoint): HistogramData<UTCTimestamp> {
  return {
    time: toUtcTimestamp(point.time),
    value: point.volume,
    color:
      point.close >= point.open
        ? "rgba(16, 185, 129, 0.5)"
        : "rgba(239, 68, 68, 0.5)",
  };
}

function formatPrice(value: number): string {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(
    value,
  );
}

function formatVolume(value: number): string {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(
    value,
  );
}

function formatTime(isoTime: string): string {
  const date = new Date(isoTime);
  if (Number.isNaN(date.getTime())) return isoTime;
  return new Intl.DateTimeFormat("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(date);
}

export function IntradayCandlestickChart({
  points,
  isStreaming = false,
  startTime,
  entryPrice,
  stopLossPrice,
  takeProfitPrice,
  slTpMode,
  onPriceSelected,
}: IntradayCandlestickChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  // ── Stable chart / series refs (created once on mount) ──────────────────────
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);

  // How many points the chart currently holds (for incremental vs full update)
  const prevPointsLengthRef = useRef<number>(0);

  // Rolling tick counter – throttles fitContent calls during streaming
  const streamingTickRef = useRef<number>(0);

  // Mutable timestamp→point map for the crosshair callback
  const pointByTimestampRef = useRef<Map<number, MinutePoint>>(new Map());

  // Latest point ref – crosshair fallback without stale closures
  const latestPointRef = useRef<MinutePoint | null>(null);

  // ── Start line ───────────────────────────────────────────────────────────────
  const [startLineX, setStartLineX] = useState<number | null>(null);
  const startTimeRef = useRef<string | undefined>(startTime);
  // Stored so the startTime effect can trigger a recalculation after prop update
  const updateStartLineRef = useRef<(() => void) | null>(null);

  // ── Horizontal price line refs ───────────────────────────────────────────────
  const entryLineRef = useRef<IPriceLine | null>(null);
  const slLineRef = useRef<IPriceLine | null>(null);
  const tpLineRef = useRef<IPriceLine | null>(null);
  // Ephemeral preview line shown while hovering in SL/TP pick mode
  const previewLineRef = useRef<IPriceLine | null>(null);
  // Cached price from the most recent mousemove — read on click to avoid
  // a second coordinateToPrice call that can return null on a mousedown/up
  // coordinate mismatch (tiny cursor movement between press and release).
  const previewPriceRef = useRef<number | null>(null);

  // ── Hover state ──────────────────────────────────────────────────────────────
  const [hoverPoint, setHoverPoint] = useState<MinutePoint | null>(null);
  const latestPoint = useMemo(() => points.at(-1) ?? null, [points]);

  useEffect(() => {
    setHoverPoint(latestPoint);
    latestPointRef.current = latestPoint;
  }, [latestPoint]);

  // ── Create the chart exactly once on mount ───────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;

    const chart: IChartApi = createChart(containerRef.current, {
      autoSize: true,
      height: 420,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#6b7280",
      },
      rightPriceScale: { borderVisible: false },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
      },
      grid: {
        vertLines: { color: "rgba(107, 114, 128, 0.12)" },
        horzLines: { color: "rgba(107, 114, 128, 0.12)" },
      },
      localization: { priceFormatter: (price: number) => price.toFixed(2) },
    });

    const candleSeries: ISeriesApi<"Candlestick"> = chart.addSeries(
      CandlestickSeries,
      {
        upColor: "#10b981",
        downColor: "#ef4444",
        borderVisible: false,
        wickUpColor: "#10b981",
        wickDownColor: "#ef4444",
      },
    );

    const volumeSeries: ISeriesApi<"Histogram"> = chart.addSeries(
      HistogramSeries,
      { color: "rgba(107, 114, 128, 0.3)", priceScaleId: "volume" },
    );

    chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.7, bottom: 0 },
    });

    // Crosshair: reads refs at call-time so it never captures stale values
    chart.subscribeCrosshairMove((param) => {
      if (!param.time || typeof param.time !== "number") {
        setHoverPoint(latestPointRef.current);
        return;
      }
      const found = pointByTimestampRef.current.get(param.time);
      setHoverPoint(found ?? latestPointRef.current);
    });

    // Start-line updater: recalculates the pixel X of the vertical start line
    const updateStartLine = () => {
      if (!startTimeRef.current) {
        setStartLineX(null);
        return;
      }
      const ts = toUtcTimestamp(startTimeRef.current);
      const coord = chart.timeScale().timeToCoordinate(ts);
      setStartLineX(typeof coord === "number" ? coord : null);
    };

    chart.timeScale().subscribeVisibleTimeRangeChange(updateStartLine);
    updateStartLineRef.current = updateStartLine;

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;

    return () => {
      chart.timeScale().unsubscribeVisibleTimeRangeChange(updateStartLine);
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      entryLineRef.current = null;
      slLineRef.current = null;
      tpLineRef.current = null;
      previewLineRef.current = null;
      prevPointsLengthRef.current = 0;
      streamingTickRef.current = 0;
      pointByTimestampRef.current = new Map();
      updateStartLineRef.current = null;
    };
  }, []); // intentionally empty – chart is created once

  // ── Update start line when the startTime prop changes ───────────────────────
  useEffect(() => {
    startTimeRef.current = startTime;
    updateStartLineRef.current?.();
  }, [startTime]);

  // ── Push data to the chart whenever points changes ───────────────────────────
  useEffect(() => {
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    if (!chart || !candleSeries || !volumeSeries || points.length === 0) return;

    const prevLen = prevPointsLengthRef.current;

    if (prevLen === 0 || points.length <= prevLen) {
      // ── Full reset: rebuild all series data from scratch ────────────────────
      const candles = points.map(toCandle);
      const volumes = points.map(toVolumeBar);

      pointByTimestampRef.current = new Map();
      for (const pt of points) {
        pointByTimestampRef.current.set(toUtcTimestamp(pt.time), pt);
      }

      candleSeries.setData(candles);
      volumeSeries.setData(volumes);
      chart.timeScale().fitContent();
      streamingTickRef.current = 0;
    } else {
      // ── Incremental: only push the newly appended candles ───────────────────
      const newPoints = points.slice(prevLen);
      for (const pt of newPoints) {
        candleSeries.update(toCandle(pt));
        volumeSeries.update(toVolumeBar(pt));
        pointByTimestampRef.current.set(toUtcTimestamp(pt.time), pt);
      }

      streamingTickRef.current += 1;

      // Throttle fitContent during streaming; always fit on final update
      if (!isStreaming || streamingTickRef.current % 6 === 0) {
        chart.timeScale().fitContent();
      }
    }

    prevPointsLengthRef.current = points.length;
  }, [points, isStreaming]);

  // ── Entry price line ─────────────────────────────────────────────────────────
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;

    if (entryLineRef.current) {
      series.removePriceLine(entryLineRef.current);
      entryLineRef.current = null;
    }
    if (entryPrice != null && !isNaN(entryPrice)) {
      entryLineRef.current = series.createPriceLine({
        price: entryPrice,
        color: "rgba(245, 158, 11, 0.9)",
        lineWidth: 1,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
        title: "Entry",
      });
    }
  }, [entryPrice]);

  // ── Stop-loss price line ─────────────────────────────────────────────────────
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;

    if (slLineRef.current) {
      series.removePriceLine(slLineRef.current);
      slLineRef.current = null;
    }
    if (stopLossPrice != null && !isNaN(stopLossPrice)) {
      slLineRef.current = series.createPriceLine({
        price: stopLossPrice,
        color: "rgba(239, 68, 68, 0.9)",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: "SL",
      });
    }
  }, [stopLossPrice]);

  // ── Clean up preview line when SL/TP pick mode is deactivated ────────────────
  useEffect(() => {
    if (!slTpMode) {
      const series = candleSeriesRef.current;
      if (previewLineRef.current && series) {
        series.removePriceLine(previewLineRef.current);
        previewLineRef.current = null;
      }
    }
  }, [slTpMode]);

  // ── Take-profit price line ───────────────────────────────────────────────────
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;

    if (tpLineRef.current) {
      series.removePriceLine(tpLineRef.current);
      tpLineRef.current = null;
    }
    if (takeProfitPrice != null && !isNaN(takeProfitPrice)) {
      tpLineRef.current = series.createPriceLine({
        price: takeProfitPrice,
        color: "rgba(16, 185, 129, 0.9)",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: "TP",
      });
    }
  }, [takeProfitPrice]);

  if (points.length === 0) {
    return (
      <div className="border-border/70 bg-muted/30 text-muted-foreground flex h-105 items-center justify-center rounded-none border text-xs">
        No intraday candles available.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* OHLCV tooltip bar */}
      <div className="border-border/70 bg-muted/20 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-none border px-3 py-2 text-xs">
        <span className="text-muted-foreground">
          Time:{" "}
          <span className="text-foreground font-medium">
            {hoverPoint ? formatTime(hoverPoint.time) : "-"}
          </span>
        </span>
        <span className="text-muted-foreground">
          O:{" "}
          <span className="text-foreground font-medium">
            {hoverPoint ? formatPrice(hoverPoint.open) : "-"}
          </span>
        </span>
        <span className="text-muted-foreground">
          H:{" "}
          <span className="text-foreground font-medium">
            {hoverPoint ? formatPrice(hoverPoint.high) : "-"}
          </span>
        </span>
        <span className="text-muted-foreground">
          L:{" "}
          <span className="text-foreground font-medium">
            {hoverPoint ? formatPrice(hoverPoint.low) : "-"}
          </span>
        </span>
        <span className="text-muted-foreground">
          C:{" "}
          <span className="text-foreground font-medium">
            {hoverPoint ? formatPrice(hoverPoint.close) : "-"}
          </span>
        </span>
        <span className="text-muted-foreground">
          Vol:{" "}
          <span className="text-foreground font-medium">
            {hoverPoint ? formatVolume(hoverPoint.volume) : "-"}
          </span>
        </span>
      </div>

      {/* Chart container with overlays */}
      <div className="relative h-105 w-full">
        <div ref={containerRef} className="h-105 w-full" />

        {/* Interactive SL/TP price-pick overlay — rendered on top of the chart
            so mouse events are captured without disrupting normal chart pan/zoom
            when the mode is inactive. */}
        {slTpMode && (
          <div
            className="absolute inset-0 z-10 cursor-crosshair"
            onMouseMove={(e) => {
              const series = candleSeriesRef.current;
              if (!series) return;
              const rect = e.currentTarget.getBoundingClientRect();
              const y = e.clientY - rect.top;
              const price = series.coordinateToPrice(y);
              if (price === null) return;

              // Cache the price so onClick can use it without a second
              // coordinate lookup (which can miss if the cursor moved slightly).
              previewPriceRef.current = price;

              // Update the preview line imperatively — no React state → no re-render
              if (previewLineRef.current) {
                series.removePriceLine(previewLineRef.current);
              }
              previewLineRef.current = series.createPriceLine({
                price,
                color:
                  slTpMode === "sl"
                    ? "rgba(239, 68, 68, 0.55)"
                    : "rgba(16, 185, 129, 0.55)",
                lineWidth: 1,
                lineStyle: LineStyle.Dashed,
                axisLabelVisible: true,
                title: slTpMode === "sl" ? "SL?" : "TP?",
              });
            }}
            onMouseLeave={() => {
              previewPriceRef.current = null;
              const series = candleSeriesRef.current;
              if (previewLineRef.current && series) {
                series.removePriceLine(previewLineRef.current);
                previewLineRef.current = null;
              }
            }}
            onClick={(e) => {
              const series = candleSeriesRef.current;
              if (!series || !slTpMode || !onPriceSelected) return;

              // Prefer the price cached from the last mousemove. Fall back to a
              // fresh coordinate lookup only if the cache is empty (e.g. the
              // user clicked without hovering first).
              let price = previewPriceRef.current;
              if (price === null) {
                const rect = e.currentTarget.getBoundingClientRect();
                const y = e.clientY - rect.top;
                price = series.coordinateToPrice(y);
              }
              if (price === null) return;

              // Clean up the preview artefacts before handing control back.
              previewPriceRef.current = null;
              if (previewLineRef.current) {
                series.removePriceLine(previewLineRef.current);
                previewLineRef.current = null;
              }
              onPriceSelected(price, slTpMode);
            }}
          >
            {/* Floating hint badge at the top of the overlay */}
            <div
              className={[
                "pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded-none px-2.5 py-1 text-[11px] font-semibold shadow",
                slTpMode === "sl"
                  ? "bg-red-500 text-white"
                  : "bg-emerald-500 text-white",
              ].join(" ")}
            >
              {slTpMode === "sl"
                ? "Click to set Stop Loss"
                : "Click to set Take Profit"}
            </div>
          </div>
        )}

        {/* Vertical start line */}
        {startLineX !== null && (
          <>
            <div
              className="pointer-events-none absolute inset-y-0 border-l border-amber-500/90"
              style={{ left: `${startLineX}px` }}
            />
            <div
              className="pointer-events-none absolute top-2 -translate-x-1/2 rounded-none bg-amber-500 px-1.5 py-0.5 text-[10px] font-semibold text-amber-950"
              style={{ left: `${startLineX}px` }}
            >
              Start
            </div>
          </>
        )}
      </div>
    </div>
  );
}
