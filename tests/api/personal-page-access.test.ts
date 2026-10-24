import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PersonalPage from "@/app/personal/page";
import { createClient } from "@/lib/supabase/server";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error("redirect:" + path); } }));
vi.mock("@/components/personal/book", () => ({ default: () => React.createElement("div", null, "personal-account-fixture") }));
const create = vi.mocked(createClient), rpc = vi.fn(), getUser = vi.fn();
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
beforeEach(() => {
  vi.stubGlobal("React", React);
  rpc.mockReset(); getUser.mockReset(); create.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: "verified-owner", is_anonymous: false } } });
  create.mockResolvedValue({ rpc, auth: { getUser } } as never);
});

describe("personal page pilot boundary", () => {
  it("redirects signed-out visitors before policy or shop lookup", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    await expect(PersonalPage({searchParams:Promise.resolve({})})).rejects.toThrow("redirect:/login");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("does not render private controls or query shops for a denied user", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    const html = renderToStaticMarkup(await PersonalPage({searchParams:Promise.resolve({})}));
    expect(html).toContain("Shaxsiy bo‘limga ruxsat yo‘q.");
    expect(html).not.toContain("personal-account-fixture");
    expect(rpc).toHaveBeenCalledExactlyOnceWith("has_personal_pilot_access");
  });
  it("provides retry on outage without redirecting into a dashboard loop", async () => {
    rpc.mockRejectedValue(new Error("private error"));
    const html = renderToStaticMarkup(await PersonalPage({searchParams:Promise.resolve({})}));
    expect(html).toContain('href="/personal"');
    expect(html).toContain("Qayta urinish");
    expect(html).not.toContain("personal-account-fixture");
    expect(html).not.toContain("private error");
    expect(rpc).toHaveBeenCalledOnce();
  });
  it("renders controls for an explicitly permitted identity after checking access", async () => {
    rpc.mockImplementation(async name => ({ data: name === "has_personal_pilot_access" ? true : [], error: null }));
    expect(renderToStaticMarkup(await PersonalPage({searchParams:Promise.resolve({})}))).toContain("personal-account-fixture");
    expect(rpc.mock.calls).toEqual([["has_personal_pilot_access"], ["list_user_shops"]]);
  });
  it("does not call Supabase or query shops in the closed Neon release", async () => {
    vi.stubEnv("CREDITBOOK_NEON_ENABLED", "1");
    const html = renderToStaticMarkup(await PersonalPage({searchParams:Promise.resolve({view:"categories"})}));
    expect(html).toContain("SHAXSIY HISOB");
    expect(create).not.toHaveBeenCalled();
    expect(getUser).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});
