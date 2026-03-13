import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { and, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { competitionNews } from "../src/server/db/schema";

type NewsCategory = "finance" | "global" | "company" | "industry";

type RssArticle = {
  title: string;
  link: string;
  publishedAt: string | null;
  source: string | null;
};

type StockNewsResult = {
  symbol: string;
  categories: Record<NewsCategory, RssArticle[]>;
};

type CompetitionNewsResult = {
  competitionId: number;
  newsWindow: {
    from: string;
    to: string;
  };
  stocks: StockNewsResult[];
};

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

function parseBooleanFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function toDateOrNull(input: string | null): Date | null {
  if (!input) return null;
  const parsed = new Date(input);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function findLatestPreviewFile(outputDir: string): Promise<string> {
  const files = await readdir(outputDir);
  const candidates = files.filter(
    (name) => name.startsWith("news-preview-") && name.endsWith(".json"),
  );

  if (candidates.length === 0) {
    throw new Error(`No preview files found in ${outputDir}`);
  }

  const withMtime = await Promise.all(
    candidates.map(async (name) => {
      const fullPath = path.join(outputDir, name);
      const stats = await stat(fullPath);
      return { fullPath, mtimeMs: stats.mtimeMs };
    }),
  );

  withMtime.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const latest = withMtime[0]?.fullPath;

  if (!latest) {
    throw new Error(`Could not determine latest preview file in ${outputDir}`);
  }

  return latest;
}

async function main() {
  await loadEnv();

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set. Provide it via .env or shell env.");
  }

  const outputDir = path.resolve(process.cwd(), "scripts", "output");
  const inputFileArg = parseStringArg("inputFile");
  const replaceExisting = parseBooleanFlag("replace");

  const inputPath = inputFileArg
    ? path.resolve(outputDir, inputFileArg)
    : await findLatestPreviewFile(outputDir);

  const raw = await readFile(inputPath, "utf8");
  const parsed = JSON.parse(raw) as CompetitionNewsResult[];

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error(`Input file has no competition news data: ${inputPath}`);
  }

  const client = postgres(databaseUrl, { max: 1 });
  const db = drizzle(client);

  try {
    const rows = parsed.flatMap((competitionItem) =>
      competitionItem.stocks.flatMap((stock) =>
        (Object.entries(stock.categories) as Array<[NewsCategory, RssArticle[]]>).flatMap(
          ([category, articles]) =>
            articles.map((article, index) => ({
              competitionId: competitionItem.competitionId,
              symbol: stock.symbol,
              category,
              rank: index + 1,
              title: article.title,
              link: article.link,
              publishedAt: toDateOrNull(article.publishedAt),
              source: article.source,
              windowFrom: competitionItem.newsWindow.from,
              windowTo: competitionItem.newsWindow.to,
            })),
        ),
      ),
    );

    if (rows.length === 0) {
      throw new Error(`Input file contains zero news rows to insert: ${inputPath}`);
    }

    if (replaceExisting) {
      const competitionIds = [...new Set(parsed.map((item) => item.competitionId))];
      const symbols = [
        ...new Set(parsed.flatMap((item) => item.stocks.map((stock) => stock.symbol))),
      ];

      await db
        .delete(competitionNews)
        .where(
          and(
            inArray(competitionNews.competitionId, competitionIds),
            inArray(competitionNews.symbol, symbols),
          ),
        );
    }

    for (const row of rows) {
      await db
        .insert(competitionNews)
        .values(row)
        .onConflictDoUpdate({
          target: [
            competitionNews.competitionId,
            competitionNews.symbol,
            competitionNews.category,
            competitionNews.rank,
          ],
          set: {
            title: row.title,
            link: row.link,
            publishedAt: row.publishedAt,
            source: row.source,
            windowFrom: row.windowFrom,
            windowTo: row.windowTo,
          },
        });
    }

    const insertedCompetitions = new Set(parsed.map((item) => item.competitionId)).size;
    console.log(`Saved news rows: ${rows.length}`);
    console.log(`Competitions covered: ${insertedCompetitions}`);
    console.log(`Input file: ${inputPath}`);
    console.log(`Replace mode: ${replaceExisting ? "on" : "off"}`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("Failed to save competition news:", error);
  process.exit(1);
});
