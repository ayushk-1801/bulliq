"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

import { StockCandlestickChart } from "~/components/compete/stock-candlestick-chart";
import { Alert, AlertDescription } from "~/components/ui/alert";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "~/components/ui/accordion";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Progress } from "~/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Spinner } from "~/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";

type StockPoint = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
};

type StockData = {
  symbol: string;
  redactedDate: string | null;
  companyName: string | null;
  points: StockPoint[];
};

type NewsCategory = "finance" | "global" | "company" | "industry";

type NewsArticle = {
  title: string;
  link: string;
  publishedAt: string | null;
  source: string | null;
  rank: number;
};

type StockNews = {
  symbol: string;
  companyName: string | null;
  categories: Record<NewsCategory, NewsArticle[]>;
};

type CompetitionResponse = {
  competition: {
    id: number;
    name: string;
    durationMonths: number;
    startDate: string;
    endDate: string;
    startingCapital: number;
    status: string;
  };
  stocks: StockData[];
  news: StockNews[];
};

type FinancialMetricRow = {
  statementType: string;
  fiscalYear: number;
  metric: string;
  numericValue: number | null;
  rawValue: string | null;
};

type FinancialMetricsResponse = {
  range: {
    startDate: string;
    endDateExclusive: string;
    fiscalYearStart: number;
    fiscalYearEnd: number;
  };
  companies: Array<{
    symbol: string;
    redactedDate: string | null;
    companyName: string | null;
    rows: FinancialMetricRow[];
  }>;
};

type TradeAction = "buy" | "sell";

type CompetitionPhase = "not-started" | "running" | "fast-forwarding" | "ended";

type Holding = {
  quantity: number;
  avgPrice: number;
};

type TradeRecord = {
  id: number;
  action: TradeAction;
  symbol: string;
  quantity: number;
  executedPrice: number;
  totalValue: number;
  candleTime: string;
};

type Summary = {
  startDate: string;
  endDate: string;
  holdingsValue: number;
  portfolioValue: number;
  profitLoss: number;
  returnPct: number;
  rank?: number;
  participantsCount?: number;
  ratingBefore?: number;
  ratingDelta?: number;
  ratingAfter?: number;
};

type LeaderboardEntry = {
  rank: number;
  userId: string;
  name: string;
  image: string | null;
  rating: number;
  competitionsPlayed: number;
  wins: number;
  averageReturnPct: number;
  bestReturnPct: number | null;
  lastRatingDelta: number;
  lastPlayedAt: string | null;
};

type CompetitionStanding = {
  userId: string;
  name: string;
  returnPct: number;
  finalPortfolioValue: number;
  rank: number;
  participantsCount: number;
  ratingDelta: number;
  ratingAfter: number;
  completedAt: string;
};

type LeaderboardResponse = {
  entries: LeaderboardEntry[];
  competitionStandings?: CompetitionStanding[];
};

const COMPETITION_DURATION_SECONDS = 60 * 60;
const FAST_FORWARD_INTERVAL_MS = 16;
const FAST_FORWARD_TARGET_STEPS = 28;

function formatDate(dateString: string): string {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(value);
}

function formatCapital(value: number): string {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(value);
}

function formatTimer(totalSeconds: number): string {
  const safe = Math.max(0, totalSeconds);
  const hours = Math.floor(safe / 3600)
    .toString()
    .padStart(2, "0");
  const minutes = Math.floor((safe % 3600) / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (safe % 60).toString().padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

function formatSignedNumber(value: number): string {
  return `${value > 0 ? "+" : ""}${formatNumber(value)}`;
}

function formatNewsDate(dateString: string | null): string {
  if (!dateString) return "-";

  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return dateString;

  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function computeChangePercent(points: StockPoint[]): number {
  if (points.length < 2) return 0;
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last || first.close === 0) return 0;
  return ((last.close - first.close) / first.close) * 100;
}

function computeHigh(points: StockPoint[]): number {
  if (points.length === 0) return 0;
  return Math.max(...points.map((point) => point.high));
}

function computeLow(points: StockPoint[]): number {
  if (points.length === 0) return 0;
  return Math.min(...points.map((point) => point.low));
}

function formatFinancialMetricValue(row: FinancialMetricRow): string {
  if (row.numericValue !== null) {
    return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(
      row.numericValue,
    );
  }

  return row.rawValue ?? "-";
}

function groupFinancialRows(rows: FinancialMetricRow[]) {
  const byStatement = new Map<
    string,
    {
      years: Set<number>;
      metrics: Map<string, Map<number, FinancialMetricRow>>;
    }
  >();

  for (const row of rows) {
    const statementBucket = byStatement.get(row.statementType) ?? {
      years: new Set<number>(),
      metrics: new Map<string, Map<number, FinancialMetricRow>>(),
    };

    statementBucket.years.add(row.fiscalYear);
    const metricBucket =
      statementBucket.metrics.get(row.metric) ?? new Map<number, FinancialMetricRow>();
    metricBucket.set(row.fiscalYear, row);
    statementBucket.metrics.set(row.metric, metricBucket);
    byStatement.set(row.statementType, statementBucket);
  }

  return Array.from(byStatement.entries())
    .map(([statementType, bucket]) => ({
      statementType,
      years: Array.from(bucket.years).sort((a, b) => b - a),
      metrics: Array.from(bucket.metrics.entries())
        .sort(([metricA], [metricB]) => metricA.localeCompare(metricB))
        .map(([metric, yearMap]) => ({ metric, yearMap })),
    }))
    .sort((a, b) => a.statementType.localeCompare(b.statementType));
}

export default function CompetitionDetailPage() {
  const params = useParams<{ duration: string; competitionId: string }>();

  const [data, setData] = useState<CompetitionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedStock, setSelectedStock] = useState<string>("");
  const [selectedNewsSymbol, setSelectedNewsSymbol] = useState<string>("");
  const [action, setAction] = useState<TradeAction>("buy");
  const [quantity, setQuantity] = useState<string>("10");
  const [orderType, setOrderType] = useState<"market" | "limit">("market");
  const [limitPrice, setLimitPrice] = useState<string>("");

  const [phase, setPhase] = useState<CompetitionPhase>("not-started");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [simulationIndex, setSimulationIndex] = useState(0);
  const [cash, setCash] = useState(0);
  const [holdings, setHoldings] = useState<Record<string, Holding>>({});
  const [tradeLog, setTradeLog] = useState<TradeRecord[]>([]);
  const [tradeMessage, setTradeMessage] = useState<{
    type: "default" | "destructive";
    text: string;
  } | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [resultSyncMessage, setResultSyncMessage] = useState<string | null>(null);
  const [leaderboardEntries, setLeaderboardEntries] = useState<LeaderboardEntry[]>([]);
  const [competitionStandings, setCompetitionStandings] = useState<CompetitionStanding[]>([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [leaderboardError, setLeaderboardError] = useState<string | null>(null);
  const [submittingResult, setSubmittingResult] = useState(false);
  const startTimestampRef = useRef<number | null>(null);
  const submittedCompetitionKeyRef = useRef<string | null>(null);

  const [financialCompanies, setFinancialCompanies] = useState<
    FinancialMetricsResponse["companies"]
  >([]);
  const [financialRange, setFinancialRange] = useState<FinancialMetricsResponse["range"] | null>(
    null,
  );
  const [financialLoading, setFinancialLoading] = useState(false);
  const [financialError, setFinancialError] = useState<string | null>(null);
  const [companyFilter, setCompanyFilter] = useState<string>("all");
  const [statementFilter, setStatementFilter] = useState<string>("all");

  useEffect(() => {
    let isMounted = true;

    const loadCompetition = async () => {
      const competitionId = params.competitionId;

      if (!competitionId) {
        if (isMounted) {
          setError("Invalid competition id.");
          setLoading(false);
        }
        return;
      }

      try {
        setLoading(true);
        const response = await fetch(`/api/competitions/${competitionId}`, {
          method: "GET",
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error(`Failed to load competition (${response.status})`);
        }

        const payload = (await response.json()) as CompetitionResponse;

        if (isMounted) {
          setData(payload);
          setError(null);
          setSelectedStock(payload.stocks[0]?.symbol ?? "");
          setSelectedNewsSymbol(payload.news[0]?.symbol ?? payload.stocks[0]?.symbol ?? "");
          setLimitPrice((payload.stocks[0]?.points[0]?.close ?? 0).toFixed(2));

          setPhase("not-started");
          setElapsedSeconds(0);
          setSimulationIndex(0);
          setCash(payload.competition.startingCapital);
          setHoldings({});
          setTradeLog([]);
          setTradeMessage(null);
          setSummary(null);
          setResultSyncMessage(null);
          submittedCompetitionKeyRef.current = null;
          startTimestampRef.current = null;
        }
      } catch (err) {
        if (isMounted) {
          setError("Unable to load competition data.");
          console.error(err);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    void loadCompetition();

    return () => {
      isMounted = false;
    };
  }, [params.competitionId]);

  const loadLeaderboard = useCallback(async () => {
    const competitionId = params.competitionId;
    if (!competitionId) {
      setLeaderboardEntries([]);
      setCompetitionStandings([]);
      return;
    }

    try {
      setLeaderboardLoading(true);
      const response = await fetch(
        `/api/leaderboard?limit=20&competitionId=${encodeURIComponent(competitionId)}`,
        {
          method: "GET",
          cache: "no-store",
        },
      );

      if (!response.ok) {
        throw new Error(`Failed to load leaderboard (${response.status})`);
      }

      const payload = (await response.json()) as LeaderboardResponse;
      setLeaderboardEntries(payload.entries ?? []);
      setCompetitionStandings(payload.competitionStandings ?? []);
      setLeaderboardError(null);
    } catch (err) {
      setLeaderboardError("Unable to load leaderboard.");
      console.error(err);
    } finally {
      setLeaderboardLoading(false);
    }
  }, [params.competitionId]);

  useEffect(() => {
    void loadLeaderboard();
  }, [loadLeaderboard]);

  const submitCompetitionResult = useCallback(
    async (result: Summary) => {
      const competitionId = params.competitionId;
      if (!competitionId) return;

      const key = `${competitionId}:${result.endDate}:${result.portfolioValue.toFixed(2)}`;
      if (submittedCompetitionKeyRef.current === key) {
        return;
      }
      submittedCompetitionKeyRef.current = key;

      try {
        setSubmittingResult(true);
        const response = await fetch(`/api/competitions/${competitionId}/result`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            finalPortfolioValue: result.portfolioValue,
            profitLoss: result.profitLoss,
            returnPct: result.returnPct,
          }),
        });

        if (!response.ok) {
          if (response.status === 401) {
            setResultSyncMessage("Sign in to record rating and leaderboard progress.");
            return;
          }

          throw new Error(`Failed to submit competition result (${response.status})`);
        }

        const payload = (await response.json()) as {
          rank: number;
          participantsCount: number;
          ratingBefore: number;
          ratingDelta: number;
          ratingAfter: number;
        };

        setSummary((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            rank: payload.rank,
            participantsCount: payload.participantsCount,
            ratingBefore: payload.ratingBefore,
            ratingDelta: payload.ratingDelta,
            ratingAfter: payload.ratingAfter,
          };
        });

        setResultSyncMessage("Result saved. Leaderboard updated.");
        await loadLeaderboard();
      } catch (err) {
        setResultSyncMessage("Unable to sync result right now.");
        console.error(err);
      } finally {
        setSubmittingResult(false);
      }
    },
    [loadLeaderboard, params.competitionId],
  );

  useEffect(() => {
    let isMounted = true;

    const loadFinancialMetrics = async () => {
      const competitionId = params.competitionId;

      if (!competitionId) {
        if (isMounted) {
          setFinancialCompanies([]);
          setFinancialRange(null);
          setFinancialError(null);
        }
        return;
      }

      try {
        setFinancialLoading(true);
        const response = await fetch(`/api/competitions/${competitionId}/financial-metrics`, {
          method: "GET",
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error(`Failed to load financial metrics (${response.status})`);
        }

        const payload = (await response.json()) as FinancialMetricsResponse;

        if (isMounted) {
          setFinancialCompanies(payload.companies);
          setFinancialRange(payload.range);
          setFinancialError(null);
          setCompanyFilter("all");
          setStatementFilter("all");
        }
      } catch (err) {
        if (isMounted) {
          setFinancialCompanies([]);
          setFinancialRange(null);
          setFinancialError("Unable to load financial metrics.");
          console.error(err);
        }
      } finally {
        if (isMounted) {
          setFinancialLoading(false);
        }
      }
    };

    void loadFinancialMetrics();

    return () => {
      isMounted = false;
    };
  }, [params.competitionId]);

  const selectedStockData = useMemo(() => {
    if (!data) return null;
    return data.stocks.find((stock) => stock.symbol === selectedStock) ?? null;
  }, [data, selectedStock]);

  const selectedNewsData = useMemo(() => {
    if (!data) return null;
    return data.news.find((stock) => stock.symbol === selectedNewsSymbol) ?? null;
  }, [data, selectedNewsSymbol]);

  const maxSimulationPoints = useMemo(() => {
    if (!data || data.stocks.length === 0) return 1;
    return Math.max(1, ...data.stocks.map((stock) => stock.points.length));
  }, [data]);

  const preStartVisibleIndex = useMemo(() => {
    if (!data || data.stocks.length === 0) return 0;

    const timelineStock = data.stocks.reduce((longest, current) =>
      current.points.length > longest.points.length ? current : longest,
    );

    if (!timelineStock || timelineStock.points.length === 0) return 0;

    const firstAtOrAfterStart = timelineStock.points.findIndex(
      (point) => point.time >= data.competition.startDate,
    );

    if (firstAtOrAfterStart <= 0) {
      return 0;
    }

    return firstAtOrAfterStart - 1;
  }, [data]);

  const visibleIndex = useMemo(() => {
    if (!data) return 0;
    if (phase === "not-started") return preStartVisibleIndex;
    return simulationIndex;
  }, [data, phase, preStartVisibleIndex, simulationIndex]);

  const remainingSeconds = Math.max(0, COMPETITION_DURATION_SECONDS - elapsedSeconds);
  const timerProgress = (elapsedSeconds / COMPETITION_DURATION_SECONDS) * 100;

  const priceBySymbol = useMemo(() => {
    const entries = new Map<string, number>();
    if (!data) return entries;

    for (const stock of data.stocks) {
      if (stock.points.length === 0) continue;
      const pointIndex = Math.min(visibleIndex, stock.points.length - 1);
      const point = stock.points[pointIndex];
      if (!point) continue;
      entries.set(stock.symbol, point.close);
    }

    return entries;
  }, [data, visibleIndex]);

  const selectedVisiblePoints = useMemo(() => {
    if (!selectedStockData || selectedStockData.points.length === 0) return [];
    const upperBound = Math.min(visibleIndex + 1, selectedStockData.points.length);
    return selectedStockData.points.slice(0, Math.max(1, upperBound));
  }, [selectedStockData, visibleIndex]);

  const selectedCurrentPrice = useMemo(() => {
    if (!selectedStock) return 0;
    return priceBySymbol.get(selectedStock) ?? 0;
  }, [selectedStock, priceBySymbol]);

  useEffect(() => {
    if (!selectedStock) return;
    setLimitPrice(selectedCurrentPrice.toFixed(2));
  }, [selectedStock, selectedCurrentPrice]);

  const holdingsValue = useMemo(() => {
    return Object.entries(holdings).reduce((sum, [symbol, holding]) => {
      const currentPrice = priceBySymbol.get(symbol) ?? 0;
      return sum + holding.quantity * currentPrice;
    }, 0);
  }, [holdings, priceBySymbol]);

  const portfolioValue = cash + holdingsValue;
  const netPnL = data ? portfolioValue - data.competition.startingCapital : 0;

  const stockPerformanceRows = useMemo(() => {
    if (!data) return [];

    return data.stocks
      .map((stock) => {
        if (stock.points.length === 0) return null;

        const startIdx = Math.min(preStartVisibleIndex, stock.points.length - 1);
        const endIdx = Math.min(visibleIndex, stock.points.length - 1);

        const startPrice = stock.points[startIdx]?.close ?? 0;
        const endPrice = stock.points[endIdx]?.close ?? 0;
        const change = endPrice - startPrice;
        const changePct = startPrice === 0 ? 0 : (change / startPrice) * 100;

        return {
          symbol: stock.symbol,
          companyName: stock.companyName,
          startPrice,
          endPrice,
          change,
          changePct,
        };
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
      .sort((a, b) => b.changePct - a.changePct);
  }, [data, preStartVisibleIndex, visibleIndex]);

  const holdingsPerformanceRows = useMemo(() => {
    return Object.entries(holdings)
      .map(([symbol, holding]) => {
        const currentPrice = priceBySymbol.get(symbol) ?? 0;
        const investedValue = holding.quantity * holding.avgPrice;
        const currentValue = holding.quantity * currentPrice;
        const gainLoss = currentValue - investedValue;
        const gainLossPct = investedValue === 0 ? 0 : (gainLoss / investedValue) * 100;

        return {
          symbol,
          quantity: holding.quantity,
          avgPrice: holding.avgPrice,
          currentPrice,
          investedValue,
          currentValue,
          gainLoss,
          gainLossPct,
        };
      })
      .sort((a, b) => b.gainLoss - a.gainLoss);
  }, [holdings, priceBySymbol]);

  const tradeFlowSummary = useMemo(() => {
    return tradeLog.reduce(
      (acc, trade) => {
        if (trade.action === "buy") {
          acc.totalBuy += trade.totalValue;
        } else {
          acc.totalSell += trade.totalValue;
        }

        return acc;
      },
      { totalBuy: 0, totalSell: 0 },
    );
  }, [tradeLog]);

  const finalizeCompetition = useCallback(() => {
    if (!data || phase === "ended") return;

    setPhase("ended");
    startTimestampRef.current = null;

    const lastVisibleDate = data.stocks
      .map((stock) => {
        if (stock.points.length === 0) return null;
        const idx = Math.min(visibleIndex, stock.points.length - 1);
        return stock.points[idx]?.time ?? null;
      })
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1);

    const startDate = data.competition.startDate;
    const endDate = lastVisibleDate ?? startDate;

    const currentHoldingsValue = Object.entries(holdings).reduce((sum, [symbol, holding]) => {
      const currentPrice = priceBySymbol.get(symbol) ?? 0;
      return sum + holding.quantity * currentPrice;
    }, 0);

    const currentPortfolioValue = cash + currentHoldingsValue;
    const profitLoss = currentPortfolioValue - data.competition.startingCapital;
    const returnPct =
      data.competition.startingCapital === 0
        ? 0
        : (profitLoss / data.competition.startingCapital) * 100;

    setSummary({
      startDate,
      endDate,
      holdingsValue: currentHoldingsValue,
      portfolioValue: currentPortfolioValue,
      profitLoss,
      returnPct,
    });

    void submitCompetitionResult({
      startDate,
      endDate,
      holdingsValue: currentHoldingsValue,
      portfolioValue: currentPortfolioValue,
      profitLoss,
      returnPct,
    });
  }, [cash, data, holdings, phase, priceBySymbol, submitCompetitionResult, visibleIndex]);

  const endCompetition = () => {
    if (phase !== "running") return;
    setPhase("fast-forwarding");
  };

  useEffect(() => {
    if (phase !== "running") return;

    if (maxSimulationPoints <= 1) {
      finalizeCompetition();
      return;
    }

    startTimestampRef.current ??= Date.now() - elapsedSeconds * 1000;
    setSimulationIndex(preStartVisibleIndex);

    const intervalId = window.setInterval(() => {
      const startTs = startTimestampRef.current;
      if (!startTs) return;

      const elapsed = Math.min(
        COMPETITION_DURATION_SECONDS,
        Math.floor((Date.now() - startTs) / 1000),
      );

      setElapsedSeconds(elapsed);

      if (elapsed >= COMPETITION_DURATION_SECONDS) {
        setPhase("fast-forwarding");
      }
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [
    elapsedSeconds,
    finalizeCompetition,
    maxSimulationPoints,
    phase,
    preStartVisibleIndex,
  ]);

  useEffect(() => {
    if (phase !== "fast-forwarding") return;

    const finalIndex = Math.max(0, maxSimulationPoints - 1);

    if (simulationIndex >= finalIndex) {
      finalizeCompetition();
      return;
    }

    const remaining = Math.max(1, finalIndex - simulationIndex);
    const step = Math.max(1, Math.ceil(remaining / FAST_FORWARD_TARGET_STEPS));

    const intervalId = window.setInterval(() => {
      setSimulationIndex((prev) => {
        const next = Math.min(finalIndex, prev + step);
        if (next >= finalIndex) {
          window.clearInterval(intervalId);
          setTimeout(() => finalizeCompetition(), 0);
        }
        return next;
      });
    }, FAST_FORWARD_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [finalizeCompetition, maxSimulationPoints, phase, simulationIndex]);

  useEffect(() => {
    if (phase !== "not-started") return;
    setSimulationIndex(preStartVisibleIndex);
  }, [phase, preStartVisibleIndex]);

  const startCompetition = () => {
    if (phase !== "not-started") return;

    setTradeMessage(null);
    setSummary(null);
    setElapsedSeconds(0);
    setSimulationIndex(preStartVisibleIndex);
    startTimestampRef.current = Date.now();
    setPhase("running");
  };

  const executeTrade = () => {
    if (!data || phase !== "running") {
      setTradeMessage({ type: "destructive", text: "Start the competition before trading." });
      return;
    }

    if (!selectedStockData) {
      setTradeMessage({ type: "destructive", text: "Select a stock first." });
      return;
    }

    const parsedQuantity = Number.parseInt(quantity, 10);
    if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
      setTradeMessage({ type: "destructive", text: "Quantity must be greater than 0." });
      return;
    }

    const marketPrice = selectedCurrentPrice;
    if (marketPrice <= 0) {
      setTradeMessage({ type: "destructive", text: "No market price available for this tick." });
      return;
    }

    const parsedLimit = Number.parseFloat(limitPrice);
    let executedPrice = marketPrice;

    if (orderType === "limit") {
      if (!Number.isFinite(parsedLimit) || parsedLimit <= 0) {
        setTradeMessage({ type: "destructive", text: "Enter a valid limit price." });
        return;
      }

      if (action === "buy" && parsedLimit < marketPrice) {
        setTradeMessage({
          type: "destructive",
          text: `Buy limit not filled. Current price is ${formatNumber(marketPrice)}.`,
        });
        return;
      }

      if (action === "sell" && parsedLimit > marketPrice) {
        setTradeMessage({
          type: "destructive",
          text: `Sell limit not filled. Current price is ${formatNumber(marketPrice)}.`,
        });
        return;
      }

      executedPrice = marketPrice;
    }

    const totalValue = parsedQuantity * executedPrice;
    const holding = holdings[selectedStockData.symbol];

    if (action === "buy") {
      if (cash < totalValue) {
        setTradeMessage({ type: "destructive", text: "Insufficient budget for this order." });
        return;
      }

      const prevQty = holding?.quantity ?? 0;
      const prevAvg = holding?.avgPrice ?? 0;
      const nextQty = prevQty + parsedQuantity;
      const nextAvg =
        nextQty === 0
          ? 0
          : (prevAvg * prevQty + executedPrice * parsedQuantity) / nextQty;

      setCash((prev) => prev - totalValue);
      setHoldings((prev) => ({
        ...prev,
        [selectedStockData.symbol]: {
          quantity: nextQty,
          avgPrice: nextAvg,
        },
      }));
    } else {
      if (!holding || holding.quantity < parsedQuantity) {
        setTradeMessage({
          type: "destructive",
          text: `Not enough holdings to sell. You own ${holding?.quantity ?? 0} shares.`,
        });
        return;
      }

      const nextQty = holding.quantity - parsedQuantity;
      setCash((prev) => prev + totalValue);
      setHoldings((prev) => {
        if (nextQty <= 0) {
          const nextHoldings = { ...prev };
          delete nextHoldings[selectedStockData.symbol];
          return nextHoldings;
        }

        return {
          ...prev,
          [selectedStockData.symbol]: {
            quantity: nextQty,
            avgPrice: holding.avgPrice,
          },
        };
      });
    }

    const candleTime = selectedVisiblePoints.at(-1)?.time ?? data.competition.startDate;

    setTradeLog((prev) => [
      {
        id: prev.length + 1,
        action,
        symbol: selectedStockData.symbol,
        quantity: parsedQuantity,
        executedPrice,
        totalValue,
        candleTime,
      },
      ...prev,
    ]);

    setTradeMessage({
      type: "default",
      text: `${action.toUpperCase()} order filled for ${selectedStockData.symbol}: ${parsedQuantity} @ ${formatNumber(executedPrice)}.`,
    });
  };

  const estimatedOrderValue = useMemo(() => {
    if (!selectedStockData) return 0;
    const parsedQuantity = Number.parseInt(quantity, 10);
    if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) return 0;

    const marketPrice = selectedCurrentPrice;
    const price = orderType === "market" ? marketPrice : Number.parseFloat(limitPrice) || 0;

    return parsedQuantity * price;
  }, [selectedStockData, quantity, orderType, limitPrice, selectedCurrentPrice]);

  const liveNetPnLPct = useMemo(() => {
    if (!data || data.competition.startingCapital === 0) return 0;
    return (netPnL / data.competition.startingCapital) * 100;
  }, [data, netPnL]);

  const maxOrderQuantity = useMemo(() => {
    if (action === "sell") {
      return holdings[selectedStock]?.quantity ?? 0;
    }

    const parsedLimit = Number.parseFloat(limitPrice);
    const effectivePrice =
      orderType === "market"
        ? selectedCurrentPrice
        : Number.isFinite(parsedLimit) && parsedLimit > 0
          ? parsedLimit
          : selectedCurrentPrice;

    if (effectivePrice <= 0) return 0;
    return Math.max(0, Math.floor(cash / effectivePrice));
  }, [action, cash, holdings, limitPrice, orderType, selectedCurrentPrice, selectedStock]);

  const setMaxQuantity = () => {
    setQuantity(maxOrderQuantity > 0 ? String(maxOrderQuantity) : "0");
  };

  const stockSummaries = useMemo(() => {
    if (!data) return [];

    return data.stocks.map((stock) => {
      const visiblePoints = stock.points.slice(
        0,
        Math.max(1, Math.min(visibleIndex + 1, stock.points.length)),
      );

      const lastPoint = visiblePoints.at(-1);
      return {
        symbol: stock.symbol,
        companyName: stock.companyName,
        pointsCount: visiblePoints.length,
        latestClose: lastPoint?.close ?? 0,
        high: computeHigh(visiblePoints),
        low: computeLow(visiblePoints),
        changePct: computeChangePercent(visiblePoints),
      };
    });
  }, [data, visibleIndex]);

  const companyOptions = useMemo(() => {
    return financialCompanies.map((company) => ({
      symbol: company.symbol,
      companyName: company.companyName,
    }));
  }, [financialCompanies]);

  const statementTypeOptions = useMemo(() => {
    const rows = financialCompanies.flatMap((company) => company.rows);
    return Array.from(new Set(rows.map((row) => row.statementType))).sort();
  }, [financialCompanies]);

  const filteredFinancialCompanies = useMemo(() => {
    const byCompany =
      companyFilter === "all"
        ? financialCompanies
        : financialCompanies.filter((company) => company.symbol === companyFilter);

    return byCompany
      .map((company) => ({
        ...company,
        rows:
          statementFilter === "all"
            ? company.rows
            : company.rows.filter((row) => row.statementType === statementFilter),
      }))
      .filter((company) => company.rows.length > 0);
  }, [financialCompanies, companyFilter, statementFilter]);

  const financialRangeLabel = useMemo(() => {
    if (!financialRange) return "";
    return `${financialRange.startDate} to ${financialRange.endDateExclusive} (exclusive end)`;
  }, [financialRange]);

  const tradePanelContent = (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="border border-border/70 bg-card lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-base font-semibold">Trade Panel</CardTitle>
          <CardDescription>
            Buy and sell using live simulated prices while the competition is running.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="rounded-none border border-border/70 bg-muted/20 p-3">
              <p className="text-xs text-muted-foreground">Cash</p>
              <p className="mt-1 text-base font-semibold">{formatNumber(cash)}</p>
            </div>
            <div className="rounded-none border border-border/70 bg-muted/20 p-3">
              <p className="text-xs text-muted-foreground">Holdings Value</p>
              <p className="mt-1 text-base font-semibold">{formatNumber(holdingsValue)}</p>
            </div>
            <div className="rounded-none border border-border/70 bg-muted/20 p-3">
              <p className="text-xs text-muted-foreground">Net P/L</p>
              <p
                className={`mt-1 text-base font-semibold ${
                  netPnL >= 0 ? "text-green-600" : "text-red-600"
                }`}
              >
                {formatNumber(netPnL)} ({formatNumber(liveNetPnLPct)}%)
              </p>
            </div>
            <div className="rounded-none border border-border/70 bg-muted/20 p-3">
              <p className="text-xs text-muted-foreground">Current Price</p>
              <p className="mt-1 text-base font-semibold">{formatNumber(selectedCurrentPrice)}</p>
              <p className="text-[11px] text-muted-foreground">{selectedStock || "No stock selected"}</p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="mb-1 text-xs text-muted-foreground">Stock</p>
              <Select value={selectedStock} onValueChange={setSelectedStock}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select stock" />
                </SelectTrigger>
                <SelectContent>
                  {(data?.stocks ?? []).map((stock) => (
                    <SelectItem key={stock.symbol} value={stock.symbol}>
                      {stock.symbol}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <p className="mb-1 text-xs text-muted-foreground">Order Type</p>
              <Select
                value={orderType}
                onValueChange={(value) => setOrderType(value as "market" | "limit")}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Order type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="market">Market</SelectItem>
                  <SelectItem value="limit">Limit</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">Quantity</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-6 px-2 text-[11px]"
                  onClick={setMaxQuantity}
                  disabled={maxOrderQuantity <= 0}
                >
                  {action === "buy" ? "Max Buy" : "Max Sell"}
                </Button>
              </div>
              <Input
                type="number"
                min={1}
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
              />
            </div>

            <div>
              <p className="mb-1 text-xs text-muted-foreground">Limit Price</p>
              <Input
                type="number"
                step="0.01"
                value={limitPrice}
                onChange={(event) => setLimitPrice(event.target.value)}
                disabled={orderType === "market"}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              variant={action === "buy" ? "default" : "outline"}
              onClick={() => setAction("buy")}
            >
              Buy
            </Button>
            <Button
              variant={action === "sell" ? "destructive" : "outline"}
              onClick={() => setAction("sell")}
            >
              Sell
            </Button>
          </div>

          {tradeMessage ? (
            <Alert variant={tradeMessage.type}>
              <AlertDescription>{tradeMessage.text}</AlertDescription>
            </Alert>
          ) : null}

          <div className="rounded-none border border-border/70">
            <div className="border-b border-border/70 bg-muted/20 px-3 py-2">
              <p className="text-xs font-medium text-muted-foreground">Trade Log</p>
            </div>
            <div className="max-h-48 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Stock</TableHead>
                    <TableHead>Qty</TableHead>
                    <TableHead>Price</TableHead>
                    <TableHead>Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tradeLog.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-xs text-muted-foreground">
                        No trades yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    tradeLog.map((trade) => (
                      <TableRow key={trade.id}>
                        <TableCell>{trade.candleTime}</TableCell>
                        <TableCell className="uppercase">{trade.action}</TableCell>
                        <TableCell>{trade.symbol}</TableCell>
                        <TableCell>{trade.quantity}</TableCell>
                        <TableCell>{formatNumber(trade.executedPrice)}</TableCell>
                        <TableCell>{formatNumber(trade.totalValue)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </CardContent>
        <CardFooter className="justify-between">
          <p className="text-xs text-muted-foreground">
            Estimated Value:{" "}
            <span className="font-medium text-foreground">{formatNumber(estimatedOrderValue)}</span>
          </p>
          <Button onClick={executeTrade} disabled={phase !== "running"}>
            Execute {action.toUpperCase()}
          </Button>
        </CardFooter>
      </Card>

      <Card className="border border-border/70 bg-card">
        <CardHeader>
          <CardTitle className="text-base font-semibold">Stock Snapshot</CardTitle>
          <CardDescription>Selected ticker quick summary</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Symbol</span>
            <span className="font-medium">{selectedStockData?.symbol ?? "-"}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Company</span>
            <span className="font-medium">{selectedStockData?.companyName ?? "-"}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Latest Close</span>
            <span className="font-medium">{formatNumber(selectedCurrentPrice)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Period High</span>
            <span className="font-medium">{formatNumber(computeHigh(selectedVisiblePoints))}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Period Low</span>
            <span className="font-medium">{formatNumber(computeLow(selectedVisiblePoints))}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Change %</span>
            <span className="font-medium">{formatNumber(computeChangePercent(selectedVisiblePoints))}%</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Owned Qty</span>
            <span className="font-medium">{holdings[selectedStock]?.quantity ?? 0}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {loading ? (
          <div className="flex min-h-80 items-center justify-center rounded-none border border-border/70 bg-card/30">
            <Spinner className="mr-2 h-4 w-4" />
            <p className="text-sm text-muted-foreground">Loading competition...</p>
          </div>
        ) : error || !data ? (
          <div className="rounded-none border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            {error ?? "Competition not found."}
          </div>
        ) : (
          <div className="space-y-6">
            <Card className="border border-border/70 bg-card">
              <CardHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{data.competition.durationMonths} Months</Badge>
                  <Badge variant="outline" className="uppercase">
                    {data.competition.status}
                  </Badge>
                  <Badge
                    variant={
                      phase === "running"
                        ? "default"
                        : phase === "fast-forwarding"
                          ? "default"
                        : phase === "ended"
                          ? "secondary"
                          : "outline"
                    }
                  >
                    {phase === "running"
                      ? "Live"
                      : phase === "fast-forwarding"
                        ? "Fast Forward"
                      : phase === "ended"
                        ? "Ended"
                        : "Not Started"}
                  </Badge>
                </div>
                <CardTitle className="text-2xl font-semibold">{data.competition.name}</CardTitle>
                <CardDescription>
                  {formatDate(data.competition.startDate)} to {formatDate(data.competition.endDate)}
                </CardDescription>
              </CardHeader>

              <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-none border border-border/70 bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground">Starting Capital</p>
                  <p className="mt-1 text-base font-semibold">
                    {formatCapital(data.competition.startingCapital)}
                  </p>
                </div>
                <div className="rounded-none border border-border/70 bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground">Stocks in Basket</p>
                  <p className="mt-1 text-base font-semibold">{data.stocks.length}</p>
                </div>
                <div className="rounded-none border border-border/70 bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground">Data Range</p>
                  <p className="mt-1 text-base font-semibold">
                    {data.competition.durationMonths}M historical
                  </p>
                </div>
                <div className="rounded-none border border-border/70 bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground">Execution</p>
                  <p className="mt-1 text-base font-semibold">
                    {phase === "running"
                      ? "Running"
                      : phase === "fast-forwarding"
                        ? "Closing"
                        : phase === "ended"
                          ? "Closed"
                          : "Ready"}
                  </p>
                </div>
                <div className="rounded-none border border-border/70 bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground">Live Net P/L</p>
                  <p
                    className={`mt-1 text-base font-semibold ${
                      netPnL >= 0 ? "text-green-600" : "text-red-600"
                    }`}
                  >
                    {formatNumber(netPnL)} ({formatNumber(liveNetPnLPct)}%)
                  </p>
                </div>
              </CardContent>

              <CardFooter className="flex-col items-stretch gap-3 border-t border-border/70 pt-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-xs text-muted-foreground">Competition Timer</p>
                    <p className="text-base font-semibold">{formatTimer(remainingSeconds)}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      onClick={startCompetition}
                      disabled={phase !== "not-started" || data.stocks.length === 0}
                    >
                      Start Competition
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={endCompetition}
                      disabled={phase !== "running"}
                    >
                      {phase === "fast-forwarding" ? "Ending..." : "End Competition"}
                    </Button>
                  </div>
                </div>
                <Progress value={timerProgress} className="h-2" />
              </CardFooter>
            </Card>

            {phase === "not-started" ? (
              <Card className="border border-border/70 bg-card">
                <CardContent className="py-10 text-center">
                  <p className="text-sm font-medium">Competition is ready</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Click &quot;Start Competition&quot; to load charts, trading panel, and market data.
                  </p>
                </CardContent>
              </Card>
            ) : null}

            {phase !== "not-started" && summary ? (
              <Card className="border border-border/70 bg-card">
                <CardHeader>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <CardTitle className="text-lg font-semibold">Competition Result</CardTitle>
                      <CardDescription>
                        Range {summary.startDate} to {summary.endDate}
                      </CardDescription>
                    </div>
                    <Badge variant={summary.profitLoss >= 0 ? "default" : "destructive"}>
                      {summary.profitLoss >= 0 ? "Profit" : "Loss"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-none border border-border/70 bg-muted/20 p-3">
                    <p className="text-xs text-muted-foreground">Portfolio Value</p>
                    <p className="mt-1 text-lg font-semibold">{formatNumber(summary.portfolioValue)}</p>
                  </div>
                  <div className="rounded-none border border-border/70 bg-muted/20 p-3">
                    <p className="text-xs text-muted-foreground">Holdings</p>
                    <p className="mt-1 text-lg font-semibold">{formatNumber(summary.holdingsValue)}</p>
                  </div>
                  <div className="rounded-none border border-border/70 bg-muted/20 p-3">
                    <p className="text-xs text-muted-foreground">Profit / Loss</p>
                    <p
                      className={`mt-1 text-lg font-semibold ${
                        summary.profitLoss >= 0 ? "text-green-600" : "text-red-600"
                      }`}
                    >
                      {formatNumber(summary.profitLoss)} ({formatNumber(summary.returnPct)}%)
                    </p>
                  </div>
                </CardContent>
                <CardContent className="space-y-4 pt-0">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-none border border-border/70 bg-muted/20 p-3">
                      <p className="text-xs text-muted-foreground">Total Buy Value</p>
                      <p className="mt-1 text-base font-semibold">{formatNumber(tradeFlowSummary.totalBuy)}</p>
                    </div>
                    <div className="rounded-none border border-border/70 bg-muted/20 p-3">
                      <p className="text-xs text-muted-foreground">Total Sell Value</p>
                      <p className="mt-1 text-base font-semibold">{formatNumber(tradeFlowSummary.totalSell)}</p>
                    </div>
                    <div className="rounded-none border border-border/70 bg-muted/20 p-3">
                      <p className="text-xs text-muted-foreground">Net Bought Value</p>
                      <p className="mt-1 text-base font-semibold">
                        {formatNumber(tradeFlowSummary.totalBuy - tradeFlowSummary.totalSell)}
                      </p>
                    </div>
                  </div>

                  <div className="rounded-none border border-border/70">
                    <div className="border-b border-border/70 bg-muted/20 px-3 py-2">
                      <p className="text-xs font-medium text-muted-foreground">
                        Stock-Wise Increment / Decrement
                      </p>
                    </div>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Stock</TableHead>
                          <TableHead>Start</TableHead>
                          <TableHead>End</TableHead>
                          <TableHead>Change</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {stockPerformanceRows.map((row) => (
                          <TableRow key={row.symbol}>
                            <TableCell className="font-medium">{row.symbol}</TableCell>
                            <TableCell>{formatNumber(row.startPrice)}</TableCell>
                            <TableCell>{formatNumber(row.endPrice)}</TableCell>
                            <TableCell className={row.change >= 0 ? "text-green-600" : "text-red-600"}>
                              {formatNumber(row.change)} ({formatNumber(row.changePct)}%)
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  <div className="rounded-none border border-border/70">
                    <div className="border-b border-border/70 bg-muted/20 px-3 py-2">
                      <p className="text-xs font-medium text-muted-foreground">
                        Bought Value Increase / Decrease (Open Holdings)
                      </p>
                    </div>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Stock</TableHead>
                          <TableHead>Qty</TableHead>
                          <TableHead>Bought Value</TableHead>
                          <TableHead>Current Value</TableHead>
                          <TableHead>Change</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {holdingsPerformanceRows.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={5} className="text-xs text-muted-foreground">
                              No open holdings at competition end.
                            </TableCell>
                          </TableRow>
                        ) : (
                          holdingsPerformanceRows.map((row) => (
                            <TableRow key={row.symbol}>
                              <TableCell className="font-medium">{row.symbol}</TableCell>
                              <TableCell>{row.quantity}</TableCell>
                              <TableCell>{formatNumber(row.investedValue)}</TableCell>
                              <TableCell>{formatNumber(row.currentValue)}</TableCell>
                              <TableCell className={row.gainLoss >= 0 ? "text-green-600" : "text-red-600"}>
                                {formatNumber(row.gainLoss)} ({formatNumber(row.gainLossPct)}%)
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-none border border-border/70 bg-muted/20 p-3">
                      <p className="text-xs text-muted-foreground">Competition Rank</p>
                      <p className="mt-1 text-base font-semibold">
                        {summary.rank && summary.participantsCount
                          ? `#${summary.rank} / ${summary.participantsCount}`
                          : "Pending"}
                      </p>
                    </div>
                    <div className="rounded-none border border-border/70 bg-muted/20 p-3">
                      <p className="text-xs text-muted-foreground">Rating Change</p>
                      <p className="mt-1 text-base font-semibold">
                        {typeof summary.ratingDelta === "number"
                          ? formatSignedNumber(summary.ratingDelta)
                          : "Pending"}
                      </p>
                    </div>
                    <div className="rounded-none border border-border/70 bg-muted/20 p-3">
                      <p className="text-xs text-muted-foreground">Updated Rating</p>
                      <p className="mt-1 text-base font-semibold">
                        {typeof summary.ratingAfter === "number"
                          ? formatNumber(summary.ratingAfter)
                          : "Pending"}
                      </p>
                    </div>
                  </div>

                  {resultSyncMessage ? (
                    <p className="text-xs text-muted-foreground">{resultSyncMessage}</p>
                  ) : null}

                  {submittingResult ? (
                    <p className="text-xs text-muted-foreground">Saving result to leaderboard...</p>
                  ) : null}
                </CardContent>
              </Card>
            ) : null}

            <Card className="border border-border/70 bg-card">
              <CardHeader>
                <CardTitle className="text-lg font-semibold">Leaderboard</CardTitle>
                <CardDescription>Sorted by rating with win and return performance.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {leaderboardLoading ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Spinner className="h-4 w-4" />
                    Loading leaderboard...
                  </div>
                ) : leaderboardError ? (
                  <p className="text-xs text-destructive">{leaderboardError}</p>
                ) : leaderboardEntries.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No leaderboard entries yet.</p>
                ) : (
                  <div className="rounded-none border border-border/70">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Rank</TableHead>
                          <TableHead>Player</TableHead>
                          <TableHead>Rating</TableHead>
                          <TableHead>Comps</TableHead>
                          <TableHead>Wins</TableHead>
                          <TableHead>Avg Return</TableHead>
                          <TableHead>Last Delta</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {leaderboardEntries.map((entry) => (
                          <TableRow key={entry.userId}>
                            <TableCell>#{entry.rank}</TableCell>
                            <TableCell className="font-medium">{entry.name}</TableCell>
                            <TableCell>{formatNumber(entry.rating)}</TableCell>
                            <TableCell>{entry.competitionsPlayed}</TableCell>
                            <TableCell>{entry.wins}</TableCell>
                            <TableCell>{formatNumber(entry.averageReturnPct)}%</TableCell>
                            <TableCell>{formatSignedNumber(entry.lastRatingDelta)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}

                {competitionStandings.length > 0 ? (
                  <div className="rounded-none border border-border/70">
                    <div className="border-b border-border/70 bg-muted/20 px-3 py-2">
                      <p className="text-xs font-medium text-muted-foreground">
                        This Competition Standings
                      </p>
                    </div>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Rank</TableHead>
                          <TableHead>Player</TableHead>
                          <TableHead>Return</TableHead>
                          <TableHead>Portfolio</TableHead>
                          <TableHead>Rating Delta</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {competitionStandings.map((row) => (
                          <TableRow key={`${row.userId}-${row.completedAt}`}>
                            <TableCell>#{row.rank}</TableCell>
                            <TableCell className="font-medium">{row.name}</TableCell>
                            <TableCell>{formatNumber(row.returnPct)}%</TableCell>
                            <TableCell>{formatNumber(row.finalPortfolioValue)}</TableCell>
                            <TableCell>{formatSignedNumber(row.ratingDelta)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : null}
              </CardContent>
            </Card>

            {phase !== "not-started" ? (
            <Tabs defaultValue="charts" className="w-full">
              <TabsList variant="line">
                <TabsTrigger value="charts">Charts</TabsTrigger>
                <TabsTrigger value="financial-metrics">Financial Metrics</TabsTrigger>
                <TabsTrigger value="news">News</TabsTrigger>
                <TabsTrigger value="market-table">Market Table</TabsTrigger>
              </TabsList>

              <TabsContent value="charts" className="pt-3">
                <div className="space-y-4">
                  <Card className="border border-border/70 bg-card">
                    <CardHeader>
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                        <div>
                          <CardTitle className="text-base font-semibold">Price Chart</CardTitle>
                          <CardDescription>
                            Candles stream as the competition runs to simulate live market movement.
                          </CardDescription>
                        </div>

                        <div className="w-full sm:w-56">
                          <p className="mb-1 text-xs text-muted-foreground">Stock</p>
                          <Select value={selectedStock} onValueChange={setSelectedStock}>
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Select stock" />
                            </SelectTrigger>
                            <SelectContent>
                              {data.stocks.map((stock) => (
                                <SelectItem key={stock.symbol} value={stock.symbol}>
                                  {stock.symbol}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </CardHeader>

                    <CardContent className="space-y-3">
                      <div className="rounded-none border border-border/70 bg-muted/20 p-3">
                        <p className="text-sm font-medium">{selectedStockData?.symbol ?? "-"}</p>
                        <p className="text-xs text-muted-foreground">
                          {selectedStockData?.companyName ?? "N/A"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Visible candles: {selectedVisiblePoints.length}
                        </p>
                      </div>
                      <StockCandlestickChart
                        points={selectedVisiblePoints}
                        startDate={data.competition.startDate}
                      />
                    </CardContent>
                  </Card>

                  {tradePanelContent}
                </div>
              </TabsContent>

              <TabsContent value="financial-metrics" className="pt-3">
                <Card className="border border-border/70 bg-card">
                  <CardHeader>
                    <CardTitle className="text-base font-semibold">Company Financial Metrics</CardTitle>
                    <CardDescription>
                      Only companies in this competition. Range aligned with chart window:
                      {` ${financialRangeLabel || "N/A"}`}
                    </CardDescription>
                  </CardHeader>

                  <CardContent className="space-y-4">
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      <div>
                        <p className="mb-1 text-xs text-muted-foreground">Company</p>
                        <Select value={companyFilter} onValueChange={setCompanyFilter}>
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="All companies" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All companies</SelectItem>
                            {companyOptions.map((company) => (
                              <SelectItem key={company.symbol} value={company.symbol}>
                                {company.symbol}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div>
                        <p className="mb-1 text-xs text-muted-foreground">Statement Type</p>
                        <Select value={statementFilter} onValueChange={setStatementFilter}>
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="All" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All</SelectItem>
                            {statementTypeOptions.map((statementType) => (
                              <SelectItem key={statementType} value={statementType}>
                                {statementType}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="rounded-none border border-border/70 bg-muted/20 p-3">
                        <p className="text-xs text-muted-foreground">Companies visible</p>
                        <p className="mt-1 text-base font-semibold">
                          {filteredFinancialCompanies.length}
                        </p>
                      </div>
                    </div>

                    {financialLoading ? (
                      <div className="flex items-center justify-center py-8">
                        <Spinner className="mr-2 h-4 w-4" />
                        <p className="text-xs text-muted-foreground">
                          Loading financial metrics...
                        </p>
                      </div>
                    ) : financialError ? (
                      <p className="text-xs text-destructive">{financialError}</p>
                    ) : filteredFinancialCompanies.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        No financial metrics available for the current filters.
                      </p>
                    ) : (
                      <Accordion type="multiple" className="w-full border border-border/70 px-3">
                        {filteredFinancialCompanies.map((company) => (
                          <AccordionItem key={company.symbol} value={company.symbol}>
                            <AccordionTrigger>
                              <div className="flex w-full items-center justify-between gap-2 pr-3">
                                <div>
                                  <p className="text-sm font-medium">{company.symbol}</p>
                                  <p className="text-xs text-muted-foreground">
                                    {company.companyName ?? "N/A"}
                                  </p>
                                </div>
                                <Badge variant="outline">{company.rows.length} rows</Badge>
                              </div>
                            </AccordionTrigger>
                            <AccordionContent>
                              <div className="space-y-4">
                                {groupFinancialRows(company.rows).map((statementGroup) => (
                                  <div
                                    key={`${company.symbol}-${statementGroup.statementType}`}
                                    className="rounded-none border border-border/70"
                                  >
                                    <div className="border-b border-border/70 bg-muted/20 px-3 py-2">
                                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                        {statementGroup.statementType}
                                      </p>
                                    </div>

                                    <Table>
                                      <TableHeader>
                                        <TableRow>
                                          <TableHead>Metric</TableHead>
                                          {statementGroup.years.map((year) => (
                                            <TableHead
                                              key={`${statementGroup.statementType}-${year}`}
                                            >
                                              FY {year}
                                            </TableHead>
                                          ))}
                                        </TableRow>
                                      </TableHeader>
                                      <TableBody>
                                        {statementGroup.metrics.map((metricRow) => (
                                          <TableRow
                                            key={`${company.symbol}-${statementGroup.statementType}-${metricRow.metric}`}
                                          >
                                            <TableCell className="font-medium">
                                              {metricRow.metric}
                                            </TableCell>
                                            {statementGroup.years.map((year) => {
                                              const valueRow = metricRow.yearMap.get(year);
                                              return (
                                                <TableCell
                                                  key={`${company.symbol}-${statementGroup.statementType}-${metricRow.metric}-${year}`}
                                                >
                                                  {valueRow
                                                    ? formatFinancialMetricValue(valueRow)
                                                    : "-"}
                                                </TableCell>
                                              );
                                            })}
                                          </TableRow>
                                        ))}
                                      </TableBody>
                                    </Table>
                                  </div>
                                ))}
                              </div>
                            </AccordionContent>
                          </AccordionItem>
                        ))}
                      </Accordion>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="news" className="pt-3">
                <Card className="border border-border/70 bg-card">
                  <CardHeader>
                    <CardTitle className="text-base font-semibold">Competition News</CardTitle>
                    <CardDescription>
                      Top 5 items per category from one month before competition start.
                    </CardDescription>
                  </CardHeader>

                  <CardContent className="space-y-4">
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      <div>
                        <p className="mb-1 text-xs text-muted-foreground">Stock</p>
                        <Select value={selectedNewsSymbol} onValueChange={setSelectedNewsSymbol}>
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Select stock" />
                          </SelectTrigger>
                          <SelectContent>
                            {(data.news ?? []).map((stock) => (
                              <SelectItem key={stock.symbol} value={stock.symbol}>
                                {stock.symbol}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="rounded-none border border-border/70 bg-muted/20 p-3">
                        <p className="text-xs text-muted-foreground">Company</p>
                        <p className="mt-1 text-sm font-medium">
                          {selectedNewsData?.companyName ?? "-"}
                        </p>
                      </div>

                      <div className="rounded-none border border-border/70 bg-muted/20 p-3">
                        <p className="text-xs text-muted-foreground">Available categories</p>
                        <p className="mt-1 text-sm font-medium">company, finance, global, industry</p>
                      </div>
                    </div>

                    {!selectedNewsData ? (
                      <p className="text-xs text-muted-foreground">No news available for this competition.</p>
                    ) : (
                      <div className="grid gap-4 lg:grid-cols-2">
                        {([
                          "company",
                          "finance",
                          "global",
                          "industry",
                        ] as const).map((category) => {
                          const articles = selectedNewsData.categories[category] ?? [];

                          return (
                            <div
                              key={`${selectedNewsData.symbol}-${category}`}
                              className="rounded-none border border-border/70"
                            >
                              <div className="border-b border-border/70 bg-muted/20 px-3 py-2">
                                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                  {category}
                                </p>
                              </div>

                              <div className="space-y-3 p-3">
                                {articles.length === 0 ? (
                                  <p className="text-xs text-muted-foreground">No articles found.</p>
                                ) : (
                                  articles.map((article) => (
                                    <div
                                      key={`${category}-${article.rank}-${article.link}`}
                                      className="rounded-none border border-border/60 p-3"
                                    >
                                      <p className="text-[11px] text-muted-foreground">
                                        #{article.rank} • {article.source ?? "Unknown source"} • {formatNewsDate(article.publishedAt)}
                                      </p>
                                      <a
                                        href={article.link}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="mt-1 block text-sm font-medium text-foreground underline-offset-4 hover:underline"
                                      >
                                        {article.title}
                                      </a>
                                    </div>
                                  ))
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="market-table" className="pt-3">
                <Card className="border border-border/70 bg-card">
                  <CardHeader>
                    <CardTitle className="text-base font-semibold">All Stocks Summary</CardTitle>
                    <CardDescription>
                      Comparison of all stocks inside this competition basket
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Symbol</TableHead>
                          <TableHead>Company</TableHead>
                          <TableHead>Latest Close</TableHead>
                          <TableHead>High</TableHead>
                          <TableHead>Low</TableHead>
                          <TableHead>Change %</TableHead>
                          <TableHead>Visible Points</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {stockSummaries.map((stock) => (
                          <TableRow key={stock.symbol}>
                            <TableCell className="font-medium">{stock.symbol}</TableCell>
                            <TableCell>{stock.companyName ?? "-"}</TableCell>
                            <TableCell>{formatNumber(stock.latestClose)}</TableCell>
                            <TableCell>{formatNumber(stock.high)}</TableCell>
                            <TableCell>{formatNumber(stock.low)}</TableCell>
                            <TableCell>{formatNumber(stock.changePct)}%</TableCell>
                            <TableCell>{stock.pointsCount}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" asChild>
                <Link href={`/compete/long-term/${params.duration}`}>Back to Duration</Link>
              </Button>
              <Button variant="ghost" asChild>
                <Link href="/compete/long-term">All Durations</Link>
              </Button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
