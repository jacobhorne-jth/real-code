import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  // Native / optional server-only packages that must not be bundled.
  serverExternalPackages: ["better-sqlite3", "modal"],
  // Problem files and the Python harness are read from disk at runtime.
  outputFileTracingIncludes: {
    "/**": ["./problem-bank/**/*", "./runner/harness.py"],
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
