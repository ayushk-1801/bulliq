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
    await db.execute(sql`ALTER TABLE volatile_day_summary ADD COLUMN action text NOT NULL DEFAULT 'none';`);
    console.log("Added action column");
  } catch (e: any) {
    if (e.message && e.message.includes("already exists")) {
      console.log("Column already exists.");
    } else {
      console.error(e);
    }
  }
  
  await client.end();
}
main().catch(console.error);
