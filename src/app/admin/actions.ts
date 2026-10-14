"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_COOKIE, adminToken, checkPassword } from "@/server/admin";
import { checkLimits, clientIp, RULES } from "@/server/ratelimit";

export async function login(formData: FormData): Promise<void> {
  const ip = clientIp(await headers());
  const limit = await checkLimits([[RULES.adminLoginIp, ip]]);
  if (!limit.success) redirect("/admin?error=rate");

  const password = String(formData.get("password") ?? "");
  if (!checkPassword(password)) redirect("/admin?error=1");

  (await cookies()).set(ADMIN_COOKIE, adminToken(password), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/admin",
    maxAge: 12 * 60 * 60,
  });
  redirect("/admin");
}

export async function logout(): Promise<void> {
  (await cookies()).delete({ name: ADMIN_COOKIE, path: "/admin" });
  redirect("/admin");
}
