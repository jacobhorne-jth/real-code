import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

export const ADMIN_COOKIE = "realcode_admin";

/** ADMIN_PASSWORD, or "dev" outside production. Null means /admin is disabled. */
export function adminPassword(env: Record<string, string | undefined> = process.env): string | null {
  if (env.ADMIN_PASSWORD) return env.ADMIN_PASSWORD;
  return env.NODE_ENV === "production" ? null : "dev";
}

/** Cookie value derived from the password, so changing the password logs everyone out. */
export function adminToken(password: string): string {
  return createHmac("sha256", password).update("realcode-admin-v1").digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function checkPassword(candidate: string): boolean {
  const password = adminPassword();
  return password !== null && safeEqual(adminToken(candidate), adminToken(password));
}

export function isAdminToken(token: string | undefined): boolean {
  const password = adminPassword();
  return Boolean(password && token && safeEqual(token, adminToken(password)));
}
