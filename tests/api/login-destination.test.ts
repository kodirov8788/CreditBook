import { describe, expect, it } from "vitest";
import { loginDestination } from "@/lib/login-destination";

describe("login destination", () => {
  it.each([null, "", "https://evil.test", "//evil.test", "/\\evil.test", "/\nevil.test", "/login", "/login/", "/%6cogin", "/auth", "/auth/", "/auth/callback", "/%zz"])("rejects unsafe or looping destination %j", value => {
    expect(loginDestination(value)).toBe("/dashboard");
  });
  it.each(["/personal", "/personal/categories", "/dashboard#activity", "/admin/shops?page=2"])("preserves local destination %s", value => {
    expect(loginDestination(value)).toBe(value);
  });
});
