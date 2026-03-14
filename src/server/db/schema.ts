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
    symbol: text("symbol").notNull().unique(),
    companyName: text("company_name").notNull(),
    stockFileStem: text("stock_file_stem").notNull(),
    yahooSymbol: text("yahoo_symbol").notNull().unique(),
    status: text("status").notNull(),
    stockRows: integer("stock_rows").notNull(),
    financialFilesWritten: integer("financial_files_written").notNull(),
    emptyStatements: integer("empty_statements"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
  },
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

export const competitionNews = createTable(
  "competition_news",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    competitionId: integer("competition_id")
      .notNull()
      .references(() => competition.id, { onDelete: "cascade" }),
    symbol: text("symbol")
      .notNull()
      .references(() => niftyCompany.symbol, { onDelete: "cascade" }),
    category: text("category").notNull(),
    rank: integer("rank").notNull(),
    title: text("title").notNull(),
    link: text("link").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    source: text("source"),
    windowFrom: date("window_from").notNull(),
    windowTo: date("window_to").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (t) => [
    index("competition_news_competition_idx").on(t.competitionId),
    index("competition_news_symbol_idx").on(t.symbol),
    index("competition_news_category_idx").on(t.category),
    uniqueIndex("competition_news_comp_symbol_category_rank_uq").on(
      t.competitionId,
      t.symbol,
      t.category,
      t.rank,
    ),
    uniqueIndex("competition_news_comp_symbol_category_link_uq").on(
      t.competitionId,
      t.symbol,
      t.category,
      t.link,
    ),
  ],
);

export const volatileDaySummary = createTable(
  "volatile_day_summary",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    symbol: text("symbol")
      .notNull()
      .references(() => niftyCompany.symbol, { onDelete: "cascade" }),
    tradeDate: date("trade_date").notNull(),
    volatilityPct: doublePrecision("volatility_pct").notNull(),
    open: doublePrecision("open").notNull(),
    high: doublePrecision("high").notNull(),
    low: doublePrecision("low").notNull(),
    close: doublePrecision("close").notNull(),
    totalVolume: bigint("total_volume", { mode: "number" }).notNull(),
    drasticChangeTime: timestamp("drastic_change_time", {
      withTimezone: true,
    }).notNull(),
    drasticChangePct: doublePrecision("drastic_change_pct").notNull(),
    action: text("action").notNull().default("none"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (t) => [
    uniqueIndex("volatile_day_summary_symbol_trade_date_uq").on(
      t.symbol,
      t.tradeDate,
    ),
    index("volatile_day_summary_trade_date_idx").on(t.tradeDate),
    index("volatile_day_summary_symbol_idx").on(t.symbol),
    index("volatile_day_summary_volatility_idx").on(t.volatilityPct),
  ],
);

export const volatileMinuteCandle = createTable(
  "volatile_minute_candle",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    symbol: text("symbol")
      .notNull()
      .references(() => niftyCompany.symbol, { onDelete: "cascade" }),
    tradeDate: date("trade_date").notNull(),
    candleTime: timestamp("candle_time", { withTimezone: true }).notNull(),
    open: doublePrecision("open").notNull(),
    high: doublePrecision("high").notNull(),
    low: doublePrecision("low").notNull(),
    close: doublePrecision("close").notNull(),
    volume: bigint("volume", { mode: "number" }).notNull(),
    minuteChangePct: doublePrecision("minute_change_pct"),
    isDrasticMoment: boolean("is_drastic_moment").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (t) => [
    uniqueIndex("volatile_minute_candle_symbol_date_time_uq").on(
      t.symbol,
      t.tradeDate,
      t.candleTime,
    ),
    index("volatile_minute_candle_trade_date_idx").on(t.tradeDate),
    index("volatile_minute_candle_symbol_idx").on(t.symbol),
    index("volatile_minute_candle_drastic_idx").on(t.isDrasticMoment),
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
  hasPassedKnowledgeCheck: boolean("has_passed_knowledge_check")
    .default(false)
    .notNull(),
  createdAt: timestamp("created_at")
    .$defaultFn(() => /* @__PURE__ */ new Date())
    .notNull(),
  updatedAt: timestamp("updated_at")
    .$defaultFn(() => /* @__PURE__ */ new Date())
    .notNull(),
});

export const leaderboard = createTable("leaderboard", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  rating: integer("rating").notNull().default(1000),
  competitionsPlayed: integer("competitions_played").notNull().default(0),
  wins: integer("wins").notNull().default(0),
  averageReturnPct: doublePrecision("average_return_pct").notNull().default(0),
  bestReturnPct: doublePrecision("best_return_pct"),
  lastRatingDelta: integer("last_rating_delta").notNull().default(0),
  lastPlayedAt: timestamp("last_played_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .$defaultFn(() => new Date())
    .notNull(),
});

export const competitionResult = createTable(
  "competition_result",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    competitionId: integer("competition_id")
      .notNull()
      .references(() => competition.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    finalPortfolioValue: doublePrecision("final_portfolio_value").notNull(),
    profitLoss: doublePrecision("profit_loss").notNull(),
    returnPct: doublePrecision("return_pct").notNull(),
    rank: integer("rank").notNull().default(1),
    participantsCount: integer("participants_count").notNull().default(1),
    ratingBefore: integer("rating_before").notNull().default(1000),
    ratingDelta: integer("rating_delta").notNull().default(0),
    ratingAfter: integer("rating_after").notNull().default(1000),
    completedAt: timestamp("completed_at", { withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (t) => [
    uniqueIndex("competition_result_competition_user_uq").on(
      t.competitionId,
      t.userId,
    ),
    index("competition_result_competition_idx").on(t.competitionId),
    index("competition_result_user_idx").on(t.userId),
  ],
);

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

export const userRelations = relations(user, ({ many, one }) => ({
  account: many(account),
  session: many(session),
  leaderboard: one(leaderboard, {
    fields: [user.id],
    references: [leaderboard.userId],
  }),
  competitionResults: many(competitionResult),
}));

export const leaderboardRelations = relations(leaderboard, ({ one }) => ({
  user: one(user, {
    fields: [leaderboard.userId],
    references: [user.id],
  }),
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
  volatileDaySummaries: many(volatileDaySummary),
  volatileMinuteCandles: many(volatileMinuteCandle),
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
  competitionNews: many(competitionNews),
  competitionResults: many(competitionResult),
}));

export const competitionResultRelations = relations(
  competitionResult,
  ({ one }) => ({
    competition: one(competition, {
      fields: [competitionResult.competitionId],
      references: [competition.id],
    }),
    user: one(user, {
      fields: [competitionResult.userId],
      references: [user.id],
    }),
  }),
);

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

export const competitionNewsRelations = relations(competitionNews, ({ one }) => ({
  competition: one(competition, {
    fields: [competitionNews.competitionId],
    references: [competition.id],
  }),
  company: one(niftyCompany, {
    fields: [competitionNews.symbol],
    references: [niftyCompany.symbol],
  }),
}));

export const volatileDaySummaryRelations = relations(
  volatileDaySummary,
  ({ one }) => ({
    company: one(niftyCompany, {
      fields: [volatileDaySummary.symbol],
      references: [niftyCompany.symbol],
    }),
  }),
);

export const volatileMinuteCandleRelations = relations(
  volatileMinuteCandle,
  ({ one }) => ({
    company: one(niftyCompany, {
      fields: [volatileMinuteCandle.symbol],
      references: [niftyCompany.symbol],
    }),
  }),
);
