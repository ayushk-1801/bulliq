import { asc, desc, eq } from "drizzle-orm"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table"
import { db } from "~/server/db"
import { leaderboard, user } from "~/server/db/schema"

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 2,
  }).format(value)
}

function formatSigned(value: number): string {
  return `${value > 0 ? "+" : ""}${formatNumber(value)}`
}

export default async function LeaderboardPage() {
  const rows = await db
    .select({
      userId: leaderboard.userId,
      name: user.name,
      rating: leaderboard.rating,
      competitionsPlayed: leaderboard.competitionsPlayed,
      wins: leaderboard.wins,
      averageReturnPct: leaderboard.averageReturnPct,
      bestReturnPct: leaderboard.bestReturnPct,
      lastRatingDelta: leaderboard.lastRatingDelta,
    })
    .from(leaderboard)
    .innerJoin(user, eq(leaderboard.userId, user.id))
    .orderBy(
      desc(leaderboard.rating),
      desc(leaderboard.wins),
      desc(leaderboard.averageReturnPct),
      asc(user.name),
    )
    .limit(100)

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <Card className="border border-border/70 bg-card">
          <CardHeader>
            <CardTitle className="text-2xl font-semibold">Leaderboard</CardTitle>
            <CardDescription>
              Global rankings based on competition ratings and performance.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No leaderboard entries yet. Complete a competition to appear here.
              </p>
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
                      <TableHead>Best Return</TableHead>
                      <TableHead>Last Delta</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row, index) => (
                      <TableRow key={row.userId}>
                        <TableCell>#{index + 1}</TableCell>
                        <TableCell className="font-medium">{row.name}</TableCell>
                        <TableCell>{formatNumber(row.rating)}</TableCell>
                        <TableCell>{row.competitionsPlayed}</TableCell>
                        <TableCell>{row.wins}</TableCell>
                        <TableCell>{formatNumber(row.averageReturnPct)}%</TableCell>
                        <TableCell>
                          {row.bestReturnPct === null ? "-" : `${formatNumber(row.bestReturnPct)}%`}
                        </TableCell>
                        <TableCell>{formatSigned(row.lastRatingDelta)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
