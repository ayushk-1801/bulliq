import { relations } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  pgTable,
  pgTableCreator,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const createTable = pgTableCreator((name) => name);

export const niftyCompany = createTable(
  "nifty_company",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    symbol: text("symbol").notNull(),
    companyName: text("company_name").notNull(),
    stockFileStem: text("stock_file_stem").notNull(),
    yahooSymbol: text("yahoo_symbol").notNull(),
    status: text("status").notNull(),
    stockRows: integer("stock_rows").notNull(),
    financialFilesWritten: integer("financial_files_written").notNull(),
    emptyStatements: integer("empty_statements"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (t) => [
    uniqueIndex("nifty_company_symbol_uq").on(t.symbol),
    uniqueIndex("nifty_company_yahoo_symbol_uq").on(t.yahooSymbol),
  ],
);

export const niftyStockDaily = createTable(
  "nifty_stock_daily",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    symbol: text("symbol").notNull(),
    yahooSymbol: text("yahoo_symbol").notNull(),
    tradeDate: date("trade_date").notNull(),
    open: doublePrecision("open"),
    high: doublePrecision("high"),
    low: doublePrecision("low"),
    close: doublePrecision("close"),
    adjClose: doublePrecision("adj_close"),
    volume: bigint("volume", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (t) => [
    index("nifty_stock_daily_symbol_idx").on(t.symbol),
    index("nifty_stock_daily_trade_date_idx").on(t.tradeDate),
    uniqueIndex("nifty_stock_daily_symbol_trade_date_uq").on(
      t.symbol,
      t.tradeDate,
    ),
  ],
);

export const niftyFinancialMetric = createTable(
  "nifty_financial_metric",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    symbol: text("symbol").notNull(),
    statementType: text("statement_type").notNull(),
    fiscalYear: integer("fiscal_year").notNull(),
    metric: text("metric").notNull(),
    numericValue: doublePrecision("numeric_value"),
    rawValue: text("raw_value"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (t) => [
    index("nifty_financial_metric_symbol_idx").on(t.symbol),
    index("nifty_financial_metric_statement_year_idx").on(
      t.statementType,
      t.fiscalYear,
    ),
    uniqueIndex("nifty_financial_metric_row_uq").on(
      t.symbol,
      t.statementType,
      t.fiscalYear,
      t.metric,
    ),
  ],
);

export const competition = createTable("competition", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  name: text("name").notNull(),
  durationMonths: integer("duration_months").notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  startingCapital: integer("starting_capital").notNull(),
  status: text("status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .$defaultFn(() => new Date())
    .notNull(),
});

export const competitionStock = createTable(
  "competition_stock",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    competitionId: integer("competition_id")
      .notNull()
      .references(() => competition.id, { onDelete: "cascade" }),
    symbol: text("symbol")
      .notNull()
      .references(() => niftyCompany.symbol, { onDelete: "cascade" }),
    redactedSymbol: text("redacted_symbol"),
    redactedCompanyName: text("redacted_company_name"),
    redactedDate: date("redacted_date"),
  },
  (t) => [
    uniqueIndex("competition_stock_competition_symbol_uq").on(
      t.competitionId,
      t.symbol,
    ),
  ],
);

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified")
    .$defaultFn(() => false)
    .notNull(),
  image: text("image"),
  createdAt: timestamp("created_at")
    .$defaultFn(() => /* @__PURE__ */ new Date())
    .notNull(),
  updatedAt: timestamp("updated_at")
    .$defaultFn(() => /* @__PURE__ */ new Date())
    .notNull(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").$defaultFn(
    () => /* @__PURE__ */ new Date(),
  ),
  updatedAt: timestamp("updated_at").$defaultFn(
    () => /* @__PURE__ */ new Date(),
  ),
});

export const userRelations = relations(user, ({ many }) => ({
  account: many(account),
  session: many(session),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, { fields: [account.userId], references: [user.id] }),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, { fields: [session.userId], references: [user.id] }),
}));

export const niftyCompanyRelations = relations(niftyCompany, ({ many }) => ({
  stockDaily: many(niftyStockDaily),
  financialMetrics: many(niftyFinancialMetric),
  competitionStocks: many(competitionStock),
}));

export const niftyStockDailyRelations = relations(niftyStockDaily, ({ one }) => ({
  company: one(niftyCompany, {
    fields: [niftyStockDaily.symbol],
    references: [niftyCompany.symbol],
  }),
}));

export const niftyFinancialMetricRelations = relations(
  niftyFinancialMetric,
  ({ one }) => ({
    company: one(niftyCompany, {
      fields: [niftyFinancialMetric.symbol],
      references: [niftyCompany.symbol],
    }),
  }),
);

export const competitionRelations = relations(competition, ({ many }) => ({
  competitionStocks: many(competitionStock),
}));

export const competitionStockRelations = relations(
  competitionStock,
  ({ one }) => ({
    competition: one(competition, {
      fields: [competitionStock.competitionId],
      references: [competition.id],
    }),
    company: one(niftyCompany, {
      fields: [competitionStock.symbol],
      references: [niftyCompany.symbol],
    }),
  }),
);
