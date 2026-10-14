import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

export interface RateRule {
  /** Short name, used as the key namespace. */
  name: string;
  limit: number;
  windowMs: number;
}

export interface RateResult {
  success: boolean;
  /** Milliseconds until a request would be allowed again (0 when allowed). */
  retryAfterMs: number;
}

export interface RateLimiter {
  readonly name: string;
  limit(rule: RateRule, key: string): Promise<RateResult>;
}

/** Limits applied by the API. Each action is limited per session and per IP. */
export const RULES = {
  runSession: { name: "run:session", limit: 20, windowMs: 60_000 },
  runIp: { name: "run:ip", limit: 60, windowMs: 60_000 },
  submitSession: { name: "submit:session", limit: 8, windowMs: 60_000 },
  submitIp: { name: "submit:ip", limit: 30, windowMs: 60_000 },
  stateIp: { name: "state:ip", limit: 120, windowMs: 60_000 },
  sessionCreateIp: { name: "session:ip", limit: 30, windowMs: 60 * 60_000 },
  feedbackSession: { name: "feedback:session", limit: 5, windowMs: 10 * 60_000 },
  feedbackIp: { name: "feedback:ip", limit: 20, windowMs: 10 * 60_000 },
  adminLoginIp: { name: "admin-login:ip", limit: 10, windowMs: 15 * 60_000 },
} satisfies Record<string, RateRule>;

/** Sliding-window log kept in process memory. Fine for one dev server. */
export class MemoryRateLimiter implements RateLimiter {
  readonly name = "memory";
  private hits = new Map<string, number[]>();
  private lastSweep = 0;

  constructor(private readonly now: () => number = Date.now) {}

  async limit(rule: RateRule, key: string): Promise<RateResult> {
    const now = this.now();
    this.sweep(now);
    const id = `${rule.name}:${key}`;
    const windowStart = now - rule.windowMs;
    const recent = (this.hits.get(id) ?? []).filter((t) => t > windowStart);
    if (recent.length >= rule.limit) {
      this.hits.set(id, recent);
      return { success: false, retryAfterMs: Math.max(recent[0] + rule.windowMs - now, 1) };
    }
    recent.push(now);
    this.hits.set(id, recent);
    return { success: true, retryAfterMs: 0 };
  }

  private sweep(now: number) {
    if (now - this.lastSweep < 60_000) return;
    this.lastSweep = now;
    const maxWindow = Math.max(...Object.values(RULES).map((r) => r.windowMs));
    for (const [id, times] of this.hits) {
      if (!times.length || times[times.length - 1] < now - maxWindow) this.hits.delete(id);
    }
  }
}

/** Shared limits across serverless instances, backed by Upstash Redis. */
export class UpstashRateLimiter implements RateLimiter {
  readonly name = "upstash";
  private readonly redis: Redis;
  private limiters = new Map<string, Ratelimit>();

  constructor(url: string, token: string) {
    this.redis = new Redis({ url, token });
  }

  async limit(rule: RateRule, key: string): Promise<RateResult> {
    let limiter = this.limiters.get(rule.name);
    if (!limiter) {
      limiter = new Ratelimit({
        redis: this.redis,
        limiter: Ratelimit.slidingWindow(rule.limit, `${Math.ceil(rule.windowMs / 1000)} s`),
        prefix: `realcode:rl:${rule.name}`,
        analytics: false,
      });
      this.limiters.set(rule.name, limiter);
    }
    const res = await limiter.limit(key);
    return { success: res.success, retryAfterMs: res.success ? 0 : Math.max(res.reset - Date.now(), 1) };
  }
}

type Env = Record<string, string | undefined>;

export function createRateLimiter(env: Env = process.env): RateLimiter {
  if (env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) {
    return new UpstashRateLimiter(env.UPSTASH_REDIS_REST_URL, env.UPSTASH_REDIS_REST_TOKEN);
  }
  return new MemoryRateLimiter();
}

const globalForLimiter = globalThis as unknown as { __realcodeLimiter?: RateLimiter };

export function getRateLimiter(): RateLimiter {
  globalForLimiter.__realcodeLimiter ??= createRateLimiter();
  return globalForLimiter.__realcodeLimiter;
}

/** Check several rules; fails on the first one that is exhausted. */
export async function checkLimits(checks: Array<[RateRule, string]>): Promise<RateResult> {
  const limiter = getRateLimiter();
  for (const [rule, key] of checks) {
    const result = await limiter.limit(rule, key);
    if (!result.success) return result;
  }
  return { success: true, retryAfterMs: 0 };
}

/**
 * Client IP as reported by the platform proxy. Vercel sets both headers and
 * does not pass through client-supplied values.
 */
export function clientIp(headers: Headers): string {
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real;
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim() || "unknown";
  return "local";
}
