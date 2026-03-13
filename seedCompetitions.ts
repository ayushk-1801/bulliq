import { readFile } from "node:fs/promises";
import path from "node:path";

import { and, gte, inArray, lte, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import {
  competition,
  competitionStock,
  niftyCompany,
  niftyStockDaily,
} from "./src/server/db/schema";

type DurationMonths = 6 | 12 | 18 | 24;

type CompetitionInsertInput = {
  name: string;
  durationMonths: DurationMonths;
  startDate: string;
  endDate: string;
  startingCapital: number;
  status: "completed";
};

const STARTING_CAPITAL = 100_000;
const COMPETITIONS_PER_DURATION = 10;
const STOCKS_PER_COMPETITION = 10;
const DURATIONS: DurationMonths[] = [6, 12, 18, 24];
const RANGE_START = createUtcDate("2022-01-01");
const MAX_COMPETITION_END = createUtcDate("2025-12-31");
const MIN_TRADING_ROWS_PER_MONTH = 15;
const MAX_GENERATION_ATTEMPTS = 250;

async function loadEnv() {
  const envPath = path.resolve(process.cwd(), ".env");

  try {
    const content = await readFile(envPath, "utf8");

    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const [rawKey, ...valueParts] = trimmed.split("=");
      const key = rawKey?.trim();
      if (!key) continue;

      let value = valueParts.join("=").trim();
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }

      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch {
    // Allow using shell-provided environment variables without a local .env file.
  }
}

function createUtcDate(dateOnly: string): Date {
  const [year, month, day] = dateOnly.split("-").map(Number);
  if (!year || !month || !day) {
    throw new Error(`Invalid date string: ${dateOnly}`);
  }

  return new Date(Date.UTC(year, month - 1, day));
}

function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function randomInt(minInclusive: number, maxInclusive: number): number {
  return (
    Math.floor(Math.random() * (maxInclusive - minInclusive + 1)) + minInclusive
  );
}

function randomDateBetween(start: Date, end: Date): Date {
  const randomMs = randomInt(start.getTime(), end.getTime());
  return new Date(randomMs);
}

function addMonthsUtc(date: Date, months: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + months;
  const day = date.getUTCDate();

  const lastDayOfTargetMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const clampedDay = Math.min(day, lastDayOfTargetMonth);

  return new Date(Date.UTC(year, month, clampedDay));
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];

  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = randomInt(0, i);
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }

  return copy;
}

function pickUniqueSymbols(symbols: string[], count: number): string[] {
  if (symbols.length < count) {
    throw new Error(
      `Not enough companies to pick ${count} unique symbols. Found ${symbols.length}.`,
    );
  }

  return shuffle(symbols).slice(0, count);
}

function buildRedactedSymbol(index: number): string {
  return `STOCK-${String(index + 1).padStart(2, "0")}`;
}

function buildRedactedCompanyName(index: number): string {
  return `Company ${String(index + 1).padStart(2, "0")}`;
}

function buildCompetitionName(
  durationMonths: DurationMonths,
  sequence: number,
): string {
  return `${durationMonths}M Stock Challenge #${sequence}`;
}

function createCompetitionInput(
  durationMonths: DurationMonths,
  sequence: number,
): CompetitionInsertInput {
  const latestStart = addMonthsUtc(MAX_COMPETITION_END, -durationMonths);
  if (latestStart < RANGE_START) {
    throw new Error(
      `Invalid seed window for ${durationMonths} month duration. Latest start ${formatDateOnly(latestStart)} is before ${formatDateOnly(RANGE_START)}.`,
    );
  }

  const start = randomDateBetween(RANGE_START, latestStart);
  const end = addMonthsUtc(start, durationMonths);

  return {
    name: buildCompetitionName(durationMonths, sequence),
    durationMonths,
    startDate: formatDateOnly(start),
    endDate: formatDateOnly(end),
    startingCapital: STARTING_CAPITAL,
    status: "completed",
  };
}

async function main() {
  await loadEnv();

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set. Provide it via .env or shell env.");
  }

  const client = postgres(databaseUrl, { max: 1 });
  const db = drizzle(client);

  try {
    const companyRows = await db
      .select({ symbol: niftyCompany.symbol })
      .from(niftyCompany);

    const symbols = companyRows
      .map((row) => row.symbol)
      .filter((symbol): symbol is string => Boolean(symbol));

    if (symbols.length < STOCKS_PER_COMPETITION) {
      throw new Error(
        `Need at least ${STOCKS_PER_COMPETITION} companies in nifty_company to seed competitions.`,
      );
    }

    for (const duration of DURATIONS) {
      for (let sequence = 1; sequence <= COMPETITIONS_PER_DURATION; sequence += 1) {
        let competitionInput: CompetitionInsertInput | null = null;
        let eligibleSymbols: string[] = [];

        for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt += 1) {
          const candidate = createCompetitionInput(duration, sequence);
          const minimumRows = duration * MIN_TRADING_ROWS_PER_MONTH;

          const availabilityRows = await db
            .select({
              symbol: niftyStockDaily.symbol,
              rowCount: sql<number>`count(*)::int`,
            })
            .from(niftyStockDaily)
            .where(
              and(
                inArray(niftyStockDaily.symbol, symbols),
                gte(niftyStockDaily.tradeDate, candidate.startDate),
                lte(niftyStockDaily.tradeDate, candidate.endDate),
              ),
            )
            .groupBy(niftyStockDaily.symbol);

          const candidateSymbols = availabilityRows
            .filter((row) => row.rowCount >= minimumRows)
            .map((row) => row.symbol);

          if (candidateSymbols.length >= STOCKS_PER_COMPETITION) {
            competitionInput = candidate;
            eligibleSymbols = candidateSymbols;
            break;
          }
        }

        if (!competitionInput) {
          throw new Error(
            `Could not generate a ${duration} month competition with ${STOCKS_PER_COMPETITION} stocks having sufficient data after ${MAX_GENERATION_ATTEMPTS} attempts.`,
          );
        }

        await db.transaction(async (tx) => {
          const [insertedCompetition] = await tx
            .insert(competition)
            .values(competitionInput)
            .returning({ id: competition.id });

          if (!insertedCompetition) {
            throw new Error("Failed to insert competition row.");
          }

          const selectedSymbols = pickUniqueSymbols(
            eligibleSymbols,
            STOCKS_PER_COMPETITION,
          );
          const redactedDate = competitionInput.startDate;

          await tx.insert(competitionStock).values(
            selectedSymbols.map((symbol, index) => ({
              competitionId: insertedCompetition.id,
              symbol,
              redactedSymbol: buildRedactedSymbol(index),
              redactedCompanyName: buildRedactedCompanyName(index),
              redactedDate,
            })),
          );

          console.log(`Created competition: ${competitionInput.name}`);
          console.log(`Start: ${competitionInput.startDate}`);
          console.log(`End: ${competitionInput.endDate}`);
          console.log("");
          console.log("Stocks added (actual -> redacted):");
          for (const [index, symbol] of selectedSymbols.entries()) {
            console.log(
              `${symbol} -> ${buildRedactedSymbol(index)} / ${buildRedactedCompanyName(index)} (${redactedDate})`,
            );
          }
          console.log("\n");
        });
      }
    }

    console.log("Competition seeding complete. Created 40 competitions.");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("Failed to seed competitions:", error);
  process.exit(1);
});
