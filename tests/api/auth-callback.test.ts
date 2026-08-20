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
    await GET(request("?code=expired&shop_id=11111111-1111-4111-8111-111111111111"));
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
