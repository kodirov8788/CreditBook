import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAuthenticatedClient } from "@/lib/api/auth";
import { getPersonalAccess } from "@/lib/api/personal-access";
import { GET as readWorkspace, POST as createWorkspace } from "@/app/api/personal/workspace/route";
import { GET as readAccounts, POST as createAccount } from "@/app/api/personal/accounts/route";
import { PATCH as manageAccount } from "@/app/api/personal/accounts/[id]/route";
import { GET as readHistory } from "@/app/api/personal/accounts/[id]/postings/route";

vi.mock("@/lib/api/auth", () => ({ getAuthenticatedClient: vi.fn() }));
const auth = vi.mocked(getAuthenticatedClient);
const rpc = vi.fn(), from = vi.fn();
const user = { id: "verified-owner", is_anonymous: false };
const client = { rpc, from };
const context = { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) };
const routes = [
  ["workspace GET", () => readWorkspace(new Request("http://localhost/api/personal/workspace"))],
  ["workspace POST", () => createWorkspace(new Request("http://localhost/api/personal/workspace", { method: "POST", body: "{}" }))],
  ["accounts GET", () => readAccounts(new Request("http://localhost/api/personal/accounts"))],
  ["accounts POST", () => createAccount(new Request("http://localhost/api/personal/accounts", { method: "POST", body: "{}" }))],
  ["account PATCH", () => manageAccount(new Request("http://localhost/api/personal/accounts/x", { method: "PATCH", body: "{}" }), context)],
  ["history GET", () => readHistory(new Request("http://localhost/api/personal/accounts/x/postings"), context)],
] as const;

beforeEach(() => {
  rpc.mockReset(); from.mockReset(); auth.mockReset();
  auth.mockResolvedValue({ supabase: client as never, user: user as never });
});

describe("personal pilot policy adapter", () => {
  it("asks the database for the current session, without any identity argument", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    expect(await getPersonalAccess(client as never, user)).toBe("allowed");
    expect(rpc).toHaveBeenCalledExactlyOnceWith("has_personal_pilot_access");
  });
  it.each([false, null, undefined, "true", 1, { allowed: true }, [true]])("never accepts a non-boolean permit: %j", async data => {
    rpc.mockResolvedValue({ data, error: null });
    expect(await getPersonalAccess(client as never, user)).toBe(data === false ? "denied" : "unavailable");
  });
  it("ignores client-editable metadata and email as authorization", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    const forged = { ...user, email: "pilot@fixture.test", user_metadata: { personal_pilot: true, role: "platform_owner" } };
    expect(await getPersonalAccess(client as never, forged)).toBe("denied");
    expect(rpc).toHaveBeenCalledExactlyOnceWith("has_personal_pilot_access");
  });
  it.each([{ ...user, is_anonymous: true }, { ...user, id: "" }])("rejects anonymous or missing identity before RPC", async denied => {
    expect(await getPersonalAccess(client as never, denied)).toBe("denied");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("never permits on a missing migration or database error even with truthy data", async () => {
    rpc.mockResolvedValue({ data: true, error: { code: "PGRST202", message: "private schema detail" } });
    expect(await getPersonalAccess(client as never, user)).toBe("unavailable");
  });
  it("fails closed on a rejected transport", async () => {
    rpc.mockRejectedValue(new Error("private network detail"));
    expect(await getPersonalAccess(client as never, user)).toBe("unavailable");
  });
});

describe.each(routes)("personal authorization boundary: %s", (_name, invoke) => {
  it("keeps unauthenticated requests at 401 without data/policy queries", async () => {
    auth.mockResolvedValue({ supabase: null, user: null });
    expect((await invoke()).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled(); expect(from).not.toHaveBeenCalled();
  });
  it("denies non-pilots before any financial read, write or validation", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    const response = await invoke();
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "PERSONAL_ACCESS_DENIED" });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(rpc).toHaveBeenCalledExactlyOnceWith("has_personal_pilot_access");
    expect(from).not.toHaveBeenCalled();
  });
  it("returns a safe uncached 503 instead of accessing data on a policy outage", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "private database detail" } });
    const response = await invoke();
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private database detail");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(rpc).toHaveBeenCalledExactlyOnceWith("has_personal_pilot_access");
    expect(from).not.toHaveBeenCalled();
  });
});

it("allows workspace creation only after the real guard receives an explicit permit", async () => {
  const workspace = { id: "workspace", name: "Shaxsiy hisob", status: "active", created_at: "now", updated_at: "now" };
  rpc.mockImplementation(async name => ({ data: name === "has_personal_pilot_access" ? true : workspace, error: null }));
  const response = await createWorkspace(new Request("http://localhost/api/personal/workspace", { method: "POST", body: "{}" }));
  expect(response.status).toBe(200);
  expect(rpc.mock.calls).toEqual([["has_personal_pilot_access"], ["ensure_my_personal_workspace"]]);
  expect(await response.json()).toEqual({ workspace });
});
