import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import {
  competition,
  competitionStock,
  niftyCompany,
} from "../src/server/db/schema";

type NewsCategory = "finance" | "global" | "company" | "industry";

type RssArticle = {
  title: string;
  link: string;
  publishedAt: string | null;
  source: string | null;
};

type StockNewsResult = {
  symbol: string;
  companyName: string;
  redactedSymbol: string | null;
  redactedCompanyName: string | null;
  categories: Record<NewsCategory, RssArticle[]>;
};

type CompetitionNewsResult = {
  competitionId: number;
  competitionName: string;
  startDate: string;
  endDate: string;
  newsWindow: {
    from: string;
    to: string;
  };
  stocks: StockNewsResult[];
};

type CompanyProfile = {
  sector: string | null;
  industry: string | null;
};

type StockRow = {
  competitionId: number;
  competitionName: string;
  competitionStartDate: string;
  competitionEndDate: string;
  symbol: string;
  companyName: string;
  redactedSymbol: string | null;
  redactedCompanyName: string | null;
};

const TOP_NEWS_PER_CATEGORY = 5;
const GOOGLE_NEWS_RSS_BASE = "https://news.google.com/rss/search";
const REQUEST_DELAY_MS = 350;
const DEFAULT_COMPETITION_LIMIT = 3;
const MAX_COMPETITION_LIMIT = 1000;
const RSS_CACHE = new Map<string, RssArticle[]>();

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

function parseIntegerArg(name: string, fallback: number): number {
  const raw = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  if (!raw) return fallback;

  const value = Number(raw.split("=")[1]);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid --${name} value: ${raw}. Must be a positive integer.`);
  }

  return value;
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

function formatDateOnlyUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseDateOnlyUtc(dateOnly: string): Date {
  const [year, month, day] = dateOnly.split("-").map(Number);
  if (!year || !month || !day) {
    throw new Error(`Invalid date string: ${dateOnly}`);
  }

  return new Date(Date.UTC(year, month - 1, day));
}

function addMonthsUtc(date: Date, months: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + months;
  const day = date.getUTCDate();

  const lastDayOfTargetMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const clampedDay = Math.min(day, lastDayOfTargetMonth);

  return new Date(Date.UTC(year, month, clampedDay));
}

function subtractDaysUtc(date: Date, days: number): Date {
  return new Date(date.getTime() - days * 24 * 60 * 60 * 1000);
}

function decodeXmlEntities(input: string): string {
  return input
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&#x27;", "'");
}

function stripCdata(input: string): string {
  return input
    .replace(/^<!\[CDATA\[/, "")
    .replace(/\]\]>$/, "")
    .trim();
}

function extractTagValue(itemXml: string, tagName: string): string | null {
  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i");
  const match = itemXml.match(regex);
  if (!match?.[1]) return null;

  return decodeXmlEntities(stripCdata(match[1].trim()));
}

function parseRss(xml: string, maxItems: number): RssArticle[] {
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  const articles: RssArticle[] = [];
  const seen = new Set<string>();

  let itemMatch: RegExpExecArray | null = itemRegex.exec(xml);
  while (itemMatch && articles.length < maxItems) {
    const itemXml = itemMatch[1];
    if (!itemXml) {
      itemMatch = itemRegex.exec(xml);
      continue;
    }

    const title = extractTagValue(itemXml, "title");
    const link = extractTagValue(itemXml, "link");

    if (title && link) {
      const key = `${title.toLowerCase()}::${link}`;
      if (!seen.has(key)) {
        seen.add(key);

        articles.push({
          title,
          link,
          publishedAt: extractTagValue(itemXml, "pubDate"),
          source: extractTagValue(itemXml, "source"),
        });
      }
    }

    itemMatch = itemRegex.exec(xml);
  }

  return articles;
}

function buildGoogleNewsUrl(query: string, fromDate: string, toDate: string): string {
  const q = `${query} after:${fromDate} before:${toDate}`;
  const url = new URL(GOOGLE_NEWS_RSS_BASE);
  url.searchParams.set("q", q);
  url.searchParams.set("hl", "en-IN");
  url.searchParams.set("gl", "IN");
  url.searchParams.set("ceid", "IN:en");

  return url.toString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function buildCategoryQuerySets(
  companyName: string,
  symbol: string,
  profile: CompanyProfile,
): Record<NewsCategory, string[]> {
  const cleanCompany = companyName.replace(/[.&]/g, " ").trim();
  const cleanIndustry = profile.industry?.replace(/[.&]/g, " ").trim() ?? null;
  const cleanSector = profile.sector?.replace(/[.&]/g, " ").trim() ?? null;

  const industryQueries = [
    cleanIndustry ? `\"${cleanIndustry}\" India stock outlook` : null,
    cleanSector ? `\"${cleanSector}\" India companies market` : null,
    `\"${cleanCompany}\" industry India`,
    `${symbol} sector India`,
  ].filter((query): query is string => Boolean(query));

  return {
    finance: [
      "finance markets economy India",
      "Indian stock market finance policy economy",
    ],
    global: [
      "global economy geopolitics markets",
      "international markets inflation oil rates",
    ],
    company: [
      `\"${companyName}\" stock India`,
      `${symbol} NSE stock news`,
      `${cleanCompany} share price news`,
      `${symbol} company results India`,
    ],
    industry: industryQueries,
  };
}

function mergeUniqueArticles(
  existing: RssArticle[],
  incoming: RssArticle[],
  maxItems: number,
): RssArticle[] {
  const merged = [...existing];
  const seen = new Set(merged.map((item) => `${item.title.toLowerCase()}::${item.link}`));

  for (const item of incoming) {
    const key = `${item.title.toLowerCase()}::${item.link}`;
    if (seen.has(key)) continue;

    seen.add(key);
    merged.push(item);
    if (merged.length >= maxItems) break;
  }

  return merged;
}

async function fetchCompanyProfile(symbol: string): Promise<CompanyProfile> {
  const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}.NS?modules=assetProfile`;

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "BullIQ-News-Preview/1.0",
      },
    });

    if (!response.ok) {
      return { sector: null, industry: null };
    }

    const data = (await response.json()) as {
      quoteSummary?: {
        result?: Array<{
          assetProfile?: {
            sector?: string;
            industry?: string;
          };
        }>;
      };
    };

    const profile = data.quoteSummary?.result?.[0]?.assetProfile;
    return {
      sector: profile?.sector ?? null,
      industry: profile?.industry ?? null,
    };
  } catch {
    return { sector: null, industry: null };
  }
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
}

async function fetchCategoryNews(
  category: NewsCategory,
  query: string,
  fromDate: string,
  toDate: string,
): Promise<{ articles: RssArticle[]; fromCache: boolean }> {
  const url = buildGoogleNewsUrl(query, fromDate, toDate);
  const cached = RSS_CACHE.get(url);
  if (cached) {
    return { articles: cached, fromCache: true };
  }

  const response = await fetch(url, {
    headers: {
      "User-Agent": "BullIQ-News-Preview/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch ${category} news. HTTP ${response.status} ${response.statusText}`,
    );
  }

  const xml = await response.text();
  const parsed = parseRss(xml, TOP_NEWS_PER_CATEGORY);
  RSS_CACHE.set(url, parsed);
  return { articles: parsed, fromCache: false };
}

async function main() {
  await loadEnv();

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set. Provide it via .env or shell env.");
  }

  const requestedCompetitionLimit = parseIntegerArg(
    "competitionLimit",
    DEFAULT_COMPETITION_LIMIT,
  );
  const competitionLimit = Math.min(requestedCompetitionLimit, MAX_COMPETITION_LIMIT);
  const symbolFilter = parseStringArg("symbol")?.toUpperCase() ?? null;
  const printSummaryOnly = parseBooleanFlag("summaryOnly");
  const outputFileArg = parseStringArg("outputFile");
  const startedAt = Date.now();

  const client = postgres(databaseUrl, { max: 1 });
  const db = drizzle(client);

  try {
    const stockRows = await db
      .select({
        competitionId: competition.id,
        competitionName: competition.name,
        competitionStartDate: competition.startDate,
        competitionEndDate: competition.endDate,
        symbol: competitionStock.symbol,
        companyName: niftyCompany.companyName,
        redactedSymbol: competitionStock.redactedSymbol,
        redactedCompanyName: competitionStock.redactedCompanyName,
      })
      .from(competitionStock)
      .innerJoin(competition, eq(competition.id, competitionStock.competitionId))
      .innerJoin(niftyCompany, eq(niftyCompany.symbol, competitionStock.symbol))
      .orderBy(asc(competition.startDate), asc(competition.id));

    const grouped = new Map<number, StockRow[]>();

    for (const row of stockRows) {
      if (symbolFilter && row.symbol.toUpperCase() !== symbolFilter) {
        continue;
      }

      const key = row.competitionId;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)?.push({
        competitionId: row.competitionId,
        competitionName: row.competitionName,
        competitionStartDate: row.competitionStartDate,
        competitionEndDate: row.competitionEndDate,
        symbol: row.symbol,
        companyName: row.companyName,
        redactedSymbol: row.redactedSymbol,
        redactedCompanyName: row.redactedCompanyName,
      });
    }

    const competitionEntries = [...grouped.entries()].slice(0, competitionLimit);

    if (competitionEntries.length === 0) {
      throw new Error(
        "No competition stocks found for the current filters. Try removing --symbol or increasing available data.",
      );
    }

    const results: CompetitionNewsResult[] = [];
    const profileCache = new Map<string, CompanyProfile>();
    const totalStocks = competitionEntries.reduce(
      (sum, [, rows]) => sum + rows.length,
      0,
    );
    let processedCompetitions = 0;
    let processedStocks = 0;

    console.log(
      `[start] competitions=${competitionEntries.length} stocks=${totalStocks} summaryOnly=${printSummaryOnly} symbolFilter=${symbolFilter ?? "none"}`,
    );

    const heartbeat = setInterval(() => {
      const elapsedSec = Math.floor((Date.now() - startedAt) / 1000);
      console.log(
        `[heartbeat] competitions=${processedCompetitions}/${competitionEntries.length} stocks=${processedStocks}/${totalStocks} elapsed=${elapsedSec}s`,
      );
    }, 30_000);

    try {
      for (const [, rows] of competitionEntries) {
        const first = rows[0];
        if (!first) continue;

        const startDate = parseDateOnlyUtc(first.competitionStartDate);
        const fromDate = formatDateOnlyUtc(addMonthsUtc(startDate, -1));
        const toDate = formatDateOnlyUtc(subtractDaysUtc(startDate, 1));

        console.log(
          `[competition] ${processedCompetitions + 1}/${competitionEntries.length} ${first.competitionName} window=${fromDate}..${toDate} stocks=${rows.length}`,
        );

        const stockResults: StockNewsResult[] = [];

        for (const row of rows) {
          if (!profileCache.has(row.symbol)) {
            const profile = await fetchCompanyProfile(row.symbol);
            profileCache.set(row.symbol, profile);
            await sleep(REQUEST_DELAY_MS);
          }

        const profile = profileCache.get(row.symbol) ?? {
          sector: null,
          industry: null,
        };
        const querySets = buildCategoryQuerySets(
          row.companyName,
          row.symbol,
          profile,
        );
        const categories = {} as Record<NewsCategory, RssArticle[]>;

          for (const category of ["finance", "global", "company", "industry"] as const) {
            categories[category] = [];

            for (const query of querySets[category]) {
              try {
                const fetched = await fetchCategoryNews(
                  category,
                  query,
                  fromDate,
                  toDate,
                );

                categories[category] = mergeUniqueArticles(
                  categories[category],
                  fetched.articles,
                  TOP_NEWS_PER_CATEGORY,
                );

                if (!fetched.fromCache) {
                  await sleep(REQUEST_DELAY_MS);
                }
              } catch (error) {
                console.warn(
                  `[WARN] ${first.competitionName} | ${row.symbol} | ${category} | query=${query}:`,
                  error,
                );
              }

              if (categories[category].length >= TOP_NEWS_PER_CATEGORY) {
                break;
              }
            }
          }

          stockResults.push({
            symbol: row.symbol,
            companyName: row.companyName,
            redactedSymbol: row.redactedSymbol,
            redactedCompanyName: row.redactedCompanyName,
            categories,
          });

          const previewCounts = Object.entries(categories)
            .map(([category, articles]) => `${category}:${articles.length}`)
            .join(" | ");

          processedStocks += 1;

          if (!printSummaryOnly) {
            console.log(
              `[preview] ${first.competitionName} | ${row.symbol} | ${fromDate}..${toDate} | ${previewCounts}`,
            );
          } else {
            const elapsedSec = Math.floor((Date.now() - startedAt) / 1000);
            console.log(
              `[progress] stocks=${processedStocks}/${totalStocks} competition=${processedCompetitions + 1}/${competitionEntries.length} symbol=${row.symbol} ${previewCounts} elapsed=${elapsedSec}s`,
            );
          }
        }

        results.push({
          competitionId: first.competitionId,
          competitionName: first.competitionName,
          startDate: first.competitionStartDate,
          endDate: first.competitionEndDate,
          newsWindow: {
            from: fromDate,
            to: toDate,
          },
          stocks: stockResults,
        });

        processedCompetitions += 1;
      }
    } finally {
      clearInterval(heartbeat);
    }

    const outputDir = path.resolve(process.cwd(), "scripts", "output");
    await mkdir(outputDir, { recursive: true });

    const fileName =
      outputFileArg ??
      `news-preview-${new Date().toISOString().replaceAll(":", "-")}-${slugify(symbolFilter ?? "all")}.json`;
    const outputPath = path.join(outputDir, fileName);

    await writeFile(outputPath, JSON.stringify(results, null, 2), "utf8");

    console.log("\nPreview generation complete.");
    console.log(`Competitions included: ${results.length}`);
    console.log(`Symbol filter: ${symbolFilter ?? "none"}`);
    console.log(`Saved report: ${outputPath}`);
    console.log(
      "Top 5 items per category were requested for: finance, global, company, industry.",
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("Failed to generate news preview:", error);
  process.exit(1);
});
