import { readFile } from "node:fs/promises";
import path from "node:path";

import type { Metadata } from "next";
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

type CompetitionSummary = {
  source: string;
  months: number;
  windows: number;
  avgInterestScore: number;
  avgAnnVolatility: number;
  avgMaxDrawdown: number;
  topRegime: string;
};

type CompetitionAccumulator = {
  source: string;
  months: number;
  windows: number;
  sumInterestScore: number;
  sumAnnVolatility: number;
  sumMaxDrawdown: number;
  regimes: Map<string, number>;
};

export const metadata: Metadata = {
  title: "Compete | BullIQ",
  description: "Choose a volatility window competition and start trading challenges.",
};

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      out.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  out.push(current.trim());
  return out;
}

function toNumber(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function pickTopRegime(regimes: Map<string, number>): string {
  let topRegime = "Mixed";
  let topCount = 0;

  for (const [regime, count] of regimes) {
    if (count > topCount) {
      topRegime = regime;
      topCount = count;
    }
  }

  return topRegime;
}

function toWindowLabel(months: number): string {
  return `${months} Month Window`;
}

function formatMetric(value: number, suffix = ""): string {
  return `${value.toFixed(1)}${suffix}`;
}

async function getCompetitions(): Promise<CompetitionSummary[]> {
  const csvPath = path.join(process.cwd(), "src", "server", "nifty50", "volatility_windows_all_stocks.csv");
  const file = await readFile(csvPath, "utf8");

  const lines = file
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);

  if (lines.length < 2) return [];

  const headerLine = lines[0];
  if (!headerLine) return [];

  const headers = parseCsvLine(headerLine);
  const idx = {
    source: headers.indexOf("source"),
    months: headers.indexOf("months"),
    interest: headers.indexOf("interest_score"),
    annVol: headers.indexOf("ann_vol_pct"),
    maxDrawdown: headers.indexOf("max_drawdown_pct"),
    dominantRegime: headers.indexOf("dominant_regime"),
  };

  const grouped = new Map<string, CompetitionAccumulator>();

  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) continue;

    const row = parseCsvLine(line);

    const source = row[idx.source] ?? "custom";
    const months = toNumber(row[idx.months]);
    const interestScore = toNumber(row[idx.interest]);
    const annVol = toNumber(row[idx.annVol]);
    const maxDrawdown = Math.abs(toNumber(row[idx.maxDrawdown]));
    const dominantRegime = row[idx.dominantRegime] ?? "Mixed";

    let bucket = grouped.get(source);
    if (!bucket) {
      bucket = {
        source,
        months,
        windows: 0,
        sumInterestScore: 0,
        sumAnnVolatility: 0,
        sumMaxDrawdown: 0,
        regimes: new Map<string, number>(),
      };
      grouped.set(source, bucket);
    }

    bucket.windows += 1;
    bucket.sumInterestScore += interestScore;
    bucket.sumAnnVolatility += annVol;
    bucket.sumMaxDrawdown += maxDrawdown;
    bucket.regimes.set(dominantRegime, (bucket.regimes.get(dominantRegime) ?? 0) + 1);
  }

  return Array.from(grouped.values())
    .map((bucket) => ({
      source: bucket.source,
      months: bucket.months,
      windows: bucket.windows,
      avgInterestScore: bucket.sumInterestScore / bucket.windows,
      avgAnnVolatility: bucket.sumAnnVolatility / bucket.windows,
      avgMaxDrawdown: bucket.sumMaxDrawdown / bucket.windows,
      topRegime: pickTopRegime(bucket.regimes),
    }))
    .sort((a, b) => a.months - b.months);
}

export default async function CompetePage() {
  const competitions = await getCompetitions();

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="mb-8 space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Competitions</h1>
          <p className="max-w-2xl text-sm text-muted-foreground sm:text-base">
            Choose a volatility window challenge and start from the market setup that fits your strategy.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {competitions.map((competition) => (
            <Card key={competition.source} className="border border-border/70 bg-card/70 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="text-base font-semibold">
                  {toWindowLabel(competition.months)}
                </CardTitle>
                <CardDescription className="flex items-center justify-between gap-2">
                  <span>{competition.windows} available setups</span>
                  <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                    {competition.source}
                  </Badge>
                </CardDescription>
              </CardHeader>

              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <p className="text-muted-foreground">Avg interest</p>
                  <p className="text-right font-medium">{formatMetric(competition.avgInterestScore)}</p>

                  <p className="text-muted-foreground">Avg volatility</p>
                  <p className="text-right font-medium">{formatMetric(competition.avgAnnVolatility, "%")}</p>

                  <p className="text-muted-foreground">Avg drawdown</p>
                  <p className="text-right font-medium">{formatMetric(competition.avgMaxDrawdown, "%")}</p>
                </div>

                <div className="rounded-none border border-border/70 bg-muted/40 px-2 py-1.5 text-xs text-muted-foreground">
                  Dominant regime: <span className="font-medium text-foreground">{competition.topRegime}</span>
                </div>
              </CardContent>

              <CardFooter>
                <Button className="w-full">Start</Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      </div>
    </main>
  );
}
