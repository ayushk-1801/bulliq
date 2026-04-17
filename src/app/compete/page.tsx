import type { Metadata } from "next";
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

export const metadata: Metadata = {
  title: "Compete",
  description: "Select a trading competition mode.",
};

const competitionModes = [
  {
    title: "Intra Day",
    description: "Fast-paced market sessions with shorter holding periods.",
    href: "/compete/intraday",
    badge: "Live",
    cta: "Explore",
  },
  {
    title: "Long Term",
    description: "Historical multi-month challenges built from real market data.",
    href: "/compete/long-term",
    badge: "Live",
    cta: "Continue",
  },
  {
    title: "Swing Trading",
    description: "Daily swing trading challenges with real market data.",
    href: "/compete/swing-trading",
    badge: "Coming Soon",
    cta: "Continue",
  },
] as const;

export default function CompetePage() {
  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="mb-10 space-y-3">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
            Trading Arena
          </p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Choose Competition Type
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground sm:text-base">
            Start with a format that matches your style. You can switch competition modes any time.
          </p>
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          {competitionModes.map((mode) => (
            <Card key={mode.title} className="border border-border/70 bg-card">
              <CardHeader>
                <div className="mb-2">
                  <Badge variant={mode.badge === "Live" ? "default" : "outline"}>
                    {mode.badge}
                  </Badge>
                </div>
                <CardTitle className="text-lg font-semibold">{mode.title}</CardTitle>
                <CardDescription className="text-sm">{mode.description}</CardDescription>
              </CardHeader>

              <CardContent>
                <div className="h-px w-full bg-border/70" />
              </CardContent>

              <CardFooter>
                <Button asChild className="w-full">
                  <Link href={mode.href}>{mode.cta}</Link>
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      </div>
    </main>
  );
}
