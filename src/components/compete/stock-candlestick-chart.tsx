"use client";

import { useEffect, useRef } from "react";
import {
  CandlestickSeries,
  HistogramSeries,
  ColorType,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type HistogramData,
  type UTCTimestamp,
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
};

function toUtcTimestamp(dateOnly: string): UTCTimestamp {
  return Math.floor(new Date(`${dateOnly}T00:00:00.000Z`).getTime() / 1000) as UTCTimestamp;
}

export function StockCandlestickChart({ points }: StockCandlestickChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!containerRef.current || points.length === 0) {
      return;
    }

    const chart: IChartApi = createChart(containerRef.current, {
      autoSize: true,
      height: 400,
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

    return () => {
      chart.remove();
    };
  }, [points]);

  if (points.length === 0) {
    return (
      <div className="flex h-60 items-center justify-center rounded-none border border-border/70 bg-muted/30 text-xs text-muted-foreground">
        No OHLC data available for selected period.
      </div>
    );
  }

  return <div ref={containerRef} className="h-60 w-full" />;
}
