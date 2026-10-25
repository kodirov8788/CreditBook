import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import PersonalCategories from "@/components/personal/categories";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/supabase/browser", () => ({ createClient: vi.fn() }));
afterEach(() => vi.unstubAllGlobals());

describe("category controls initial markup (not hydrated browser acceptance)", () => {
  it("keeps one creation action separate from the list filter and refresh controls", () => {
    vi.stubGlobal("React", React);
    const html = renderToStaticMarkup(<PersonalCategories userId="11111111-1111-4111-8111-111111111111" />);
    expect(html.match(/>Toifa qo‘shish<\/button>/g)).toHaveLength(1);
    expect(html).toMatch(/class="[^"]*listControls[^"]*"><label/);
    expect(html).toContain("Ro‘yxatni yangilash");
    expect(html).toContain("Toifalar yuklanmoqda…");
    expect(html).toContain('aria-busy="true"');
  });
});
