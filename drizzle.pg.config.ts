import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema.ts",
  out: "./drizzle/pg",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
