import "server-only";
import { z } from "zod";
import type { ApiError } from "@/lib/api-types";
import { sessionExists } from "./db/store";
import { MAX_CODE_BYTES } from "./execution";
import { getProblem, type Problem } from "./problems/loader";
import { checkLimits, clientIp, type RateRule } from "./ratelimit";
import { CodeExecutionUnavailableError } from "./runner/types";

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiError,
  ) {
    super(body.error);
  }
}

export function fail(status: number, code: ApiError["code"], error: string, extra?: Partial<ApiError>): never {
  throw new ApiFailure(status, { error, code, ...extra });
}

export const sessionIdSchema = z.uuid();

export const codeSchema = z
  .string()
  .refine((s) => Buffer.byteLength(s, "utf8") <= MAX_CODE_BYTES, {
    message: `Code must be at most ${MAX_CODE_BYTES / 1024} KB`,
  });

const MAX_BODY_BYTES = MAX_CODE_BYTES * 2;

export async function parseBody<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) fail(413, "bad_request", "Request body too large");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    fail(400, "bad_request", "Request body must be JSON");
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    fail(400, "bad_request", parsed.error.issues[0]?.message ?? "Invalid request");
  }
  return parsed.data;
}

export async function requireSession(sessionId: string): Promise<void> {
  if (!(await sessionExists(sessionId))) {
    fail(401, "invalid_session", "Unknown session. Reload the page to start a new one.");
  }
}

export function requireProblem(id: string): Problem {
  const problem = getProblem(id);
  if (!problem) fail(404, "not_found", "Problem not found");
  return problem;
}

export async function enforceLimits(req: Request, checks: Array<[RateRule, "ip" | string]>): Promise<void> {
  const ip = clientIp(req.headers);
  const result = await checkLimits(checks.map(([rule, key]) => [rule, key === "ip" ? ip : key]));
  if (!result.success) {
    const seconds = Math.ceil(result.retryAfterMs / 1000);
    fail(429, "rate_limited", `Too many requests. Try again in ${seconds}s.`, {
      retryAfterMs: result.retryAfterMs,
    });
  }
}

/** Wrap a route handler: maps known failures to JSON errors and hides internals. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof ApiFailure) {
        const headers: Record<string, string> = {};
        if (err.body.retryAfterMs) headers["Retry-After"] = String(Math.ceil(err.body.retryAfterMs / 1000));
        return Response.json(err.body, { status: err.status, headers });
      }
      if (err instanceof CodeExecutionUnavailableError) {
        return Response.json({ error: err.message, code: "execution_unavailable" } satisfies ApiError, {
          status: 503,
        });
      }
      console.error(err);
      return Response.json({ error: "Something went wrong", code: "server_error" } satisfies ApiError, {
        status: 500,
      });
    }
  };
}
