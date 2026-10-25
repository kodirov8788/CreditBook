import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/personal/book/route";
import { getAuthenticatedClient } from "@/lib/api/auth";
import { getPersonalAccess } from "@/lib/api/personal-access";
import { initialBookCommand, parsePendingBook, shouldClearPendingBook } from "@/lib/personal-finance/book";

vi.mock("@/lib/api/auth", () => ({ getAuthenticatedClient: vi.fn() }));
vi.mock("@/lib/api/personal-access", async original => ({ ...await original<typeof import("@/lib/api/personal-access")>(), getPersonalAccess: vi.fn() }));
const rpc = vi.fn(), auth = vi.mocked(getAuthenticatedClient), access = vi.mocked(getPersonalAccess);
const key = "11111111-1111-4111-8111-111111111111";
const command = { openingAmountMinor: "0", openingDate: "2026-01-01" };
const envelope = { clientKey: key, command };
const request = (body: unknown) => new Request("http://localhost/api/personal/book", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => {
  rpc.mockReset(); auth.mockReset(); access.mockReset(); access.mockResolvedValue("allowed");
  auth.mockResolvedValue({ supabase: { rpc } as never, user: { id: "owner" } as never });
});
describe("personal book HTTP boundary", () => {
  it("requires a verified session on both methods", async () => {
    auth.mockResolvedValue({ supabase: null, user: null });
    expect((await GET(new Request("http://localhost/api/personal/book"))).status).toBe(401);
    expect((await POST(request(envelope))).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each(["denied", "unavailable"] as const)("fails closed for %s on both methods", async state => {
    access.mockResolvedValue(state);
    const status = state === "denied" ? 403 : 503;
    expect((await GET(new Request("http://localhost/api/personal/book"))).status).toBe(status);
    expect((await POST(request(envelope))).status).toBe(status);
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each(["empty", "ready", "legacy_setup_required"])("returns %s without legacy list lookup", async state => {
    rpc.mockResolvedValue({ data: { state }, error: null });
    const response = await GET(new Request("http://localhost/api/personal/book"));
    expect(await response.json()).toEqual({ state });
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(rpc).toHaveBeenCalledExactlyOnceWith("get_personal_book");
  });
  it.each([false, true])("preserves exact command on replay=%s", async replayed => {
    rpc.mockResolvedValue({ data: { accountId: "fixture", replayed }, error: null });
    expect((await POST(request(envelope))).status).toBe(replayed ? 200 : 201);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("initialize_personal_book", { p_command: command, p_client_key: key });
  });
  it.each([["22023", "private", 400], ["42501", "private", 403], ["23505", "private", 409],
    ["PT409", "LEGACY_SETUP_REQUIRED", 409], ["PT409", "BOOK_EXISTS", 409], ["XX000", "private", 500]])("maps %s/%s safely", async (code, message, status) => {
    rpc.mockResolvedValue({ data: null, error: { code, message } });
    const response = await POST(request(envelope));
    expect(response.status).toBe(status);
    const body = await response.json(); expect(JSON.stringify(body)).not.toContain("private");
    if (message === "LEGACY_SETUP_REQUIRED") expect(body.code).toBe(message);
  });
  it.each([null, [], {}, { ...envelope, owner: "other" }, { ...envelope, command: [] }, { ...envelope, clientKey: "bad" }])("rejects malformed envelope %j", async body => {
    expect((await POST(request(body))).status).toBe(400); expect(rpc).not.toHaveBeenCalled();
  });
  it("bounds request size", async () => {
    expect((await POST(new Request("http://localhost/api/personal/book", { method: "POST", body: " ".repeat(8193) }))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
});
describe("single JPY book defaults and owned retry payload", () => {
  it.each(["BOOK_EXISTS", "LEGACY_SETUP_REQUIRED"])("clears restored terminal conflict %s", code => {
    expect(shouldClearPendingBook(true, 409, code)).toBe(true);
  });
  it.each([[403, "PERSONAL_ACCESS_DENIED"], [409, "CONFLICT"], [503, "PERSONAL_ACCESS_UNAVAILABLE"], [500, undefined]])("retains unknown outcome for %s/%s", (status, code) => {
    expect(shouldClearPendingBook(true, status as number, code)).toBe(false);
  });
  it("defaults zero opening to Tokyo today, not the host date", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-01T16:00:00Z"));
      expect(initialBookCommand()).toEqual({ openingAmountMinor: "0", openingDate: "2026-01-02" });
    } finally { vi.useRealTimers(); }
  });
  it("restores original date and signed JPY amount without recalculating", () => {
    const saved = { clientKey: key, command: { openingAmountMinor: "-10000", openingDate: "2026-01-01" } };
    expect(parsePendingBook(JSON.stringify(saved))).toEqual(saved);
  });
  it.each([{}, { ...envelope, owner: "other" }, { ...envelope, command: { ...command, currencyCode: "USD" } },
    { ...envelope, command: { ...command, openingAmountMinor: "1.5" } },
    { ...envelope, command: { ...command, openingAmountMinor: 1 } }])("rejects corrupted retry payload %j", body => {
    expect(() => parsePendingBook(JSON.stringify(body))).toThrow();
  });
});
