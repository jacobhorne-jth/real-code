/**
 * One logical schema, declared for both dialects. Column names and JS types
 * are identical, so the store works unchanged against either database.
 * Timestamps are epoch milliseconds; JSON payloads are stored as text.
 */
import * as pg from "drizzle-orm/pg-core";
import * as sqlite from "drizzle-orm/sqlite-core";

// ---------------------------------------------------------------- SQLite

export const sqliteSessions = sqlite.sqliteTable("sessions", {
  id: sqlite.text("id").primaryKey(),
  createdAt: sqlite.integer("created_at").notNull(),
});

export const sqliteAttempts = sqlite.sqliteTable(
  "attempts",
  {
    id: sqlite.text("id").primaryKey(),
    sessionId: sqlite.text("session_id").notNull(),
    problemId: sqlite.text("problem_id").notNull(),
    startedAt: sqlite.integer("started_at").notNull(),
    finishedAt: sqlite.integer("finished_at"),
  },
  (t) => [sqlite.index("attempts_problem_idx").on(t.problemId)],
);

export const sqliteSubmissions = sqlite.sqliteTable(
  "submissions",
  {
    id: sqlite.text("id").primaryKey(),
    sessionId: sqlite.text("session_id").notNull(),
    problemId: sqlite.text("problem_id").notNull(),
    stage: sqlite.integer("stage").notNull(),
    passed: sqlite.integer("passed", { mode: "boolean" }).notNull(),
    regressionCount: sqlite.integer("regression_count").notNull(),
    report: sqlite.text("report").notNull(),
    createdAt: sqlite.integer("created_at").notNull(),
  },
  (t) => [sqlite.index("submissions_session_problem_idx").on(t.sessionId, t.problemId)],
);

export const sqliteEvents = sqlite.sqliteTable(
  "events",
  {
    id: sqlite.text("id").primaryKey(),
    sessionId: sqlite.text("session_id").notNull(),
    problemId: sqlite.text("problem_id"),
    type: sqlite.text("type").notNull(),
    stage: sqlite.integer("stage"),
    data: sqlite.text("data"),
    createdAt: sqlite.integer("created_at").notNull(),
  },
  (t) => [
    sqlite.index("events_type_idx").on(t.type, t.problemId),
    sqlite.index("events_session_idx").on(t.sessionId),
  ],
);

export const sqliteFeedback = sqlite.sqliteTable("feedback", {
  id: sqlite.text("id").primaryKey(),
  sessionId: sqlite.text("session_id").notNull(),
  problemId: sqlite.text("problem_id").notNull(),
  feedback: sqlite.text("feedback"),
  email: sqlite.text("email"),
  createdAt: sqlite.integer("created_at").notNull(),
});

// ---------------------------------------------------------------- Postgres

const ms = (name: string) => pg.bigint(name, { mode: "number" });

export const pgSessions = pg.pgTable("sessions", {
  id: pg.text("id").primaryKey(),
  createdAt: ms("created_at").notNull(),
});

export const pgAttempts = pg.pgTable(
  "attempts",
  {
    id: pg.text("id").primaryKey(),
    sessionId: pg.text("session_id").notNull(),
    problemId: pg.text("problem_id").notNull(),
    startedAt: ms("started_at").notNull(),
    finishedAt: ms("finished_at"),
  },
  (t) => [pg.index("attempts_problem_idx").on(t.problemId)],
);

export const pgSubmissions = pg.pgTable(
  "submissions",
  {
    id: pg.text("id").primaryKey(),
    sessionId: pg.text("session_id").notNull(),
    problemId: pg.text("problem_id").notNull(),
    stage: pg.integer("stage").notNull(),
    passed: pg.boolean("passed").notNull(),
    regressionCount: pg.integer("regression_count").notNull(),
    report: pg.text("report").notNull(),
    createdAt: ms("created_at").notNull(),
  },
  (t) => [pg.index("submissions_session_problem_idx").on(t.sessionId, t.problemId)],
);

export const pgEvents = pg.pgTable(
  "events",
  {
    id: pg.text("id").primaryKey(),
    sessionId: pg.text("session_id").notNull(),
    problemId: pg.text("problem_id"),
    type: pg.text("type").notNull(),
    stage: pg.integer("stage"),
    data: pg.text("data"),
    createdAt: ms("created_at").notNull(),
  },
  (t) => [
    pg.index("events_type_idx").on(t.type, t.problemId),
    pg.index("events_session_idx").on(t.sessionId),
  ],
);

export const pgFeedback = pg.pgTable("feedback", {
  id: pg.text("id").primaryKey(),
  sessionId: pg.text("session_id").notNull(),
  problemId: pg.text("problem_id").notNull(),
  feedback: pg.text("feedback"),
  email: pg.text("email"),
  createdAt: ms("created_at").notNull(),
});

export const sqliteSchema = {
  sessions: sqliteSessions,
  attempts: sqliteAttempts,
  submissions: sqliteSubmissions,
  events: sqliteEvents,
  feedback: sqliteFeedback,
};

export const pgSchema = {
  sessions: pgSessions,
  attempts: pgAttempts,
  submissions: pgSubmissions,
  events: pgEvents,
  feedback: pgFeedback,
};
