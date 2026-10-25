import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CategoryPage from "@/app/personal/categories/page";
import { createClient } from "@/lib/supabase/server";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error("redirect:" + path); } }));
vi.mock("@/components/personal/categories", () => ({ default: ({ userId }: { userId: string }) => React.createElement("div", null, "category-fixture:" + userId) }));
const create = vi.mocked(createClient), rpc = vi.fn(), getUser = vi.fn();
afterEach(() => vi.unstubAllGlobals());
beforeEach(() => {
  vi.stubGlobal("React", React);
  rpc.mockReset(); getUser.mockReset(); create.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: "verified-owner", is_anonymous: false } } });
  create.mockResolvedValue({ rpc, auth: { getUser } } as never);
});
describe("category page access (mocked server)", () => {
  it("shows configuration failure without private controls when no client exists", async () => {
    create.mockResolvedValue(null);
    const html = renderToStaticMarkup(await CategoryPage());
    expect(html).toContain("Kirish sozlamasi topilmadi."); expect(html).not.toContain("category-fixture:");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("redirects signed-out users before rendering private controls", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    await expect(CategoryPage()).rejects.toThrow("redirect:/login"); expect(rpc).not.toHaveBeenCalled();
  });
  it("denies non-pilot without rendering the category component", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    const html = renderToStaticMarkup(await CategoryPage());
    expect(html).toContain("Shaxsiy bo‘limga ruxsat yo‘q."); expect(html).not.toContain("category-fixture:");
  });
  it("rejects Auth anonymous users before any pilot RPC", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "anonymous-owner", is_anonymous: true } } });
    const html = renderToStaticMarkup(await CategoryPage());
    expect(html).toContain("Shaxsiy bo‘limga ruxsat yo‘q."); expect(html).not.toContain("category-fixture:");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("offers retry on permission outage without leaking details", async () => {
    rpc.mockRejectedValue(new Error("private-error"));
    const html = renderToStaticMarkup(await CategoryPage());
    expect(html).toContain('href="/personal/categories"'); expect(html).toContain("Qayta urinish");
    expect(html).not.toContain("private-error"); expect(html).not.toContain("category-fixture:");
  });
  it("binds allowed controls to the verified server identity", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    expect(renderToStaticMarkup(await CategoryPage())).toContain("category-fixture:verified-owner");
    expect(rpc).toHaveBeenCalledExactlyOnceWith("has_personal_pilot_access");
  });
});
