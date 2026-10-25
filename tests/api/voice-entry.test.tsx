import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { VoiceEntry, confirmedVoiceEntries, parseVoiceDraftResponse, voiceRequestIsCurrent } from "@/components/personal/voice-entry";
import type { VoiceDraftResponse } from "@/lib/personal-finance/voice-contract";

const owner = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
const food = "33333333-3333-4333-8333-333333333333";
const valid: VoiceDraftResponse = { ok: true, ownerId: owner, requestId, draft: { transcript: "non", entries: [{ kind: "expense", amountMinor: "1200", currencyCode: "JPY", categoryId: food, effectiveDate: "2026-10-21", note: "ovqat" }], clarification: null }, budget: { remainingMicros: "1" } };

describe("voice draft entry", () => {
  it("renders default consent with disclosure, no separate audio analysis action, and never saves during render", () => {
    const onConfirm = vi.fn();
    const html = renderToStaticMarkup(<VoiceEntry ownerId={owner} disabled={false} defaultKind="expense" categories={[{ id: food, name: "Oziq-ovqat" }]} onConfirm={onConfirm} onMessage={vi.fn()} onAuthFailure={vi.fn()}/>);
    expect(html).toContain("Google xavfsizlik uchun saqlashi mumkin"); expect(html).toContain('type="checkbox"'); expect(html).toContain('checked=""');
    expect(html).not.toContain("Tahlil qilish</button>"); expect(html).not.toContain("Qayta urinish");
    expect(html).toContain("Faqat tasdiqlasangiz saqlanadi");
    expect(html).toContain("Ovoz yozish"); expect(onConfirm).not.toHaveBeenCalled();
  });

  it("rejects replies for a different owner or request before draft cards can use them", () => {
    expect(parseVoiceDraftResponse(valid, owner, requestId)).toEqual(valid);
    expect(parseVoiceDraftResponse({ ...valid, ownerId: food }, owner, requestId)).toBeNull();
    expect(parseVoiceDraftResponse({ ...valid, requestId: food }, owner, requestId)).toBeNull();
    expect(parseVoiceDraftResponse({ ...valid, draft: { ...valid.draft, entries: [{ ...valid.draft.entries[0], effectiveDate: "2026-02-30" }] } }, owner, requestId)).toBeNull();
    expect(parseVoiceDraftResponse({ ...valid, categoryContextLimited: true }, owner, requestId)).not.toBeNull();
    expect(parseVoiceDraftResponse({ ...valid, categoryContextLimited: "true" }, owner, requestId)).toBeNull();
  });

  it("keeps user-edited JPY amounts and creates one atomic confirmation batch", () => {
    const entries = [
      { ...valid.draft.entries[0], id: "one", amountMinor: "1500" },
      { ...valid.draft.entries[0], id: "two", kind: "income" as const, amountMinor: "700", note: "qaytdi" },
    ];
    expect(confirmedVoiceEntries(entries, "non", "audio", [{ id: food, name: "Oziq-ovqat" }])).toEqual([
      { kind: "expense", amountMinor: "1500", currencyCode: "JPY", categoryId: food, effectiveDate: "2026-10-21", note: "ovqat\nOvoz matni: non" },
      { kind: "income", amountMinor: "700", currencyCode: "JPY", categoryId: food, effectiveDate: "2026-10-21", note: "qaytdi\nOvoz matni: non" },
    ]);
  });

  it("blocks unsupported currency rather than silently converting it", () => {
    expect(confirmedVoiceEntries([{ ...valid.draft.entries[0], id: "foreign", currencyCode: "USD", amountMinor: "10" }], "non", "text", [{ id: food, name: "Oziq-ovqat" }])).toBeNull();
  });

  it("requires no more than ten valid entries with owned categories, supported amount, and a nonzero year", () => {
    const category = [{ id: food, name: "Oziq-ovqat" }], base = { ...valid.draft.entries[0], id: "one" };
    expect(confirmedVoiceEntries(Array.from({ length: 11 }, (_, index) => ({ ...base, id: String(index) })), "non", "text", category)).toBeNull();
    expect(confirmedVoiceEntries([{ ...base, amountMinor: "1000000000001" }], "non", "text", category)).toBeNull();
    expect(confirmedVoiceEntries([{ ...base, categoryId: owner }], "non", "text", category)).toBeNull();
    expect(confirmedVoiceEntries([{ ...base, effectiveDate: "0000-01-01" }], "non", "text", category)).toBeNull();
  });

  it("does not permit a late inference response after consent is revoked", () => {
    const controller = new AbortController(), active = { id: requestId, ownerId: owner, controller };
    expect(voiceRequestIsCurrent(active, requestId, owner, true)).toBe(true);
    expect(voiceRequestIsCurrent(active, requestId, owner, false)).toBe(false);
    controller.abort();
    expect(voiceRequestIsCurrent(active, requestId, owner, true)).toBe(false);
  });
});

 it("category voice panel cannot call a money confirmation or reveal financial input modes", () => {
    const onConfirm = vi.fn(), onCategoryConfirm = vi.fn();
    const html = renderToStaticMarkup(<VoiceEntry purpose="category" ownerId={owner} disabled={false} defaultKind="expense" categories={[]} onConfirm={onConfirm} onCategoryConfirm={onCategoryConfirm} onMessage={vi.fn()} onAuthFailure={vi.fn()}/>);
    expect(html).toContain("Toifa nomini aytish");
    expect(html).not.toContain('aria-label="Manba"');
    expect(html).not.toContain("Tasdiqlash va saqlash");
    expect(onConfirm).not.toHaveBeenCalled(); expect(onCategoryConfirm).not.toHaveBeenCalled();
 });
