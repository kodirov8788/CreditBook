import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/auth/callback/route";
import { createClient } from "@/lib/supabase/server";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const clientMock = vi.mocked(createClient);

function request(query = "") {
  return new Request(`https://creditbook.example/auth/callback${query}`);
}

describe("auth callback", () => {
  beforeEach(() => clientMock.mockReset());

  it("keeps redirects on the application origin", async () => {
    clientMock.mockResolvedValue(null);
    const response = await GET(request("?next=https%3A%2F%2Fevil.example%2Flogin"));
    expect(response.headers.get("location")).toBe("https://creditbook.example/");
  });

  it("accepts a local next path and activates a valid invitation", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const exchangeCodeForSession = vi.fn().mockResolvedValue({ error: null });
    clientMock.mockResolvedValue({ auth: { exchangeCodeForSession }, rpc } as never);
    const response = await GET(request("?code=one&next=%2Fteam&shop_id=11111111-1111-4111-8111-111111111111"));
    expect(response.headers.get("location")).toBe("https://creditbook.example/team");
    expect(exchangeCodeForSession).toHaveBeenCalledWith("one");
    expect(rpc).toHaveBeenCalledWith("activate_invited_memberships", { p_shop_id: "11111111-1111-4111-8111-111111111111" });
  });

  it("does not activate an invitation when code exchange fails", async () => {
    const rpc = vi.fn();
    const exchangeCodeForSession = vi.fn().mockResolvedValue({ error: new Error("expired") });
    clientMock.mockResolvedValue({ auth: { exchangeCodeForSession }, rpc } as never);
    const response = await GET(request("?code=expired&shop_id=11111111-1111-4111-8111-111111111111"));
    expect(response.headers.get("location")).toBe("https://creditbook.example/login?error_code=auth_failed");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("does not continue to the team page when invite activation fails", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: { code: "P0002" } });
    const exchangeCodeForSession = vi.fn().mockResolvedValue({ error: null });
    clientMock.mockResolvedValue({ auth: { exchangeCodeForSession }, rpc } as never);

    const response = await GET(request("?code=one&next=%2Fteam&shop_id=11111111-1111-4111-8111-111111111111"));

    expect(response.headers.get("location")).toBe("https://creditbook.example/login?error_code=invite_activation_failed");
  });
});


describe("callback failure and invitation regressions", () => {
  beforeEach(() => clientMock.mockReset());
  it.each(["http://[", "https://user:pass@creditbook.example/team", "//evil.example/team"])("falls back safely for next=%s", async next => {
    clientMock.mockResolvedValue(null);
    const response = await GET(request("?next=" + encodeURIComponent(next)));
    expect(response.headers.get("location")).toBe("https://creditbook.example/");
  });
  it.each(["code", "token_hash"])("expired %s returns an explicit login error before invitation activation", async kind => {
    const rpc = vi.fn();
    const failed = vi.fn().mockResolvedValue({error:{code:"otp_expired",message:"private upstream details"}});
    clientMock.mockResolvedValue({auth:{exchangeCodeForSession:failed,verifyOtp:failed},rpc} as never);
    const response=await GET(request(`?${kind}=expired&type=email&next=%2Fteam&shop_id=11111111-1111-4111-8111-111111111111`));
    expect(response.headers.get("location")).toBe("https://creditbook.example/login?error_code=otp_expired");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("rejects a token hash missing its type", async () => {
    const rpc=vi.fn(),verifyOtp=vi.fn();
    clientMock.mockResolvedValue({auth:{verifyOtp},rpc} as never);
    const response=await GET(request("?token_hash=one&next=%2Fteam"));
    expect(response.headers.get("location")).toContain("error_code=auth_failed");
    expect(verifyOtp).not.toHaveBeenCalled();expect(rpc).not.toHaveBeenCalled();
  });
  it("does not send malformed invitation UUIDs to the RPC", async () => {
    const rpc=vi.fn();
    clientMock.mockResolvedValue({auth:{exchangeCodeForSession:vi.fn().mockResolvedValue({error:null})},rpc} as never);
    const response=await GET(request("?code=one&shop_id="+"-".repeat(36)));
    expect(response.headers.get("location")).toContain("error_code=invite_activation_failed");expect(rpc).not.toHaveBeenCalled();
  });
  it("allows the RPC's idempotent zero-change invitation replay", async () => {
    const rpc=vi.fn().mockResolvedValue({data:0,error:null});
    clientMock.mockResolvedValue({auth:{exchangeCodeForSession:vi.fn().mockResolvedValue({error:null})},rpc} as never);
    const response=await GET(request("?code=one&next=%2Fteam&shop_id=11111111-1111-4111-8111-111111111111"));
    expect(response.headers.get("location")).toBe("https://creditbook.example/team");expect(rpc).toHaveBeenCalledOnce();
  });
});


it.each(["otp_expired", "unknown_error"])("handles provider error query %s without credentials or activation", async code => {
  clientMock.mockReset();
  const response=await GET(request(`?error=access_denied&error_code=${code}&error_description=private&next=%2Fteam`));
  expect(response.headers.get("location")).toBe(`https://creditbook.example/login?error_code=${code === "otp_expired" ? "otp_expired" : "auth_failed"}`);
  expect(clientMock).not.toHaveBeenCalled();
});
