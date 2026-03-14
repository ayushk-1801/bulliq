import { readFile } from "node:fs/promises";
import path from "node:path";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

async function main() {
  const envPath = path.resolve(process.cwd(), ".env");
  const content = await readFile(envPath, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      const [key, ...vals] = trimmed.split("=");
      if (key && !process.env[key.trim()]) {
         process.env[key.trim()] = vals.join("=").trim().replace(/^"|"$/g, "");
      }
    }
  }

  const databaseUrl = process.env.DATABASE_URL!;
  const client = postgres(databaseUrl, { max: 1 });
  const db = drizzle(client);

  try {
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "volatile_minute_candle_symbol_date_time_uq" ON "volatile_minute_candle" USING btree ("symbol","trade_date","candle_time");`);
    console.log("Created volatile_minute_candle_symbol_date_time_uq");
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "volatile_minute_candle_trade_date_idx" ON "volatile_minute_candle" USING btree ("trade_date");`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "volatile_minute_candle_symbol_idx" ON "volatile_minute_candle" USING btree ("symbol");`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "volatile_minute_candle_drastic_idx" ON "volatile_minute_candle" USING btree ("is_drastic_moment");`);
    
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "volatile_day_summary_symbol_trade_date_uq" ON "volatile_day_summary" USING btree ("symbol","trade_date");`);
    console.log("Created volatile_day_summary_symbol_trade_date_uq");
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "volatile_day_summary_trade_date_idx" ON "volatile_day_summary" USING btree ("trade_date");`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "volatile_day_summary_symbol_idx" ON "volatile_day_summary" USING btree ("symbol");`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "volatile_day_summary_volatility_idx" ON "volatile_day_summary" USING btree ("volatility_pct");`);
  } catch(e) {
    console.error(e);
  }
  
  await client.end();
}
main().catch(console.error);
