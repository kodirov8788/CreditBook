import { afterEach, describe, expect, it, vi } from "vitest";
import { createCategoryIntent } from "@/lib/personal-finance/category-command";
import {
  categoryJournalKey, readCategoryJournal, removeCategoryJournal, stageCategoryJournal,
  submitCategoryMutation, type CategoryAuth, type CategoryJournal,
} from "@/lib/personal-finance/category-mutation";

const owner = "abcdefab-cdef-4abc-8def-abcdefabcdef";
const other = "22222222-2222-4222-8222-222222222222";
const key = "33333333-3333-4333-8333-333333333333";
const intent = createCategoryIntent(owner, key, { operation: "create", name: "  Ovqat  " });
const receipt = { categoryId: other, categoryVersion: 1, commandId: key, replayed: false, clientKey: key };
function journal(): CategoryJournal {
  const data = new Map<string, string>();
  return { getItem: vi.fn(k => data.get(k) ?? null), setItem: vi.fn((k, v) => { data.set(k, v); }), removeItem: vi.fn(k => { data.delete(k); }) };
}
function auth(id = owner): CategoryAuth {
  return {
    getSession: vi.fn(async () => ({ data: { session: { access_token: "synthetic-token-A" } }, error: null })),
    getUser: vi.fn(async () => ({ data: { user: { id } }, error: null })),
  };
}
function response(status = 201, body: unknown = receipt) {
  return vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status }));
}
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { resolve, promise }; }
afterEach(() => vi.useRealTimers());

describe("category owner-scoped session journal", () => {
  it("preserves exact intent and canonical owner key without credentials", () => {
    const storage = journal(); stageCategoryJournal(storage, intent);
    expect(categoryJournalKey(owner.toUpperCase())).toBe(categoryJournalKey(owner));
    expect(readCategoryJournal(storage, owner)).toEqual(intent);
    expect(readCategoryJournal(storage, other)).toBeNull();
    expect(storage.getItem(categoryJournalKey(owner))).not.toContain("token");
  });
  it("stages the same command without rewriting or mutating it", () => {
    const storage = journal(); stageCategoryJournal(storage, intent); stageCategoryJournal(storage, intent);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    expect(readCategoryJournal(storage, owner)?.command).toEqual({ operation: "create", name: "  Ovqat  " });
  });
  it("refuses a second key/payload until reconciliation", () => {
    const storage = journal(); stageCategoryJournal(storage, intent);
    expect(() => stageCategoryJournal(storage, createCategoryIntent(owner, key, { operation: "create", name: "Different" }))).toThrow();
    expect(() => stageCategoryJournal(storage, createCategoryIntent(owner, other, intent.command))).toThrow();
    expect(readCategoryJournal(storage, owner)).toEqual(intent);
  });
  it.each(["{bad", JSON.stringify({ ...intent, ownerId: other })])("never erases corrupt/foreign data", raw => {
    const storage = journal(); storage.setItem(categoryJournalKey(owner), raw);
    expect(() => readCategoryJournal(storage, owner)).toThrow();
    expect(() => stageCategoryJournal(storage, intent)).toThrow();
    expect(storage.getItem(categoryJournalKey(owner))).toBe(raw);
    expect(storage.removeItem).not.toHaveBeenCalled();
  });
  it("never removes a newer/different intent", () => {
    const storage = journal(); const newer = createCategoryIntent(owner, other, intent.command);
    stageCategoryJournal(storage, newer);
    expect(removeCategoryJournal(storage, intent)).toBe(false);
    expect(readCategoryJournal(storage, owner)).toEqual(newer);
  });
  it("removes only the matching journal after explicit discard/ack", () => {
    const storage = journal(); stageCategoryJournal(storage, intent);
    expect(removeCategoryJournal(storage, intent)).toBe(true);
    expect(removeCategoryJournal(storage, intent)).toBe(false);
  });
});

describe("category mutation transport (mocked Auth/network/storage)", () => {
  it("verifies the captured token, posts it without cookies and clears on matching receipt", async () => {
    const storage = journal(), live = auth(), request = response();
    expect((await submitCategoryMutation({ intent, storage, auth: live, request })).kind).toBe("saved");
    expect(live.getUser).toHaveBeenCalledWith("synthetic-token-A");
    expect(request).toHaveBeenCalledWith("/api/personal/categories", expect.objectContaining({
      method: "POST", credentials: "omit", redirect: "error", cache: "no-store",
      headers: { "Content-Type": "application/json", Authorization: "Bearer synthetic-token-A" },
      body: JSON.stringify({ clientKey: key, command: intent.command }),
    }));
    expect(readCategoryJournal(storage, owner)).toBeNull();
  });
  it("retains the captured verified identity even if session changes mid-flight", async () => {
    const storage = journal(), live = auth(), request = response();
    const gate = deferred<Awaited<ReturnType<CategoryAuth["getUser"]>>>();
    live.getUser = vi.fn(() => gate.promise);
    const run = submitCategoryMutation({ intent, storage, auth: live, request });
    await Promise.resolve();
    live.getSession = vi.fn(async () => ({ data: { session: { access_token: "synthetic-token-B" } }, error: null }));
    gate.resolve({ data: { user: { id: owner } }, error: null });
    expect((await run).kind).toBe("saved");
    expect(request.mock.calls[0][1]?.headers).toHaveProperty("Authorization", "Bearer synthetic-token-A");
  });
  it("does not send another owner's session", async () => {
    const storage = journal(), request = response();
    expect((await submitCategoryMutation({ intent, storage, auth: auth(other), request })).kind).toBe("blocked");
    expect(request).not.toHaveBeenCalled(); expect(readCategoryJournal(storage, owner)).toEqual(intent);
  });
  it.each(["missing", "session-error", "user-error"])("retains intent when auth is %s", async mode => {
    const storage = journal(), live = auth(), request = response();
    if (mode === "missing") live.getSession = async () => ({ data: { session: null }, error: null });
    if (mode === "session-error") live.getSession = async () => ({ data: { session: null }, error: new Error() });
    if (mode === "user-error") live.getUser = async () => ({ data: { user: null }, error: new Error() });
    expect((await submitCategoryMutation({ intent, storage, auth: live, request })).kind).toBe("blocked");
    expect(request).not.toHaveBeenCalled(); expect(readCategoryJournal(storage, owner)).toEqual(intent);
  });
  it.each([400, 401, 403, 409, 429, 500, 503, 200, 201])("retains intent for unconfirmed HTTP %s", async status => {
    const storage = journal();
    const result = await submitCategoryMutation({ intent, storage, auth: auth(), request: response(status, { error: "Invalid", code: "CONFLICT" }) });
    expect(result.clearIntent).toBe(false); expect(readCategoryJournal(storage, owner)).toEqual(intent);
  });
  it("retries a lost response using the identical key/body, then accepts replay", async () => {
    const storage = journal(), live = auth();
    const request = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error("lost"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...receipt, replayed: true }), { status: 200 }));
    expect((await submitCategoryMutation({ intent, storage, auth: live, request })).kind).toBe("retry");
    const restored = readCategoryJournal(storage, owner)!;
    expect((await submitCategoryMutation({ intent: restored, storage, auth: live, request })).kind).toBe("saved");
    expect(request.mock.calls[0][1]?.body).toBe(request.mock.calls[1][1]?.body);
  });
  it("does not POST if storage is blocked, full or silently fails to persist", async () => {
    for (const storage of [
      { ...journal(), getItem: () => { throw new Error(); } },
      { ...journal(), setItem: () => { throw new Error(); } },
      { ...journal(), setItem: () => {} },
    ]) {
      const live = auth(), request = response();
      expect((await submitCategoryMutation({ intent, storage, auth: live, request })).kind).toBe("storage");
      expect(live.getSession).not.toHaveBeenCalled(); expect(request).not.toHaveBeenCalled();
    }
  });
  it("does not clear if server succeeded but journal removal fails", async () => {
    const storage = { ...journal(), removeItem: () => { throw new Error(); } };
    const outcome = await submitCategoryMutation({ intent, storage, auth: auth(), request: response() });
    expect(outcome.clearIntent).toBe(false); expect(readCategoryJournal(storage, owner)).toEqual(intent);
  });
  it("preserves a changed journal while the POST acknowledgement is pending", async () => {
    const storage = journal(); const gate = deferred<Response>();
    const request = vi.fn<typeof fetch>(() => gate.promise);
    const run = submitCategoryMutation({ intent, storage, auth: auth(), request });
    await vi.waitFor(() => expect(request).toHaveBeenCalled());
    const newer = createCategoryIntent(owner, other, intent.command);
    storage.setItem(categoryJournalKey(owner), JSON.stringify(newer));
    gate.resolve(new Response(JSON.stringify(receipt), { status: 201 }));
    expect((await run).kind).toBe("storage"); expect(readCategoryJournal(storage, owner)).toEqual(newer);
  });
  it("serializes same-owner double click but does not block another owner", async () => {
    const storage = journal(), live = auth(), gate = deferred<Awaited<ReturnType<CategoryAuth["getSession"]>>>();
    live.getSession = () => gate.promise;
    const run = submitCategoryMutation({ intent, storage, auth: live, request: response() });
    expect((await submitCategoryMutation({ intent, storage, auth: auth(), request: response() })).kind).toBe("busy");
    const otherIntent = createCategoryIntent(other, key, intent.command);
    expect((await submitCategoryMutation({ intent: otherIntent, storage, auth: auth(other), request: response() })).kind).toBe("saved");
    gate.resolve({ data: { session: null }, error: null }); await run;
  });
  it("returns on deadline and cannot later POST after slow Auth resolves", async () => {
    vi.useFakeTimers(); const storage = journal(), live = auth(), request = response();
    const gate = deferred<Awaited<ReturnType<CategoryAuth["getUser"]>>>(); live.getUser = () => gate.promise;
    const run = submitCategoryMutation({ intent, storage, auth: live, request });
    await vi.advanceTimersByTimeAsync(20000);
    expect((await run).kind).toBe("retry");
    gate.resolve({ data: { user: { id: owner } }, error: null }); await Promise.resolve(); await Promise.resolve();
    expect(request).not.toHaveBeenCalled(); expect(readCategoryJournal(storage, owner)).toEqual(intent);
  });
  it("does not clear a journal after cancellation even if fetch ignores abort", async () => {
    const storage = journal(), controller = new AbortController(), gate = deferred<Response>();
    const request = vi.fn<typeof fetch>(() => gate.promise);
    const run = submitCategoryMutation({ intent, storage, auth: auth(), request, signal: controller.signal });
    await vi.waitFor(() => expect(request).toHaveBeenCalled()); controller.abort();
    expect((await run).kind).toBe("retry"); gate.resolve(new Response(JSON.stringify(receipt), { status: 201 }));
    await Promise.resolve(); await Promise.resolve(); expect(readCategoryJournal(storage, owner)).toEqual(intent);
  });
  it("keeps malformed JSON acknowledgement for reconciliation", async () => {
    const storage = journal();
    const request = vi.fn<typeof fetch>(async () => new Response("{broken", { status: 201 }));
    expect((await submitCategoryMutation({ intent, storage, auth: auth(), request })).kind).toBe("retry");
    expect(readCategoryJournal(storage, owner)).toEqual(intent);
  });
  it("rejects an already invalidated owner without staging or authenticating", async () => {
    const storage = journal(), live = auth(), request = response(), ownerController = new AbortController();
    ownerController.abort();
    expect((await submitCategoryMutation({ intent, storage, auth: live, request, ownerSignal: ownerController.signal })).kind).toBe("blocked");
    expect(storage.setItem).not.toHaveBeenCalled(); expect(live.getSession).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });
  it("cancels immediately on owner change before a late identity verification can POST", async () => {
    const storage = journal(), live = auth(), request = response(), ownerController = new AbortController();
    const localController = new AbortController();
    const ownerRemove = vi.spyOn(ownerController.signal, "removeEventListener");
    const localRemove = vi.spyOn(localController.signal, "removeEventListener");
    const gate = deferred<Awaited<ReturnType<CategoryAuth["getUser"]>>>(); live.getUser = vi.fn(() => gate.promise);
    const run = submitCategoryMutation({ intent, storage, auth: live, request, ownerSignal: ownerController.signal, signal: localController.signal });
    await vi.waitFor(() => expect(live.getUser).toHaveBeenCalled()); ownerController.abort();
    expect((await run).clearIntent).toBe(false);
    expect(ownerRemove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(localRemove).toHaveBeenCalledWith("abort", expect.any(Function));
    gate.resolve({ data: { user: { id: owner } }, error: null });
    await Promise.resolve(); await Promise.resolve();
    expect(request).not.toHaveBeenCalled(); expect(readCategoryJournal(storage, owner)).toEqual(intent);
  });
  it("keeps the journal when identity invalidates after POST but before acknowledgement", async () => {
    const storage = journal(), requestGate = deferred<Response>(), ownerController = new AbortController();
    const request = vi.fn<typeof fetch>(() => requestGate.promise);
    const run = submitCategoryMutation({ intent, storage, auth: auth(), request, ownerSignal: ownerController.signal });
    await vi.waitFor(() => expect(request).toHaveBeenCalled()); ownerController.abort();
    expect((await run).clearIntent).toBe(false);
    requestGate.resolve(new Response(JSON.stringify(receipt), { status: 201 }));
    await Promise.resolve(); await Promise.resolve();
    expect(readCategoryJournal(storage, owner)).toEqual(intent);
    expect((request.mock.calls[0][1]?.signal as AbortSignal).aborted).toBe(true);
  });
  it("removes both cancellation listeners after a completed attempt", async () => {
    const storage = journal(), ownerController = new AbortController(), localController = new AbortController();
    const ownerRemove = vi.spyOn(ownerController.signal, "removeEventListener");
    const localRemove = vi.spyOn(localController.signal, "removeEventListener");
    expect((await submitCategoryMutation({ intent, storage, auth: auth(), request: response(),
      signal: localController.signal, ownerSignal: ownerController.signal })).kind).toBe("saved");
    expect(ownerRemove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(localRemove).toHaveBeenCalledWith("abort", expect.any(Function));
  });
});
