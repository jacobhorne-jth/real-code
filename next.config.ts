import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  // Native / optional server-only packages that must not be bundled.
  serverExternalPackages: ["better-sqlite3", "modal"],
  // Problem files and the Python harness are read from disk at runtime.
  // Reference solutions, hints and generators are only used offline, so they
  // are deliberately left out of the deployed bundle.
  outputFileTracingIncludes: {
    "/**": [
      "./problem-bank/*/problem.yaml",
      "./problem-bank/*/stage*.md",
      "./problem-bank/*/starter.py",
      "./problem-bank/*/tests/*.json",
      "./runner/harness.py",
      "./drizzle/**/*",
    ],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
