"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  type CandlestickData,
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  type Time,
  type UTCTimestamp,
  createChart,
  type HistogramData,
} from "lightweight-charts";

type ChartPoint = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
};

type StockCandlestickChartProps = {
  points: ChartPoint[];
  startDate?: string;
};

function toUtcTimestamp(dateOnly: string): UTCTimestamp {
  return Math.floor(new Date(`${dateOnly}T00:00:00.000Z`).getTime() / 1000) as UTCTimestamp;
}

function toDateOnlyFromChartTime(time: Time): string {
  if (typeof time === "number") {
    return new Date(time * 1000).toISOString().slice(0, 10);
  }

  if (typeof time === "string") {
    return time;
  }

  if ("year" in time && "month" in time && "day" in time) {
    const month = String(time.month).padStart(2, "0");
    const day = String(time.day).padStart(2, "0");
    return `${time.year}-${month}-${day}`;
  }

  return String(time);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(value);
}

function formatVolume(value: number | null): string {
  if (value === null || value <= 0) return "-";
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(value);
}

export function StockCandlestickChart({ points, startDate }: StockCandlestickChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [hoverPoint, setHoverPoint] = useState<ChartPoint | null>(null);
  const [startLineX, setStartLineX] = useState<number | null>(null);

  const latestPoint = useMemo(() => points.at(-1) ?? null, [points]);

  useEffect(() => {
    setHoverPoint(latestPoint);
  }, [latestPoint]);

  useEffect(() => {
    if (!containerRef.current || points.length === 0) {
      return;
    }

    const startTimestamp = startDate ? toUtcTimestamp(startDate) : null;

    const dateByTimestamp = new Map<number, string>();
    const volumeByDate = new Map<string, number | null>();
    for (const point of points) {
      const timestamp = toUtcTimestamp(point.time);
      dateByTimestamp.set(timestamp, point.time);
      volumeByDate.set(point.time, point.volume);
    }

    const chart: IChartApi = createChart(containerRef.current, {
      autoSize: true,
      height: 520,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#6b7280",
      },
      rightPriceScale: {
        borderVisible: false,
      },
      timeScale: {
        borderVisible: false,
      },
      grid: {
        vertLines: { color: "rgba(107, 114, 128, 0.12)" },
        horzLines: { color: "rgba(107, 114, 128, 0.12)" },
      },
      localization: {
        priceFormatter: (price: number) => price.toFixed(2),
      },
      crosshair: {
        vertLine: { color: "rgba(107, 114, 128, 0.4)" },
        horzLine: { color: "rgba(107, 114, 128, 0.4)" },
      },
    });

    const candlestickSeries: ISeriesApi<"Candlestick"> = chart.addSeries(CandlestickSeries, {
      upColor: "#10b981",
      downColor: "#ef4444",
      borderVisible: false,
      wickUpColor: "#10b981",
      wickDownColor: "#ef4444",
    });

    const volumeSeries: ISeriesApi<"Histogram"> = chart.addSeries(HistogramSeries, {
      color: "rgba(107, 114, 128, 0.3)",
      priceScaleId: "volume",
    });

    chart.priceScale("volume").applyOptions({
      scaleMargins: {
        top: 0.7,
        bottom: 0,
      },
    });

    const candleData: CandlestickData<UTCTimestamp>[] = points.map((point) => ({
      time: toUtcTimestamp(point.time),
      open: point.open,
      high: point.high,
      low: point.low,
      close: point.close,
    }));

    const volumeData: HistogramData<UTCTimestamp>[] = points
      .map((point) => ({
        time: toUtcTimestamp(point.time),
        value: point.volume ?? 0,
        color: point.close >= point.open ? "rgba(16, 185, 129, 0.5)" : "rgba(239, 68, 68, 0.5)",
      }))
      .filter((data) => data.value > 0);

    candlestickSeries.setData(candleData);
    volumeSeries.setData(volumeData);
    chart.timeScale().fitContent();

    const updateStartLine = () => {
      if (!startTimestamp) {
        setStartLineX(null);
        return;
      }

      const coordinate = chart.timeScale().timeToCoordinate(startTimestamp);
      setStartLineX(typeof coordinate === "number" ? coordinate : null);
    };

    updateStartLine();
    chart.timeScale().subscribeVisibleTimeRangeChange(updateStartLine);

    chart.subscribeCrosshairMove((param) => {
      if (!param.time) {
        setHoverPoint(points.at(-1) ?? null);
        return;
      }

      const candle = param.seriesData.get(candlestickSeries) as
        | CandlestickData<UTCTimestamp>
        | undefined;

      if (!candle || !("open" in candle)) {
        setHoverPoint(points.at(-1) ?? null);
        return;
      }

      const dateOnly =
        typeof param.time === "number"
          ? (dateByTimestamp.get(param.time) ?? toDateOnlyFromChartTime(param.time))
          : toDateOnlyFromChartTime(param.time);

      setHoverPoint({
        time: dateOnly,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: volumeByDate.get(dateOnly) ?? null,
      });
    });

    return () => {
      chart.timeScale().unsubscribeVisibleTimeRangeChange(updateStartLine);
      chart.remove();
    };
  }, [points, startDate]);

  if (points.length === 0) {
    return (
      <div className="flex h-128 items-center justify-center rounded-none border border-border/70 bg-muted/30 text-xs text-muted-foreground">
        No OHLC data available for selected period.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-none border border-border/70 bg-muted/20 px-3 py-2 text-xs">
        <span className="text-muted-foreground">Date: <span className="font-medium text-foreground">{hoverPoint?.time ?? "-"}</span></span>
        <span className="text-muted-foreground">Open: <span className="font-medium text-foreground">{hoverPoint ? formatNumber(hoverPoint.open) : "-"}</span></span>
        <span className="text-muted-foreground">High: <span className="font-medium text-foreground">{hoverPoint ? formatNumber(hoverPoint.high) : "-"}</span></span>
        <span className="text-muted-foreground">Low: <span className="font-medium text-foreground">{hoverPoint ? formatNumber(hoverPoint.low) : "-"}</span></span>
        <span className="text-muted-foreground">Close: <span className="font-medium text-foreground">{hoverPoint ? formatNumber(hoverPoint.close) : "-"}</span></span>
        <span className="text-muted-foreground">Volume: <span className="font-medium text-foreground">{hoverPoint ? formatVolume(hoverPoint.volume) : "-"}</span></span>
      </div>
      <div className="relative h-128 w-full">
        <div ref={containerRef} className="h-128 w-full" />
        {startLineX !== null ? (
          <>
            <div
              className="pointer-events-none absolute inset-y-0 border-l border-amber-500/90"
              style={{ left: `${startLineX}px` }}
            />
            <div
              className="pointer-events-none absolute top-2 -translate-x-1/2 rounded-none bg-amber-500 px-1.5 py-0.5 text-[10px] font-medium text-amber-950"
              style={{ left: `${startLineX}px` }}
            >
              Start
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
