"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

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
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "~/components/ui/empty";
import { Spinner } from "~/components/ui/spinner";

type Challenge = {
  id: number;
  name: string;
  durationMonths: number;
  startDate: string;
  endDate: string;
  startingCapital: number;
  status: string;
  stocks: Array<{
    symbol: string;
    startDate: string | null;
    companyName: string | null;
  }>;
};

type ChallengesResponse = {
  durationMonths: number;
  totalChallenges: number;
  challenges: Challenge[];
};

function formatDate(dateString: string): string {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function formatCapital(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 0,
  }).format(value);
}

export default function DurationChallengesPage() {
  const params = useParams<{ duration: string }>();
  const [duration, setDuration] = useState<string>("");
  const [data, setData] = useState<ChallengesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const load = async () => {
      const durationParam = params.duration;

      if (!durationParam) {
        if (isMounted) {
          setError("Invalid duration.");
          setLoading(false);
        }
        return;
      }

      if (isMounted) {
        setDuration(durationParam);
      }

      try {
        setLoading(true);
        const response = await fetch(`/api/competitions/long-term/${durationParam}`, {
          method: "GET",
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error(`Failed to load challenges (${response.status})`);
        }

        const payload = (await response.json()) as ChallengesResponse;

        if (isMounted) {
          setData(payload);
          setError(null);
        }
      } catch (err) {
        if (isMounted) {
          setError("Unable to load challenge list.");
          console.error(err);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      isMounted = false;
    };
  }, [params.duration]);

  const title = useMemo(() => {
    if (data) {
      return `${data.durationMonths} Month Challenges`;
    }
    if (duration) {
      return `${duration} Month Challenges`;
    }
    return "Challenges";
  }, [data, duration]);

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="mb-8 space-y-2">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
            Long Term
          </p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
          <p className="max-w-2xl text-sm text-muted-foreground sm:text-base">
            Completed historical competitions with fixed capital and curated stock baskets.
          </p>
        </div>

        {loading ? (
          <div className="flex min-h-44 items-center justify-center rounded-none border border-border/70 bg-card/40">
            <Spinner className="mr-2 h-4 w-4" />
            <p className="text-sm text-muted-foreground">Loading challenges...</p>
          </div>
        ) : error ? (
          <div className="rounded-none border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            {error}
          </div>
        ) : !data || data.challenges.length === 0 ? (
          <Empty className="border border-border/70 bg-card/40 py-12">
            <EmptyHeader>
              <EmptyTitle className="text-base">No challenges found</EmptyTitle>
              <EmptyDescription>
                There are no completed competitions for this duration yet.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {data.challenges.map((challenge) => (
              <Card key={challenge.id} className="border border-border/70 bg-card">
                <CardHeader>
                  <CardTitle className="text-base font-semibold">{challenge.name}</CardTitle>
                  <CardDescription>
                    {formatDate(challenge.startDate)} to {formatDate(challenge.endDate)}
                  </CardDescription>
                </CardHeader>

                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Capital</span>
                    <span className="font-medium">{formatCapital(challenge.startingCapital)}</span>
                  </div>

                  {/* <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Status</span>
                    <Badge variant="outline" className="uppercase">
                      {challenge.status}
                    </Badge>
                  </div> */}

                  {/* <div>
                    <p className="mb-2 text-xs text-muted-foreground">Stocks ({challenge.stocks.length})</p>
                    <div className="flex flex-wrap gap-1.5">
                      {challenge.stocks.map((stock) => (
                        <Badge key={`${challenge.id}-${stock.symbol}`} variant="outline">
                          {stock.symbol}
                        </Badge>
                      ))}
                    </div>
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      Starts on: {challenge.stocks[0]?.startDate ? formatDate(challenge.stocks[0].startDate) : "N/A"}
                    </p>
                  </div> */}
                </CardContent>

                <CardFooter>
                  <Button variant="outline" className="w-full" asChild>
                    <Link href={`/compete/long-term/${challenge.durationMonths}/${challenge.id}`}>
                      Open Challenge
                    </Link>
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        )}

        <div className="mt-6 flex gap-2">
          <Button variant="outline" asChild>
            <Link href="/compete/long-term">Back</Link>
          </Button>
          <Button variant="ghost" asChild>
            <Link href="/compete">All Modes</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
