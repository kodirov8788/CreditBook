import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/personal/accounts/route";
import { getAuthenticatedClient } from "@/lib/api/auth";
import { displayMoney, localDate } from "@/lib/personal-finance/accounts";
vi.mock("@/lib/api/auth", () => ({ getAuthenticatedClient: vi.fn() }));
const auth = vi.mocked(getAuthenticatedClient);
const clientKey = "11111111-1111-4111-8111-111111111111";
const command = { name: "Naqd", currencyCode: "UZS", openingAmountMinor: "10000000", openingDate: "2026-01-01", timeZone: "UTC" };
const request = (body: unknown) => new Request("http://localhost/api/personal/accounts", { method: "POST", body: JSON.stringify(body) });
const rpc = vi.fn();
describe("personal account HTTP boundary", () => {
  beforeEach(() => { rpc.mockReset(); auth.mockReset(); auth.mockResolvedValue({ supabase: { rpc } as never, user: { id: "owner" } as never }); });
  it("requires verified authentication", async () => {
    auth.mockResolvedValue({ supabase: null, user: null });
    expect((await GET(new Request("http://localhost/api/personal/accounts"))).status).toBe(401);
    expect((await POST(request({ clientKey, command }))).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("preserves exact command and idempotency key without shop/service lookups", async () => {
    rpc.mockResolvedValue({ data: { accountId: "created", replayed: false }, error: null });
    const response = await POST(request({ clientKey, command }));
    expect(response.status).toBe(201);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("create_personal_account", { p_command: command, p_client_key: clientKey });
    expect(response.headers.get("Cache-Control")).toContain("no-store");
  });
  it("returns the original replay as 200", async () => {
    rpc.mockResolvedValue({ data: { accountId: "original", replayed: true }, error: null });
    const response = await POST(request({ clientKey, command }));
    expect(response.status).toBe(200); expect((await response.json()).accountId).toBe("original");
  });
  it.each(["BOOK_EXISTS", "LEGACY_SETUP_REQUIRED"])("maps guarded legacy creation conflict %s", async message => {
    rpc.mockResolvedValue({ data: null, error: { code: "PT409", message } });
    const response = await POST(request({ clientKey, command }));
    expect(response.status).toBe(409); expect((await response.json()).code).toBe(message);
  });
  it.each([["22023",400],["42501",403],["23505",409],["XX000",500]])("maps %s safely", async (code,status) => {
    rpc.mockResolvedValue({ data: null, error: { code, message: "private SQL detail" } });
    const response = await POST(request({ clientKey, command }));
    expect(response.status).toBe(status); expect(await response.text()).not.toContain("private SQL detail");
  });
  it.each([null,[],{}, {clientKey:"wrong",command}, {clientKey,command:[]}, {clientKey,command,owner:"foreign"}])("rejects malformed envelopes before RPC: %j", async body => {
    expect((await POST(request(body))).status).toBe(400); expect(rpc).not.toHaveBeenCalled();
  });
  it("bounds bytes despite forged Content-Length", async () => {
    const response = await POST(new Request("http://localhost/api/personal/accounts", {method:"POST",headers:{"Content-Length":"1"},body:" ".repeat(8193)}));
    expect(response.status).toBe(400); expect(rpc).not.toHaveBeenCalled();
  });
  it("GET preserves aggregate strings above JS safe integer", async () => {
    const result={accounts:[],totals:[{includedMinor:"90071992547409930"}],preferences:null,nextOffset:null};
    rpc.mockResolvedValue({data:result,error:null});
    const response = await GET(new Request("http://localhost/api/personal/accounts?offset=50"));
    expect(rpc).toHaveBeenCalledWith("get_personal_accounts",{p_offset:50});
    expect(await response.json()).toEqual(result);
  });
  it.each(["-1","1.5","100001","other"])('rejects invalid offset %s', async offset => {
    expect((await GET(new Request("http://localhost/api/personal/accounts?offset="+offset))).status).toBe(400); expect(rpc).not.toHaveBeenCalled();
  });
  it("keeps suspended/missing workspaces forbidden", async () => {
    rpc.mockResolvedValue({data:null,error:{code:"42501"}});
    expect((await GET(new Request("http://localhost/api/personal/accounts"))).status).toBe(403);
  });
});
describe("exact display and local dates", () => {
  it("formats without floating-point round trips", () => {
    expect(displayMoney("900719925474099312",2)).toBe("9 007 199 254 740 993.12");
    expect(displayMoney("-10",2)).toBe("−0.10"); expect(displayMoney("0",0)).toBe("0");
  });
  it("uses selected timezone at date boundary", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-01-01T00:30:00Z"));
    expect(localDate("Pacific/Pago_Pago")).toBe("2025-12-31");
    expect(localDate("Pacific/Kiritimati")).toBe("2026-01-01"); vi.useRealTimers();
  });
});
vi.mock("@/lib/api/personal-access", () => ({ getPersonalAccess: vi.fn().mockResolvedValue("allowed") }));
