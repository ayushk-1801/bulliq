import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import postgres from "postgres";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT_DIR, "src", "server", "nifty50");

// Load environment variables from .env file
async function loadEnv() {
  const envPath = path.join(ROOT_DIR, ".env");
  try {
    const content = await readFile(envPath, "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const [key, ...valueParts] = trimmed.split("=");
      if (key) {
        let value = valueParts.join("=").trim();
        if (value.startsWith('"') && value.endsWith('"')) {
          value = value.slice(1, -1);
        }
        process.env[key.trim()] = value;
      }
    }
  } catch (error) {
    console.warn("Warning: Could not load .env file:", error.message);
  }
}

await loadEnv();

function parseCsvLine(line) {
  const out = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      out.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  out.push(current);
  return out;
}

function parseCsv(content) {
  const lines = content
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);

  if (lines.length === 0) return [];

  const headers = parseCsvLine(lines[0]).map((header) => header.trim());
  const rows = [];

  for (let i = 1; i < lines.length; i += 1) {
    const values = parseCsvLine(lines[i]);
    const row = {};

    for (let j = 0; j < headers.length; j += 1) {
      row[headers[j]] = values[j]?.trim() ?? "";
    }

    rows.push(row);
  }

  return rows;
}

function toNullableInt(value) {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function toNullableFloat(value) {
  if (!value) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function chunk(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

async function upsertCompanies(sql) {
  const reportPath = path.join(DATA_DIR, "download_report.csv");
  const content = await readFile(reportPath, "utf8");
  const now = new Date().toISOString();
  const rows = parseCsv(content).map((row) => ({
    symbol: row.symbol,
    company_name: row.company_name,
    stock_file_stem: row.stock_file_stem,
    yahoo_symbol: row.yahoo_symbol,
    status: row.status || "unknown",
    stock_rows: toNullableInt(row.stock_rows) ?? 0,
    financial_files_written: toNullableInt(row.financial_files_written) ?? 0,
    empty_statements: toNullableInt(row.empty_statements),
    created_at: now,
  }));

  if (rows.length === 0) return 0;

  await sql`
    insert into "nifty_company"
      ${sql(rows, [
        "symbol",
        "company_name",
        "stock_file_stem",
        "yahoo_symbol",
        "status",
        "stock_rows",
        "financial_files_written",
        "empty_statements",
        "created_at",
      ])}
    on conflict ("symbol") do update set
      "company_name" = excluded."company_name",
      "stock_file_stem" = excluded."stock_file_stem",
      "yahoo_symbol" = excluded."yahoo_symbol",
      "status" = excluded."status",
      "stock_rows" = excluded."stock_rows",
      "financial_files_written" = excluded."financial_files_written",
      "empty_statements" = excluded."empty_statements"
  `;

  return rows.length;
}

async function upsertStockDaily(sql) {
  const stockDir = path.join(DATA_DIR, "stock_data_daily");
  const fileNames = (await readdir(stockDir)).filter((name) => name.endsWith(".csv"));

  let inserted = 0;
  const now = new Date().toISOString();

  for (const fileName of fileNames) {
    const symbol = path.basename(fileName, ".csv");
    const filePath = path.join(stockDir, fileName);
    const content = await readFile(filePath, "utf8");
    const parsedRows = parseCsv(content);

    const records = parsedRows
      .filter((row) => row.Date)
      .map((row) => ({
        symbol,
        yahoo_symbol: row.Symbol || `${symbol}.NS`,
        trade_date: row.Date,
        open: toNullableFloat(row.Open),
        high: toNullableFloat(row.High),
        low: toNullableFloat(row.Low),
        close: toNullableFloat(row.Close),
        adj_close: toNullableFloat(row["Adj Close"]),
        volume: toNullableInt(row.Volume),
        created_at: now,
      }));

    for (const batch of chunk(records, 500)) {
      await sql`
        insert into "nifty_stock_daily"
          ${sql(batch, [
            "symbol",
            "yahoo_symbol",
            "trade_date",
            "open",
            "high",
            "low",
            "close",
            "adj_close",
            "volume",
            "created_at",
          ])}
        on conflict ("symbol", "trade_date") do update set
          "yahoo_symbol" = excluded."yahoo_symbol",
          "open" = excluded."open",
          "high" = excluded."high",
          "low" = excluded."low",
          "close" = excluded."close",
          "adj_close" = excluded."adj_close",
          "volume" = excluded."volume"
      `;
    }

    inserted += records.length;
  }

  return inserted;
}

async function upsertFinancialMetrics(sql) {
  const financialDir = path.join(DATA_DIR, "company_financials_yearwise");
  const companyDirs = await readdir(financialDir, { withFileTypes: true });
  const statementFilePattern = /^(balance_sheet|income_statement|cash_flow)_(\d{4})\.csv$/;

  let inserted = 0;
  const now = new Date().toISOString();

  for (const entry of companyDirs) {
    if (!entry.isDirectory()) continue;

    const symbol = entry.name;
    const companyPath = path.join(financialDir, symbol);
    const files = (await readdir(companyPath)).filter((fileName) =>
      statementFilePattern.test(fileName),
    );

    for (const fileName of files) {
      const match = fileName.match(statementFilePattern);
      if (!match) continue;

      const statementType = match[1];
      const fiscalYear = Number.parseInt(match[2], 10);
      const filePath = path.join(companyPath, fileName);
      const content = await readFile(filePath, "utf8");

      const records = parseCsv(content)
        .filter((row) => row.metric)
        .map((row) => {
          const rawValue = row.value ?? "";
          const normalizedRaw = rawValue.length > 0 ? rawValue : null;

          return {
            symbol,
            statement_type: statementType,
            fiscal_year: fiscalYear,
            metric: row.metric,
            numeric_value: toNullableFloat(rawValue),
            raw_value: normalizedRaw,
            created_at: now,
          };
        });

      for (const batch of chunk(records, 500)) {
        await sql`
          insert into "nifty_financial_metric"
            ${sql(batch, [
              "symbol",
              "statement_type",
              "fiscal_year",
              "metric",
              "numeric_value",
              "raw_value",
              "created_at",
            ])}
          on conflict ("symbol", "statement_type", "fiscal_year", "metric") do update set
            "numeric_value" = excluded."numeric_value",
            "raw_value" = excluded."raw_value"
        `;
      }

      inserted += records.length;
    }
  }

  return inserted;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set.");
  }

  const sql = postgres(process.env.DATABASE_URL, { max: 1 });

  try {
    console.log("Seeding Nifty50 data...");

    const companyCount = await upsertCompanies(sql);
    const stockCount = await upsertStockDaily(sql);
    const metricCount = await upsertFinancialMetrics(sql);

    console.log(`Done. Upserted ${companyCount} companies.`);
    console.log(`Done. Upserted ${stockCount} daily stock rows.`);
    console.log(`Done. Upserted ${metricCount} financial metric rows.`);
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error("Failed to seed Nifty50 data:", error);
  process.exit(1);
});
