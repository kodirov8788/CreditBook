import { afterEach, describe, expect, it, vi } from "vitest";
import { BookOwnerChangedError, requestOwnedBook, type BookAuth } from "@/lib/personal-finance/book-request";

const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const pending = { clientKey: "33333333-3333-4333-8333-333333333333", command: { openingAmountMinor: "-1234", openingDate: "2026-01-01" } };
function auth(id = owner): BookAuth {
  return { getSession: vi.fn(async () => ({data: {session: {access_token: "synthetic-A"}}, error: null})),
    getUser: vi.fn(async () => ({data: {user: {id}}, error: null})) };
}
function gate<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return {resolve, promise}; }
const request = () => vi.fn<typeof fetch>(async () => new Response("{}", {status: 200}));
afterEach(() => vi.useRealTimers());

describe("book owner-bound request", () => {
  it.each([undefined, pending])("verifies one token and uses no ambient cookies (%j)", async command => {
    const live = auth(), send = request();
    await requestOwnedBook({ownerId: owner, auth: live, pending: command, signal: new AbortController().signal, request: send});
    expect(live.getUser).toHaveBeenCalledExactlyOnceWith("synthetic-A");
    expect(send).toHaveBeenCalledWith("/api/personal/book", expect.objectContaining({
      method: command ? "POST" : "GET", credentials: "omit", redirect: "error", cache: "no-store",
      headers: expect.objectContaining({Authorization: "Bearer synthetic-A"}),
    }));
    const body = send.mock.calls[0][1]?.body;
    expect(body).toBe(command ? JSON.stringify(pending) : undefined);
  });
  it.each([undefined, pending])("never dispatches A intent/read using B session (%j)", async command => {
    const send = request();
    await expect(requestOwnedBook({ownerId: owner, auth: auth(other), pending: command, signal: new AbortController().signal, request: send})).rejects.toBeInstanceOf(BookOwnerChangedError);
    expect(send).not.toHaveBeenCalled();
  });
  it("cannot retarget a captured A token when cookies/session change during verification", async () => {
    const live = auth(), send = request(), verified = gate<Awaited<ReturnType<BookAuth["getUser"]>>>();
    live.getUser = vi.fn(() => verified.promise);
    const run = requestOwnedBook({ownerId: owner, auth: live, pending, signal: new AbortController().signal, request: send});
    await Promise.resolve();
    live.getSession = vi.fn(async () => ({data: {session: {access_token: "synthetic-B"}}, error: null}));
    verified.resolve({data: {user: {id: owner}}, error: null});
    await run;
    expect(send.mock.calls[0][1]?.headers).toMatchObject({Authorization: "Bearer synthetic-A"});
    expect(send.mock.calls[0][1]?.credentials).toBe("omit");
  });
  it("snapshots the original retry key/amount/date before async Auth", async () => {
    const command = structuredClone(pending), live = auth(), send = request();
    const verified = gate<Awaited<ReturnType<BookAuth["getUser"]>>>(); live.getUser = vi.fn(() => verified.promise);
    const run = requestOwnedBook({ownerId: owner, auth: live, pending: command, signal: new AbortController().signal, request: send});
    command.command.openingAmountMinor = "9999";
    verified.resolve({data: {user: {id: owner}}, error: null}); await run;
    expect(send.mock.calls[0][1]?.body).toBe(JSON.stringify(pending));
  });
  it("does not dispatch after owner cancellation during Auth", async () => {
    const live = auth(), send = request(), cancellation = new AbortController();
    const verified = gate<Awaited<ReturnType<BookAuth["getUser"]>>>(); live.getUser = vi.fn(() => verified.promise);
    const run = requestOwnedBook({ownerId: owner, auth: live, pending, signal: cancellation.signal, request: send});
    const rejected = expect(run).rejects.toThrow("to‘xtatildi");
    await Promise.resolve(); cancellation.abort(); await rejected;
    verified.resolve({data: {user: {id: owner}}, error: null});
    await Promise.resolve(); expect(send).not.toHaveBeenCalled();
  });
  it("rejects an already aborted request before Auth", async () => {
    const live = auth(), send = request(), cancellation = new AbortController(); cancellation.abort();
    await expect(requestOwnedBook({ownerId: owner, auth: live, pending, signal: cancellation.signal, request: send})).rejects.toThrow();
    expect(live.getSession).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
  });
  it.each(["session", "user"])("fails closed when %s is unavailable", async failure => {
    const live = auth(), send = request();
    if (failure === "session") live.getSession = vi.fn(async () => ({data: {session: null}, error: null}));
    else live.getUser = vi.fn(async () => ({data: {user: null}, error: {message: "private"}}));
    await expect(requestOwnedBook({ownerId: owner, auth: live, pending, signal: new AbortController().signal, request: send})).rejects.toBeInstanceOf(BookOwnerChangedError);
    expect(send).not.toHaveBeenCalled();
  });
  it("bounds stalled Auth and never sends after the deadline", async () => {
    vi.useFakeTimers(); const live = auth(), send = request(), session = gate<Awaited<ReturnType<BookAuth["getSession"]>>>();
    live.getSession = vi.fn(() => session.promise);
    const run = requestOwnedBook({ownerId: owner, auth: live, pending, signal: new AbortController().signal, request: send});
    const rejected = expect(run).rejects.toThrow("to‘xtatildi");
    await vi.advanceTimersByTimeAsync(20000); await rejected;
    session.resolve({data: {session: {access_token: "synthetic-A"}}, error: null});
    await Promise.resolve(); expect(send).not.toHaveBeenCalled();
  });
  it("retains the caller's pending payload on network failure", async () => {
    const command = structuredClone(pending), send = vi.fn<typeof fetch>(async () => { throw new Error("offline"); });
    await expect(requestOwnedBook({ownerId: owner, auth: auth(), pending: command, signal: new AbortController().signal, request: send})).rejects.toThrow("offline");
    expect(command).toEqual(pending);
  });
});
