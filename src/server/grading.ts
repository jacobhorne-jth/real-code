import type { TestCase } from "./problems/loader";
import type { RunResponse } from "./runner/types";

export type OutcomeKind = "passed" | "wrong_answer" | "error" | "timeout" | "not_run";

export interface TestOutcome {
  id: string;
  name: string;
  kind: OutcomeKind;
  /** Index of the first operation that failed, if any. */
  opIndex: number | null;
  /** Human-readable explanation. May include inputs, so only show for public tests. */
  message: string | null;
  expected?: unknown;
  actual?: unknown;
  stdout: string;
  elapsedMs: number;
}

/** Structural equality over JSON values. Types must match exactly (True != 1). */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") {
    return false;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    return a.length === bb.length && a.every((v, i) => jsonEqual(v, bb[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao);
  if (ak.length !== Object.keys(bo).length) return false;
  return ak.every((k) => Object.prototype.hasOwnProperty.call(bo, k) && jsonEqual(ao[k], bo[k]));
}

/** Render a JSON value the way Python would print it, truncated for display. */
export function pyRepr(value: unknown, maxLen = 300): string {
  const out = reprInner(value, 0);
  return out.length > maxLen ? `${out.slice(0, maxLen)}…` : out;
}

function reprInner(value: unknown, depth: number): string {
  if (depth > 20) return "…";
  if (value === null || value === undefined) return "None";
  if (value === true) return "True";
  if (value === false) return "False";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : String(value);
  if (typeof value === "string") return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n")}'`;
  if (Array.isArray(value)) return `[${value.map((v) => reprInner(v, depth + 1)).join(", ")}]`;
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj.__unserializable__ === "string" && Object.keys(obj).length === 1) {
      return `${obj.__unserializable__} (not a JSON-compatible value)`;
    }
    return `{${Object.entries(obj)
      .map(([k, v]) => `${reprInner(k, depth + 1)}: ${reprInner(v, depth + 1)}`)
      .join(", ")}}`;
  }
  return String(value);
}

export function formatCall(op: string, args: unknown[]): string {
  const inner = args.map((a) => pyRepr(a, 80)).join(", ");
  return `${op}(${inner.length > 200 ? `${inner.slice(0, 200)}…` : inner})`;
}

function describeOp(test: TestCase, index: number): string {
  const op = test.ops[index];
  return `operation #${index + 1}: ${formatCall(op.op, op.args)}`;
}

/** Compare the sandbox's actual return values with the expected ones. */
export function gradeTests(tests: TestCase[], response: RunResponse): TestOutcome[] {
  return tests.map((test) => {
    const base = { id: test.id, name: test.name, stdout: "", elapsedMs: 0 };
    if (response.loadError) {
      return { ...base, kind: "error", opIndex: null, message: response.loadError };
    }
    const raw = response.results.get(test.id);
    if (!raw) {
      return {
        ...base,
        kind: response.processError?.includes("time limit") ? "timeout" : "not_run",
        opIndex: null,
        message: response.processError ?? "This test did not run",
      };
    }
    const withRaw = { ...base, stdout: raw.stdout, elapsedMs: raw.elapsedMs };

    // Compare every value the code produced, in order, before looking at how it stopped.
    const compared = Math.min(raw.actuals.length, test.ops.length);
    for (let i = 0; i < compared; i++) {
      if (!jsonEqual(raw.actuals[i], test.ops[i].expect)) {
        return {
          ...withRaw,
          kind: "wrong_answer",
          opIndex: i,
          message: `Wrong result at ${describeOp(test, i)}`,
          expected: test.ops[i].expect,
          actual: raw.actuals[i],
        };
      }
    }
    if (raw.status === "timeout") {
      return {
        ...withRaw,
        kind: "timeout",
        opIndex: compared < test.ops.length ? compared : null,
        message: `${raw.error ?? "Time limit exceeded"}${
          compared < test.ops.length ? ` (while running ${describeOp(test, compared)})` : ""
        }`,
      };
    }
    if (raw.status === "error") {
      return {
        ...withRaw,
        kind: "error",
        opIndex: compared < test.ops.length ? compared : null,
        message: `${compared < test.ops.length ? `${describeOp(test, compared)} raised ` : ""}${
          raw.error ?? "an error"
        }`,
      };
    }
    if (raw.actuals.length !== test.ops.length) {
      return { ...withRaw, kind: "error", opIndex: null, message: "Incomplete results from the sandbox" };
    }
    return { ...withRaw, kind: "passed", opIndex: null, message: null };
  });
}
