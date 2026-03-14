import { desc } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "~/server/db";
import { volatileDaySummary } from "~/server/db/schema";

type IntradayDay = {
  id: number;
  symbol: string;
  tradeDate: string;
};

function toDateOnly(value: string | Date): string {
  if (typeof value === "string") return value;
  return value.toISOString().slice(0, 10);
}

export async function GET() {
  const rows = await db
    .select({
      id: volatileDaySummary.id,
      symbol: volatileDaySummary.symbol,
      tradeDate: volatileDaySummary.tradeDate,
    })
    .from(volatileDaySummary)
    .orderBy(desc(volatileDaySummary.volatilityPct), desc(volatileDaySummary.tradeDate))
    .limit(60);

  const days: IntradayDay[] = rows.map((row) => ({
    id: row.id,
    symbol: row.symbol,
    tradeDate: toDateOnly(row.tradeDate),
  }));

  return NextResponse.json({
    mode: "intraday",
    totalDays: days.length,
    days,
  });
}
