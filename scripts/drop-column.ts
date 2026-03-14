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
    await db.execute(sql`ALTER TABLE volatile_day_summary DROP COLUMN action CASCADE;`);
    console.log("Dropped action column");
  } catch (e: any) {
    if (e.message && e.message.includes("does not exist")) {
      console.log("Column does not exist.");
    } else {
      console.error(e);
    }
  }

  try {
    // Delete the migration record so it can be applied cleanly
    await db.execute(sql`DELETE FROM __drizzle_migrations WHERE tag = '0005_organic_iron_man';`);
  } catch(e) {}
  
  await client.end();
}
main().catch(console.error);
