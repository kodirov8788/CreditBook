import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/personal/workspace/route";
import { getAuthenticatedClient } from "@/lib/api/auth";

vi.mock("@/lib/api/auth", () => ({ getAuthenticatedClient: vi.fn() }));

const authMock = vi.mocked(getAuthenticatedClient);
const activeUser = { id: "active-user-1" };
const workspace = {
  id: "workspace-1",
  name: "Shaxsiy hisob",
  status: "active",
  created_at: "2026-10-17T00:00:00.000Z",
  updated_at: "2026-10-17T00:00:00.000Z",
  owner_user_id: "active-user-1",
  internal_note: "must not be exposed",
};
const publicWorkspace = {
  id: workspace.id,
  name: workspace.name,
  status: workspace.status,
  created_at: workspace.created_at,
  updated_at: workspace.updated_at,
};

function getRequest() {
  return new Request("http://localhost/api/personal/workspace");
}

function postRequest(body?: string, headers?: HeadersInit) {
  return new Request("http://localhost/api/personal/workspace", {
    method: "POST",
    headers,
    body,
  });
}

function getClient(result: { data: unknown; error: unknown }) {
  const maybeSingle = vi.fn().mockResolvedValue(result);
  const eq = vi.fn().mockReturnThis();
  const select = vi.fn().mockReturnValue({ eq, maybeSingle });
  const from = vi.fn().mockReturnValue({ select });
  return { from, select, eq, maybeSingle };
}

describe("personal workspace API", () => {
  beforeEach(() => authMock.mockReset());

  it("requires authentication for GET and POST", async () => {
    authMock.mockResolvedValue({ supabase: null, user: null });

    await expect(GET(getRequest())).resolves.toMatchObject({ status: 401 });
    await expect(POST(postRequest())).resolves.toMatchObject({ status: 401 });
  });

  it("reads only the active authenticated user's workspace and never provisions on GET", async () => {
    const client = getClient({ data: workspace, error: null });
    authMock.mockResolvedValue({ supabase: { from: client.from } as never, user: activeUser as never });

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ workspace: publicWorkspace });
    expect(client.from).toHaveBeenCalledWith("personal_workspaces");
    expect(client.select).toHaveBeenCalledWith("id, name, status, created_at, updated_at");
    expect(client.eq).toHaveBeenCalledWith("owner_user_id", activeUser.id);
    expect(client.eq).toHaveBeenCalledWith("status", "active");
    expect(client.maybeSingle).toHaveBeenCalledOnce();
  });

  it("returns an explicit Uzbek 404 when no accessible workspace exists", async () => {
    const client = getClient({ data: null, error: null });
    authMock.mockResolvedValue({ supabase: { from: client.from } as never, user: activeUser as never });

    const response = await GET(getRequest());

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Shaxsiy ish maydoni topilmadi." });
  });

  it("maps GET query failures to a safe server error", async () => {
    const client = getClient({ data: null, error: { code: "XX000" } });
    authMock.mockResolvedValue({ supabase: { from: client.from } as never, user: activeUser as never });

    const response = await GET(getRequest());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "Server xatosi." });
  });

  it.each([undefined, "{}"])("accepts an empty POST body of %p", async (body) => {
    const rpc = vi.fn().mockResolvedValue({ data: workspace, error: null });
    authMock.mockResolvedValue({ supabase: { rpc } as never, user: activeUser as never });

    const response = await POST(postRequest(body));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ workspace: publicWorkspace });
    expect(rpc).toHaveBeenCalledWith("ensure_my_personal_workspace");
  });

  it.each([
    "[]",
    "null",
    '"text"',
    "{",
    '{"owner_user_id":"other-user"}',
    '{"id":"workspace-2"}',
    '{"name":"Tampered"}',
    '{"status":"suspended"}',
  ])("rejects invalid or identity-tampering POST bodies without invoking the RPC: %s", async (body) => {
    const rpc = vi.fn();
    authMock.mockResolvedValue({ supabase: { rpc } as never, user: activeUser as never });

    const response = await POST(postRequest(body));

    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    { headers: undefined, description: "without a content-length header" },
    { headers: { "content-length": "1" }, description: "with a forged small content-length header" },
    { headers: { "content-length": "1025" }, description: "with an oversized content-length header" },
  ])("rejects an oversized POST body $description without invoking the RPC", async ({ headers }) => {
    const rpc = vi.fn();
    authMock.mockResolvedValue({ supabase: { rpc } as never, user: activeUser as never });

    const response = await POST(postRequest(" ".repeat(1025), headers));

    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps denied provisioning to forbidden", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: "42501" } });
    authMock.mockResolvedValue({ supabase: { rpc } as never, user: activeUser as never });

    const response = await POST(postRequest());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Bu amal uchun ruxsat yo'q." });
  });

  it("maps unexpected RPC failures and missing RPC data to safe server errors", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: null, error: { code: "XX000" } })
      .mockResolvedValueOnce({ data: null, error: null });
    authMock.mockResolvedValue({ supabase: { rpc } as never, user: activeUser as never });

    const failed = await POST(postRequest());
    const missing = await POST(postRequest());

    expect(failed.status).toBe(500);
    expect(missing.status).toBe(500);
    await expect(failed.json()).resolves.toEqual({ error: "Server xatosi." });
    await expect(missing.json()).resolves.toEqual({ error: "Server xatosi." });
  });

  it("accepts both composite object and array RPC data while exposing only public fields", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: workspace, error: null })
      .mockResolvedValueOnce({ data: [workspace], error: null });
    authMock.mockResolvedValue({ supabase: { rpc } as never, user: activeUser as never });

    const objectResponse = await POST(postRequest());
    const arrayResponse = await POST(postRequest("{}"));

    expect(objectResponse.status).toBe(200);
    expect(arrayResponse.status).toBe(200);
    await expect(objectResponse.json()).resolves.toEqual({ workspace: publicWorkspace });
    await expect(arrayResponse.json()).resolves.toEqual({ workspace: publicWorkspace });
  });
});
