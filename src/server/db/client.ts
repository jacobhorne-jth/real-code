import fs from "node:fs";
import path from "node:path";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { pgSchema, sqliteSchema } from "./schema";

/**
 * The store is written against the SQLite table types. The Postgres tables
 * have identical column names and JS types, and Drizzle's query builder API
 * is the same for both, so a Postgres database is used through the same type.
 */
export type Db = BetterSQLite3Database<typeof sqliteSchema>;
export type Tables = typeof sqliteSchema;

export interface Database {
  dialect: "postgres" | "sqlite";
  db: Db;
  t: Tables;
  close(): Promise<void>;
}

const MIGRATIONS_DIR = path.join(process.cwd(), "drizzle");

export function sqlitePath(): string {
  return path.resolve(/*turbopackIgnore: true*/ process.env.SQLITE_PATH ?? path.join(process.cwd(), ".data", "realcode.db"));
}

async function openSqlite(): Promise<Database> {
  const [{ default: BetterSqlite3 }, { drizzle }, { migrate }] = await Promise.all([
    import("better-sqlite3"),
    import("drizzle-orm/better-sqlite3"),
    import("drizzle-orm/better-sqlite3/migrator"),
  ]);
  const file = sqlitePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const client = new BetterSqlite3(file);
  client.pragma("journal_mode = WAL");
  client.pragma("busy_timeout = 5000");
  const db = drizzle(client, { schema: sqliteSchema });
  // The local database migrates itself; Postgres is migrated explicitly (npm run db:migrate).
  migrate(db, { migrationsFolder: path.join(MIGRATIONS_DIR, "sqlite") });
  return {
    dialect: "sqlite",
    db,
    t: sqliteSchema,
    close: async () => {
      client.close();
    },
  };
}

async function openPostgres(url: string): Promise<Database> {
  const [{ default: postgres }, { drizzle }] = await Promise.all([
    import("postgres"),
    import("drizzle-orm/postgres-js"),
  ]);
  // prepare: false keeps this compatible with Supabase's transaction pooler.
  const client = postgres(url, { prepare: false, max: Number(process.env.DATABASE_POOL_MAX ?? 5) });
  const db = drizzle(client, { schema: pgSchema });
  return {
    dialect: "postgres",
    db: db as unknown as Db,
    t: pgSchema as unknown as Tables,
    close: () => client.end(),
  };
}

export function openDatabase(env: Record<string, string | undefined> = process.env): Promise<Database> {
  return env.DATABASE_URL ? openPostgres(env.DATABASE_URL) : openSqlite();
}

const globalForDb = globalThis as unknown as { __realcodeDb?: Promise<Database> };

/** Shared connection, reused across hot reloads in development. */
export function getDatabase(): Promise<Database> {
  if (!globalForDb.__realcodeDb) {
    globalForDb.__realcodeDb = openDatabase();
    globalForDb.__realcodeDb.catch(() => {
      globalForDb.__realcodeDb = undefined;
    });
  }
  return globalForDb.__realcodeDb;
}

/** For tests: drop the shared connection so the next call reopens it. */
export async function resetDatabaseForTests(): Promise<void> {
  const current = globalForDb.__realcodeDb;
  globalForDb.__realcodeDb = undefined;
  if (current) await (await current).close();
}
