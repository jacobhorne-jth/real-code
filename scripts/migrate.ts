/**
 * Apply database migrations.
 *
 *   DATABASE_URL=postgres://... npm run db:migrate   # Postgres / Supabase
 *   npm run db:migrate                              # local SQLite file
 */
import path from "node:path";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    // SQLite migrates itself on first connection; opening it is enough.
    const { openDatabase, sqlitePath } = await import("../src/server/db/client");
    const db = await openDatabase({});
    await db.close();
    console.log(`SQLite database is up to date: ${sqlitePath()}`);
    return;
  }

  const [{ default: postgres }, { drizzle }, { migrate }] = await Promise.all([
    import("postgres"),
    import("drizzle-orm/postgres-js"),
    import("drizzle-orm/postgres-js/migrator"),
  ]);
  const client = postgres(url, { prepare: false, max: 1 });
  try {
    await migrate(drizzle(client), { migrationsFolder: path.join(process.cwd(), "drizzle", "pg") });
    console.log("Postgres migrations applied.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
