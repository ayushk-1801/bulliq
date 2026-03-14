import { readFile } from "node:fs/promises";
import path from "node:path";

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { niftyCompany, volatileDaySummary, volatileMinuteCandle } from "../src/server/db/schema";

type SummaryRow = {
  symbol: string;
  tradeDate: string;
  volatilityPct: number;
  open: number;
  high: number;
  low: number;
  close: number;
  totalVolume: number;
  drasticChangeTime: Date;
  drasticChangePct: number;
  action: string;
};

type MinuteRow = {
  symbol: string;
  tradeDate: string;
  candleTime: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  minuteChangePct: number | null;
  isDrasticMoment: boolean;
};

const SUMMARY_BATCH_SIZE = 500;
const MINUTE_BATCH_SIZE = 2000;

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
    // Ignore missing local .env and rely on shell vars.
  }
}

function parseStringArg(name: string): string | null {
  const raw = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  if (!raw) return null;

  const value = raw.slice(`--${name}=`.length).trim();
  return value.length > 0 ? value : null;
}

function parseIntegerArg(name: string, fallback: number): number {
  const raw = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  if (!raw) return fallback;

  const parsed = Number(raw.split("=")[1]);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid --${name} value: ${raw}`);
  }

  return parsed;
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (char === '"') {
      const nextChar = line[i + 1];
      if (inQuotes && nextChar === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      fields.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  fields.push(current);
  return fields;
}

function parseCsv(fileContent: string): string[][] {
  const lines = fileContent
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length <= 1) return [];

  return lines.slice(1).map(parseCsvLine);
}

function getField(values: string[], index: number, rowType: string): string {
  const value = values[index];
  if (value === undefined) {
    throw new Error(`Missing field at index ${index} in ${rowType} row`);
  }
  return value;
}

function parseSummaryRows(fileContent: string): SummaryRow[] {
  return parseCsv(fileContent).map((values) => {
    if (values.length < 10) {
      throw new Error(`Invalid summary CSV row: ${values.join(",")}`);
    }

    const symbol = getField(values, 0, "summary");
    const tradeDate = getField(values, 1, "summary");
    const volatilityPct = getField(values, 2, "summary");
    const open = getField(values, 3, "summary");
    const high = getField(values, 4, "summary");
    const low = getField(values, 5, "summary");
    const close = getField(values, 6, "summary");
    const totalVolume = getField(values, 7, "summary");
    const drasticChangeTime = getField(values, 8, "summary");
    const drasticChangePct = getField(values, 9, "summary");
    const action = getField(values, 10, "summary");

    return {
      symbol,
      tradeDate,
      volatilityPct: Number(volatilityPct),
      open: Number(open),
      high: Number(high),
      low: Number(low),
      close: Number(close),
      totalVolume: Number(totalVolume),
      drasticChangeTime: new Date(drasticChangeTime),
      drasticChangePct: Number(drasticChangePct),
      action,
    };
  });
}

function parseMinuteRows(fileContent: string): MinuteRow[] {
  return parseCsv(fileContent).map((values) => {
    if (values.length < 10) {
      throw new Error(`Invalid minute CSV row: ${values.join(",")}`);
    }

    const symbol = getField(values, 0, "minute");
    const tradeDate = getField(values, 1, "minute");
    const datetime = getField(values, 2, "minute");
    const open = getField(values, 3, "minute");
    const high = getField(values, 4, "minute");
    const low = getField(values, 5, "minute");
    const close = getField(values, 6, "minute");
    const volume = getField(values, 7, "minute");
    const minuteChangePct = getField(values, 8, "minute");
    const isDrasticMoment = getField(values, 9, "minute");

    return {
      symbol,
      tradeDate,
      candleTime: new Date(datetime),
      open: Number(open),
      high: Number(high),
      low: Number(low),
      close: Number(close),
      volume: Number(volume),
      minuteChangePct: minuteChangePct.length === 0 ? null : Number(minuteChangePct),
      isDrasticMoment: isDrasticMoment.toLowerCase() === "true",
    };
  });
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function main() {
  await loadEnv();

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set. Provide it via .env or shell env.");
  }

  const outputDir = path.resolve(process.cwd(), "scripts", "output");
  const summaryFile = parseStringArg("summaryFile") ?? "volatile_days_summary.csv";
  const minuteFile =
    parseStringArg("minuteFile") ?? "volatile_days_intraday_data.csv";
  const summaryBatchSize = parseIntegerArg("summaryBatchSize", SUMMARY_BATCH_SIZE);
  const minuteBatchSize = parseIntegerArg("minuteBatchSize", MINUTE_BATCH_SIZE);

  const summaryPath = path.resolve(outputDir, summaryFile);
  const minutePath = path.resolve(outputDir, minuteFile);

  const [summaryContent, minuteContent] = await Promise.all([
    readFile(summaryPath, "utf8"),
    readFile(minutePath, "utf8"),
  ]);

  const summaryRows = parseSummaryRows(summaryContent);
  const minuteRows = parseMinuteRows(minuteContent);

  if (summaryRows.length === 0) {
    throw new Error(`No rows found in summary CSV: ${summaryPath}`);
  }

  if (minuteRows.length === 0) {
    throw new Error(`No rows found in minute CSV: ${minutePath}`);
  }

  const client = postgres(databaseUrl, { max: 1 });
  const db = drizzle(client);

  try {
    const validCompanies = await db.select({ symbol: niftyCompany.symbol }).from(niftyCompany);
    const validSymbols = new Set(validCompanies.map((c) => c.symbol));

    const validSummaryRows = summaryRows.filter((r) => validSymbols.has(r.symbol));
    const validMinuteRows = minuteRows.filter((r) => validSymbols.has(r.symbol));

    const summaryChunks = chunkArray(validSummaryRows, summaryBatchSize);
    let upsertedSummary = 0;

    await db.delete(volatileMinuteCandle);
    await db.delete(volatileDaySummary);

    for (const batch of summaryChunks) {
      await db
        .insert(volatileDaySummary)
        .values(
          batch.map((row) => ({
            symbol: row.symbol,
            tradeDate: row.tradeDate,
            volatilityPct: row.volatilityPct,
            open: row.open,
            high: row.high,
            low: row.low,
            close: row.close,
            totalVolume: row.totalVolume,
            drasticChangeTime: row.drasticChangeTime,
            drasticChangePct: row.drasticChangePct,
            action: row.action,
            updatedAt: new Date(),
          })),
        )
        .onConflictDoUpdate({
          target: [volatileDaySummary.symbol, volatileDaySummary.tradeDate],
          set: {
            volatilityPct: sql`excluded.volatility_pct`,
            open: sql`excluded.open`,
            high: sql`excluded.high`,
            low: sql`excluded.low`,
            close: sql`excluded.close`,
            totalVolume: sql`excluded.total_volume`,
            drasticChangeTime: sql`excluded.drastic_change_time`,
            drasticChangePct: sql`excluded.drastic_change_pct`,
            action: sql`excluded.action`,
            updatedAt: new Date(),
          },
        });

      upsertedSummary += batch.length;
    }

    const minuteChunks = chunkArray(validMinuteRows, minuteBatchSize);
    let upsertedMinute = 0;

    for (const batch of minuteChunks) {
      await db
        .insert(volatileMinuteCandle)
        .values(
          batch.map((row) => ({
            symbol: row.symbol,
            tradeDate: row.tradeDate,
            candleTime: row.candleTime,
            open: row.open,
            high: row.high,
            low: row.low,
            close: row.close,
            volume: row.volume,
            minuteChangePct: row.minuteChangePct,
            isDrasticMoment: row.isDrasticMoment,
            updatedAt: new Date(),
          })),
        )
        .onConflictDoUpdate({
          target: [
            volatileMinuteCandle.symbol,
            volatileMinuteCandle.tradeDate,
            volatileMinuteCandle.candleTime,
          ],
          set: {
            open: sql`excluded.open`,
            high: sql`excluded.high`,
            low: sql`excluded.low`,
            close: sql`excluded.close`,
            volume: sql`excluded.volume`,
            minuteChangePct: sql`excluded.minute_change_pct`,
            isDrasticMoment: sql`excluded.is_drastic_moment`,
            updatedAt: new Date(),
          },
        });

      upsertedMinute += batch.length;
    }

    console.log(`Summary rows upserted: ${upsertedSummary}`);
    console.log(`Minute rows upserted: ${upsertedMinute}`);
    console.log(`Summary source: ${summaryPath}`);
    console.log(`Minute source: ${minutePath}`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("Failed to save volatile minute data:", error);
  process.exit(1);
});
