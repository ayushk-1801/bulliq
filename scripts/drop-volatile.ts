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
  
  await db.execute(sql`DROP TABLE IF EXISTS "volatile_minute_candle" CASCADE`);
  await db.execute(sql`DROP TABLE IF EXISTS "volatile_day_summary" CASCADE`);
  
  await client.end();
}
main().catch(console.error);
