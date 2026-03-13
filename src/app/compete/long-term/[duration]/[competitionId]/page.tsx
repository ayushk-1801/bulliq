"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

import { StockCandlestickChart } from "~/components/compete/stock-candlestick-chart";
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

type TradeAction = "buy" | "sell" | "hold";

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
    const metricBucket = statementBucket.metrics.get(row.metric) ?? new Map<number, FinancialMetricRow>();
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
  const [action, setAction] = useState<TradeAction>("buy");
  const [quantity, setQuantity] = useState<string>("10");
  const [orderType, setOrderType] = useState<"market" | "limit">("market");
  const [limitPrice, setLimitPrice] = useState<string>("");

  const [financialCompanies, setFinancialCompanies] = useState<FinancialMetricsResponse["companies"]>([]);
  const [financialRange, setFinancialRange] = useState<FinancialMetricsResponse["range"] | null>(null);
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
          setLimitPrice((payload.stocks[0]?.points.at(-1)?.close ?? 0).toFixed(2));
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

  const estimatedOrderValue = useMemo(() => {
    if (!selectedStockData) return 0;
    const parsedQuantity = Number.parseInt(quantity, 10);
    if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) return 0;

    const lastClose = selectedStockData.points.at(-1)?.close ?? 0;
    const price = orderType === "market" ? lastClose : Number.parseFloat(limitPrice) || 0;

    return parsedQuantity * price;
  }, [selectedStockData, quantity, orderType, limitPrice]);

  const stockSummaries = useMemo(() => {
    if (!data) return [];

    return data.stocks.map((stock) => {
      const lastPoint = stock.points.at(-1);
      return {
        symbol: stock.symbol,
        companyName: stock.companyName,
        pointsCount: stock.points.length,
        latestClose: lastPoint?.close ?? 0,
        high: computeHigh(stock.points),
        low: computeLow(stock.points),
        changePct: computeChangePercent(stock.points),
      };
    });
  }, [data]);

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
                </div>
                <CardTitle className="text-2xl font-semibold">{data.competition.name}</CardTitle>
                <CardDescription>
                  {formatDate(data.competition.startDate)} to {formatDate(data.competition.endDate)}
                </CardDescription>
              </CardHeader>

              <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-none border border-border/70 bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground">Starting Capital</p>
                  <p className="mt-1 text-base font-semibold">{formatCapital(data.competition.startingCapital)}</p>
                </div>
                <div className="rounded-none border border-border/70 bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground">Stocks in Basket</p>
                  <p className="mt-1 text-base font-semibold">{data.stocks.length}</p>
                </div>
                <div className="rounded-none border border-border/70 bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground">Data Range</p>
                  <p className="mt-1 text-base font-semibold">{data.competition.durationMonths}M historical</p>
                </div>
                <div className="rounded-none border border-border/70 bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground">Execution</p>
                  <p className="mt-1 text-base font-semibold">Simulation mode</p>
                </div>
              </CardContent>
            </Card>

            <Tabs defaultValue="charts" className="w-full">
              <TabsList variant="line">
                <TabsTrigger value="charts">Charts</TabsTrigger>
                <TabsTrigger value="financial-metrics">Financial Metrics</TabsTrigger>
                <TabsTrigger value="trade-panel">Trade Panel</TabsTrigger>
                <TabsTrigger value="market-table">Market Table</TabsTrigger>
              </TabsList>

              <TabsContent value="charts" className="pt-3">
                <Card className="border border-border/70 bg-card">
                  <CardHeader>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                      <div>
                        <CardTitle className="text-base font-semibold">Price Chart</CardTitle>
                        <CardDescription>
                          Showing historical data from 2022-01-01 up to the challenge start date.
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
                      <p className="text-xs text-muted-foreground">{selectedStockData?.companyName ?? "N/A"}</p>
                      {/* <p className="text-xs text-muted-foreground">
                        Redacted on: {selectedStockData?.redactedDate ? formatDate(selectedStockData.redactedDate) : "N/A"}
                      </p> */}
                    </div>
                    <StockCandlestickChart points={selectedStockData?.points ?? []} />
                  </CardContent>
                </Card>
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
                        <p className="mt-1 text-base font-semibold">{filteredFinancialCompanies.length}</p>
                      </div>
                    </div>

                    {financialLoading ? (
                      <div className="flex items-center justify-center py-8">
                        <Spinner className="mr-2 h-4 w-4" />
                        <p className="text-xs text-muted-foreground">Loading financial metrics...</p>
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
                                  <p className="text-xs text-muted-foreground">{company.companyName ?? "N/A"}</p>
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
                                            <TableHead key={`${statementGroup.statementType}-${year}`}>
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
                                            <TableCell className="font-medium">{metricRow.metric}</TableCell>
                                            {statementGroup.years.map((year) => {
                                              const valueRow = metricRow.yearMap.get(year);
                                              return (
                                                <TableCell
                                                  key={`${company.symbol}-${statementGroup.statementType}-${metricRow.metric}-${year}`}
                                                >
                                                  {valueRow ? formatFinancialMetricValue(valueRow) : "-"}
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

              <TabsContent value="trade-panel" className="pt-3">
                <div className="grid gap-4 lg:grid-cols-3">
                  <Card className="border border-border/70 bg-card lg:col-span-2">
                    <CardHeader>
                      <CardTitle className="text-base font-semibold">Selected Stock</CardTitle>
                      <CardDescription>
                        Place simulated orders for visual testing. No backend order execution is enabled.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
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
                          <p className="mb-1 text-xs text-muted-foreground">Quantity</p>
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
                        <Button
                          variant={action === "hold" ? "secondary" : "outline"}
                          onClick={() => setAction("hold")}
                        >
                          Hold
                        </Button>
                      </div>
                    </CardContent>
                    <CardFooter className="justify-between">
                      <p className="text-xs text-muted-foreground">
                        Estimated Value: <span className="font-medium text-foreground">{formatNumber(estimatedOrderValue)}</span>
                      </p>
                      <Button disabled>{action.toUpperCase()} (Preview)</Button>
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
                        <span className="font-medium">{formatNumber(selectedStockData?.points.at(-1)?.close ?? 0)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Period High</span>
                        <span className="font-medium">{formatNumber(computeHigh(selectedStockData?.points ?? []))}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Period Low</span>
                        <span className="font-medium">{formatNumber(computeLow(selectedStockData?.points ?? []))}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Change %</span>
                        <span className="font-medium">
                          {formatNumber(computeChangePercent(selectedStockData?.points ?? []))}%
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>

              <TabsContent value="market-table" className="pt-3">
                <Card className="border border-border/70 bg-card">
                  <CardHeader>
                    <CardTitle className="text-base font-semibold">All Stocks Summary</CardTitle>
                    <CardDescription>Comparison of all stocks inside this competition basket</CardDescription>
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
                          <TableHead>Data Points</TableHead>
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
