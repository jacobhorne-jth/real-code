import type { RawStatus, RawTestResult, RunRequest, RunResponse } from "./types";

export const MEMORY_LIMIT_MB = 512;
/** Fixed allowance for interpreter start-up and loading the user's code. */
const STARTUP_BUDGET_MS = 6_000;
export const MAX_RUN_BUDGET_MS = 120_000;

/** Payload format read by runner/harness.py on stdin. */
export function buildHarnessPayload(request: RunRequest) {
  return {
    code: request.code,
    class_name: request.className,
    memory_limit_mb: MEMORY_LIMIT_MB,
    tests: request.tests.map((t) => ({
      id: t.id,
      time_limit_ms: t.timeLimitMs,
      ops: t.ops.map((o) => ({ op: o.op, args: o.args })),
    })),
  };
}

/** Wall-clock budget for the whole process: every test's limit plus start-up. */
export function overallBudgetMs(request: RunRequest): number {
  const total = request.tests.reduce((sum, t) => sum + t.timeLimitMs, 0);
  return Math.min(total + STARTUP_BUDGET_MS, MAX_RUN_BUDGET_MS);
}

const STATUSES: ReadonlySet<string> = new Set(["ok", "error", "timeout"]);

/**
 * Parse the harness's JSON-lines output. The file is written from inside the
 * sandbox, so every field is validated and anything malformed is ignored.
 */
export function parseHarnessOutput(
  text: string,
  request: RunRequest,
): Pick<RunResponse, "loadError" | "results"> {
  const known = new Set(request.tests.map((t) => t.id));
  const results = new Map<string, RawTestResult>();
  let loadError: string | null = null;

  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
    const rec = parsed as Record<string, unknown>;

    if (typeof rec.load_error === "string") {
      loadError ??= rec.load_error.slice(0, 2000);
      continue;
    }
    if (typeof rec.id !== "string" || !known.has(rec.id) || results.has(rec.id)) continue;
    if (typeof rec.status !== "string" || !STATUSES.has(rec.status)) continue;
    if (!Array.isArray(rec.actuals)) continue;

    results.set(rec.id, {
      id: rec.id,
      status: rec.status as RawStatus,
      actuals: rec.actuals,
      error: typeof rec.error === "string" ? rec.error.slice(0, 2000) : null,
      stdout: typeof rec.stdout === "string" ? rec.stdout.slice(0, 8192) : "",
      elapsedMs: typeof rec.elapsed_ms === "number" ? rec.elapsed_ms : 0,
    });
  }
  return { loadError, results };
}

export function describeProcessFailure(opts: {
  timedOut: boolean;
  exitCode: number | null;
  signal: string | null;
  stderr: string;
  budgetMs: number;
}): string | null {
  if (opts.timedOut) {
    return `Execution stopped after ${Math.round(opts.budgetMs / 1000)}s (overall time limit exceeded)`;
  }
  if (opts.signal) {
    return `Your program was terminated (${opts.signal}), possibly by exceeding the memory limit`;
  }
  if (opts.exitCode !== 0 && opts.exitCode !== null) {
    if (/MemoryError/.test(opts.stderr)) return "Memory limit exceeded";
    return `Your program exited unexpectedly (exit code ${opts.exitCode})`;
  }
  return null;
}
