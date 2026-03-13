"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

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
import { Spinner } from "~/components/ui/spinner";

type DurationOption = {
  durationMonths: number;
  title: string;
  totalChallenges: number;
};

type LongTermOptionsResponse = {
  mode: "long-term";
  options: DurationOption[];
};

export default function LongTermPage() {
  const [options, setOptions] = useState<DurationOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const fetchOptions = async () => {
      try {
        setLoading(true);
        const response = await fetch("/api/competitions/long-term", {
          method: "GET",
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error(`Failed to load durations (${response.status})`);
        }

        const data = (await response.json()) as LongTermOptionsResponse;
        if (isMounted) {
          setOptions(data.options);
          setError(null);
        }
      } catch (err) {
        if (isMounted) {
          setError("Unable to load long-term competitions.");
          console.error(err);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    void fetchOptions();

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="mb-8 space-y-2">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
            Long Term
          </p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Select Challenge Duration
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground sm:text-base">
            Pick a historical timeframe to view all completed challenge instances.
          </p>
        </div>

        {loading ? (
          <div className="flex min-h-44 items-center justify-center rounded-none border border-border/70 bg-card/40">
            <Spinner className="mr-2 h-4 w-4" />
            <p className="text-sm text-muted-foreground">Loading durations...</p>
          </div>
        ) : error ? (
          <div className="rounded-none border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            {error}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {options.map((option) => (
              <Card key={option.durationMonths} className="border border-border/70 bg-card">
                <CardHeader>
                  <div className="mb-2">
                    <Badge variant="outline">{option.durationMonths} Months</Badge>
                  </div>
                  <CardTitle>{option.title}</CardTitle>
                  <CardDescription>
                    {option.totalChallenges} challenges available
                  </CardDescription>
                </CardHeader>

                <CardContent>
                  <div className="text-xs text-muted-foreground">
                    Starting capital: <span className="font-medium text-foreground">100,000</span>
                  </div>
                </CardContent>

                <CardFooter>
                  <Button className="w-full" asChild>
                    <Link href={`/compete/long-term/${option.durationMonths}`}>View Challenges</Link>
                  </Button>
                </CardFooter>
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
