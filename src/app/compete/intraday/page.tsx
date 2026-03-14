"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "~/components/ui/empty";
import { Spinner } from "~/components/ui/spinner";

type IntradayDay = {
  id: number;
  symbol: string;
  tradeDate: string;
};

type IntradayResponse = {
  mode: "intraday";
  totalDays: number;
  days: IntradayDay[];
};

function formatDate(dateString: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${dateString}T00:00:00.000Z`));
}

export default function IntradayPage() {
  const [days, setDays] = useState<IntradayDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const loadDays = async () => {
      try {
        setLoading(true);
        const response = await fetch("/api/competitions/intraday", {
          method: "GET",
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch intraday days (${response.status})`);
        }

        const payload = (await response.json()) as IntradayResponse;
        if (mounted) {
          setDays(payload.days);
          setError(null);
        }
      } catch (err) {
        if (mounted) {
          setError("Unable to load intraday volatility days.");
          console.error(err);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    void loadDays();

    return () => {
      mounted = false;
    };
  }, []);

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="mb-8 space-y-2">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
            Intra Day
          </p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Volatility Challenge Days</h1>
          <p className="max-w-3xl text-sm text-muted-foreground sm:text-base">
            Choose a volatile market day and start the challenge. Detailed metrics are hidden until
            you complete the full end-of-day simulation and submit your decisions.
          </p>
        </div>

        {loading ? (
          <div className="flex min-h-44 items-center justify-center rounded-none border border-border/70 bg-card/40">
            <Spinner className="mr-2 h-4 w-4" />
            <p className="text-sm text-muted-foreground">Loading volatility days...</p>
          </div>
        ) : error ? (
          <div className="rounded-none border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            {error}
          </div>
        ) : days.length === 0 ? (
          <Empty className="border border-border/70 bg-card/40 py-12">
            <EmptyHeader>
              <EmptyTitle className="text-base">No intraday days available</EmptyTitle>
              <EmptyDescription>
                Seed the volatile-day data first, then this list will become playable.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {days.map((day) => (
              <Card key={day.id} className="border border-border/70 bg-card">
                <CardHeader className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{day.symbol}</Badge>
                    <Badge variant="secondary">{formatDate(day.tradeDate)}</Badge>
                  </div>
                  <CardTitle className="text-base">Intraday Scenario</CardTitle>
                  <CardDescription>
                    Price details are hidden for fairness and revealed after final submission.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 text-xs">
                  <div className="rounded-none border border-border/70 bg-muted/20 p-2 text-muted-foreground">
                    Hidden until end-of-day submit.
                  </div>
                  <Button className="mt-2 w-full" asChild>
                    <Link href={`/compete/intraday/${encodeURIComponent(day.symbol)}/${day.tradeDate}`}>
                      Start
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <div className="mt-6">
          <Button variant="outline" asChild>
            <Link href="/compete">Back</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
