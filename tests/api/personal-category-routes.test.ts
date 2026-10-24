import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/personal/categories/route";
import { getAuthenticatedClient } from "@/lib/api/auth";
import { getPersonalAccess } from "@/lib/api/personal-access";

vi.mock("@/lib/api/auth", () => ({ getAuthenticatedClient: vi.fn() }));
vi.mock("@/lib/api/personal-access", async original => ({ ...await original<typeof import("@/lib/api/personal-access")>(), getPersonalAccess: vi.fn() }));
const auth = vi.mocked(getAuthenticatedClient), access = vi.mocked(getPersonalAccess);
const rpc = vi.fn(), from = vi.fn();
let queryResult: { data: { id: string; name: string; status: string; version: number }[] | null; error: { code: string; message: string } | null };
const query = {
  select: vi.fn(), eq: vi.fn(), order: vi.fn(), range: vi.fn(),
  then(resolve: (value: typeof queryResult) => unknown, reject: (reason: unknown) => unknown) {
    return Promise.resolve(queryResult).then(resolve, reject);
  },
};
const key = "11111111-1111-4111-8111-111111111111";
const command = { operation: "create", name: "Ovqat" };
const envelope = { clientKey: key, command };
const url = "http://localhost/api/personal/categories";
const get = (query = "") => new Request(url + query);
const post = (body: unknown) => new Request(url, { method: "POST", body: JSON.stringify(body) });
async function expectResponse(response: Response, status: number) {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  return response.json();
}
beforeEach(() => {
  vi.clearAllMocks();
  queryResult = { data: [], error: null };
  for (const method of [query.select, query.eq, query.order, query.range]) method.mockReturnValue(query);
  from.mockReturnValue(query);
  rpc.mockReset();
  auth.mockResolvedValue({ supabase: { from, rpc } as never, user: { id: "owner" } as never });
  access.mockResolvedValue("allowed");
});

describe("personal category HTTP boundary (mocked transport)", () => {
  it("denies signed-out reads and commands without invoking data methods", async () => {
    auth.mockResolvedValue({ supabase: null, user: null });
    await expectResponse(await GET(get()), 401);
    await expectResponse(await POST(post(envelope)), 401);
    expect(from).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled();
  });
  it.each(["denied", "unavailable"] as const)("fails closed for %s", async state => {
    access.mockResolvedValue(state);
    await expectResponse(await GET(get()), state === "denied" ? 403 : 503);
    await expectResponse(await POST(post(envelope)), state === "denied" ? 403 : 503);
    expect(from).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled();
  });
  it("uses fixed projection, active default and stable order within RLS", async () => {
    const row = { id: "category", name: "Ovqat", status: "active", version: 1 };
    queryResult.data = [row];
    expect(await expectResponse(await GET(get()), 200)).toEqual({ categories: [row], nextOffset: null });
    expect(from).toHaveBeenCalledExactlyOnceWith("personal_categories");
    expect(query.select).toHaveBeenCalledExactlyOnceWith("id,name,status,version");
    expect(query.eq).toHaveBeenCalledExactlyOnceWith("status", "active");
    expect(query.order).toHaveBeenNthCalledWith(1, "created_at", { ascending: true });
    expect(query.order).toHaveBeenNthCalledWith(2, "id", { ascending: true });
    expect(query.range).toHaveBeenCalledExactlyOnceWith(0, 100);
  });
  it.each(["archived", "all"])("supports explicit %s list", async status => {
    await expectResponse(await GET(get(`?status=${status}&offset=100`)), 200);
    expect(query.range).toHaveBeenCalledExactlyOnceWith(100, 200);
    if (status === "all") expect(query.eq).not.toHaveBeenCalled();
    else expect(query.eq).toHaveBeenCalledExactlyOnceWith("status", "archived");
  });
  it.each([0, 100, 101])("bounds result with lookahead for %s rows", async count => {
    queryResult.data = Array.from({ length: count }, (_, index) => ({ id: String(index), name: "Fixture", status: "active", version: 1 }));
    const body = await expectResponse(await GET(get()), 200);
    expect(body.categories).toHaveLength(Math.min(count, 100));
    expect(body.nextOffset).toBe(count > 100 ? 100 : null);
  });
  it("marks an incomplete list instead of returning an unusable offset beyond the API ceiling", async () => {
    queryResult.data = Array.from({ length: 101 }, (_, index) => ({ id: String(index), name: "Fixture", status: "active", version: 1 }));
    const body = await expectResponse(await GET(get("?offset=100000")), 200);
    expect(body.categories).toHaveLength(100);
    expect(body.nextOffset).toBeNull();
    expect(body.paginationLimitReached).toBe(true);
  });
  it.each(["?status=unknown", "?status=active&status=all", "?offset=-1", "?offset=1.5", "?offset=100001",
    "?offset=0&offset=1", "?workspaceId=foreign", "?select=*", "?offset=1e2"])("rejects invalid list query %s", async value => {
    await expectResponse(await GET(get(value)), 400); expect(from).not.toHaveBeenCalled();
  });
  it.each([["42501", 403], ["XX000", 500]] as const)("maps list error %s without details", async (code, status) => {
    queryResult = { data: null, error: { code, message: "upstream-sensitive" } };
    expect(JSON.stringify(await expectResponse(await GET(get()), status))).not.toContain("upstream-sensitive");
  });
  it("does not treat a missing list result as an empty successful page", async () => {
    queryResult.data = null;
    await expectResponse(await GET(get()), 500);
  });
  it.each([
    ["create", false, 201], ["create", true, 200], ["rename", false, 200], ["archive", false, 200],
  ] as const)("returns %s replay=%s status %s", async (operation, replayed, status) => {
    const sent = { ...command, operation };
    const result = { categoryId: "category", categoryVersion: 1, commandId: "command", replayed };
    rpc.mockResolvedValue({ data: result, error: null });
    expect(await expectResponse(await POST(post({ ...envelope, command: sent })), status)).toEqual({ ...result, clientKey: key });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("manage_personal_category", { p_command: sent, p_client_key: key });
  });
  it.each([["22023", 400], ["42501", 403], ["23505", 409], ["XX000", 500]] as const)("maps command error %s safely", async (code, status) => {
    rpc.mockResolvedValue({ data: null, error: { code, message: "upstream-sensitive" } });
    const body = await expectResponse(await POST(post(envelope)), status);
    expect(JSON.stringify(body)).not.toContain("upstream-sensitive");
    if (status === 409) expect(body.code).toBe("CONFLICT");
  });
  it.each([null, [], {}, { ...envelope, workspaceId: "foreign" }, { ...envelope, clientKey: "bad" },
    { ...envelope, clientKey: "00000000-0000-0000-0000-000000000000" }, { ...envelope, command: [] },
    { ...envelope, command: null }, { ...envelope, command: "create" }])("rejects malformed envelope %j", async body => {
    await expectResponse(await POST(post(body)), 400); expect(rpc).not.toHaveBeenCalled();
  });
  it.each(["{broken", " ".repeat(8193)])("rejects invalid or oversized JSON", async raw => {
    await expectResponse(await POST(new Request(url, { method: "POST", body: raw })), 400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("does not report success when the command has no returned result", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expectResponse(await POST(post(envelope)), 500);
  });
  it("catches transport exceptions without leaking them", async () => {
    from.mockImplementationOnce(() => { throw new Error("upstream-sensitive"); });
    expect(JSON.stringify(await expectResponse(await GET(get()), 500))).not.toContain("upstream-sensitive");
    rpc.mockRejectedValue(new Error("upstream-sensitive"));
    expect(JSON.stringify(await expectResponse(await POST(post(envelope)), 500))).not.toContain("upstream-sensitive");
  });
});
