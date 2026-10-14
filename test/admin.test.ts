import { describe, expect, it } from "vitest";
import { adminPassword, adminToken } from "@/server/admin";

describe("admin password", () => {
  it('defaults to "dev" outside production only', () => {
    expect(adminPassword({ NODE_ENV: "development" })).toBe("dev");
    expect(adminPassword({ NODE_ENV: "production" })).toBeNull();
    expect(adminPassword({ NODE_ENV: "production", ADMIN_PASSWORD: "s" })).toBe("s");
  });
  it("derives a token that changes with the password", () => {
    expect(adminToken("a")).not.toBe(adminToken("b"));
  });
});
