import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { getAuthenticatedClient, requireShopPermission } from "@/lib/api/auth";
import { POST as createCustomer } from "@/app/api/customers/route";
import { POST as createCredit } from "@/app/api/customers/[id]/credits/route";
import { POST as createPayment } from "@/app/api/customers/[id]/payments/route";
import { GET as getActivity, POST as createActivity } from "@/app/api/activity/route";
import { POST as createReminder } from "@/app/api/reminders/route";
import { GET as getReport } from "@/app/api/reports/route";
import { POST as createExpense } from "@/app/api/expenses/route";
import { GET as getTeam, POST as inviteTeam } from "@/app/api/team/route";
import { PATCH as updateTeamMember } from "@/app/api/team/[id]/route";
import { PATCH as updateShop } from "@/app/api/shop/route";
import { createServiceClient } from "@/lib/admin";
import { recordAudit } from "@/lib/audit";

vi.mock("@/lib/api/auth", () => ({ getAuthenticatedClient: vi.fn(), requireShopPermission: vi.fn() }));
vi.mock("@/lib/admin", () => ({ createServiceClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));

const authMock = vi.mocked(getAuthenticatedClient);
const permissionMock = vi.mocked(requireShopPermission);
const serviceClientMock = vi.mocked(createServiceClient);
const auditMock = vi.mocked(recordAudit);

function request(body: unknown, headers?: HeadersInit) {
  return new Request("http://localhost/api/test", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function rpcClient(result: { data: unknown; error: unknown }) {
  return { rpc: vi.fn().mockResolvedValue(result) };
}

describe("authenticated API contracts", () => {
  beforeEach(() => {
    authMock.mockReset();
    permissionMock.mockReset();
    serviceClientMock.mockReset();
    auditMock.mockReset();
    permissionMock.mockResolvedValue({ ok: true, shopId: "shop-1" });
  });

  it("rejects customer creation without authentication", async () => {
    authMock.mockResolvedValue({ supabase: null, user: null });

    const response = await createCustomer(request({ name: "Ali", amount: 0 }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Kirish talab qilinadi." });
  });

  it("validates customer and credit input before writing", async () => {
    const supabase = { from: vi.fn() };
    authMock.mockResolvedValue({ supabase: supabase as never, user: { id: "user-1" } as never });

    const customerResponse = await createCustomer(request({ name: "A", amount: 0 }));
    const creditResponse = await createCredit(request({ amount: 0 }), { params: Promise.resolve({ id: "customer-1" }) });

    expect(customerResponse.status).toBe(400);
    expect(creditResponse.status).toBe(400);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("maps atomic payment overpayment errors to a safe client error", async () => {
    const supabase = rpcClient({ data: null, error: { code: "22023", message: "To'lov qarzdan oshib ketdi." } });
    authMock.mockResolvedValue({ supabase: supabase as never, user: { id: "user-1" } as never });

    const response = await createPayment(request({ amount: 500 }), { params: Promise.resolve({ id: "customer-1" }) });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "To'lov qarzdan oshib ketdi." });
    expect(supabase.rpc).toHaveBeenCalledWith("record_payment_atomic", expect.objectContaining({ p_customer_id: "customer-1", p_amount: 500 }));
  });

  it("rejects invalid payments before invoking the atomic RPC", async () => {
    const supabase = rpcClient({ data: null, error: null });
    authMock.mockResolvedValue({ supabase: supabase as never, user: { id: "user-1" } as never });

    const response = await createPayment(request({ amount: -1 }), { params: Promise.resolve({ id: "customer-1" }) });

    expect(response.status).toBe(400);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("requires activity fields and writes valid activity through the API", async () => {
    const single = vi.fn().mockResolvedValue({ data: { id: "activity-1" }, error: null });
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select }));
    const supabase = { from: vi.fn(() => ({ insert })) };
    authMock.mockResolvedValue({ supabase: supabase as never, user: { id: "user-1" } as never });

    const invalidResponse = await createActivity(request({ customerId: "customer-1" }));
    const validResponse = await createActivity(request({ customerId: "customer-1", eventType: "payment", description: "To'lov yozildi" }));

    expect(invalidResponse.status).toBe(400);
    expect(validResponse.status).toBe(201);
    expect(insert).toHaveBeenCalledWith({ customer_id: "customer-1", event_type: "payment", description: "To'lov yozildi" });
  });

  it("protects activity history with authentication", async () => {
    authMock.mockResolvedValue({ supabase: null, user: null });

    const response = await getActivity(new Request("http://localhost/api/activity"));

    expect(response.status).toBe(401);
  });

  it("validates reminder input before writing", async () => {
    const supabase = { from: vi.fn() };
    authMock.mockResolvedValue({ supabase: supabase as never, user: { id: "user-1" } as never });

    const response = await createReminder(request({ message: "Eslatma" }));

    expect(response.status).toBe(400);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("protects reports with authentication", async () => {
    authMock.mockResolvedValue({ supabase: null, user: null });

    const response = await getReport(new Request("http://localhost/api/reports"));

    expect(response.status).toBe(401);
  });

  it("validates expenses before writing", async () => {
    const supabase = { from: vi.fn() };
    authMock.mockResolvedValue({ supabase: supabase as never, user: { id: "user-1" } as never });

    const response = await createExpense(request({ category: "", amount: 100 }));

    expect(response.status).toBe(400);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("returns 403 when the authenticated role lacks a permission", async () => {
    const supabase = { from: vi.fn() };
    authMock.mockResolvedValue({ supabase: supabase as never, user: { id: "user-1" } as never });
    permissionMock.mockResolvedValue({ ok: false, response: NextResponse.json({ error: "Bu amal uchun ruxsat yo'q." }, { status: 403 }) });

    const response = await createExpense(request({ category: "Ijara", amount: 100 }));

    expect(response.status).toBe(403);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("protects team management endpoints with authentication and permission", async () => {
    authMock.mockResolvedValue({ supabase: null, user: null });
    const unauthenticated = await getTeam(new Request("http://localhost/api/team"));
    expect(unauthenticated.status).toBe(401);

    const supabase = { from: vi.fn() };
    authMock.mockResolvedValue({ supabase: supabase as never, user: { id: "user-1" } as never });
    permissionMock.mockResolvedValue({ ok: false, response: NextResponse.json({ error: "Bu amal uchun ruxsat yo'q." }, { status: 403 }) });
    const denied = await inviteTeam(request({ email: "worker@example.com", role: "cashier" }));
    expect(denied.status).toBe(403);
    expect(serviceClientMock).not.toHaveBeenCalled();
  });

  it("validates team invites before using the server-only Supabase key", async () => {
    authMock.mockResolvedValue({ supabase: { from: vi.fn() } as never, user: { id: "user-1" } as never });
    const response = await inviteTeam(request({ email: "not-an-email", role: "cashier" }));
    expect(response.status).toBe(400);
    expect(serviceClientMock).not.toHaveBeenCalled();
  });

  it("protects shop name updates with owner permission and validation", async () => {
    authMock.mockResolvedValue({ supabase: { from: vi.fn() } as never, user: { id: "user-1" } as never });
    const invalidResponse = await updateShop(request({ name: "A" }));
    expect(invalidResponse.status).toBe(400);

    permissionMock.mockResolvedValue({ ok: false, response: NextResponse.json({ error: "Bu amal uchun ruxsat yo'q." }, { status: 403 }) });
    const deniedResponse = await updateShop(request({ name: "Yangi do‘kon" }));
    expect(deniedResponse.status).toBe(403);
  });

  it("does not allow the only shop owner to be suspended", async () => {
    const currentQuery = { eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: { id: "membership-1", user_id: "owner-1", role: "shop_owner", status: "active" }, error: null }) };
    const countQuery = { eq: vi.fn().mockReturnThis(), then: (resolve: (value: unknown) => unknown) => resolve({ count: 1, error: null }) };
    const service = { from: vi.fn(() => ({ select: vi.fn((_fields: string, options?: unknown) => options ? countQuery : currentQuery) })) };
    serviceClientMock.mockReturnValue(service as never);
    authMock.mockResolvedValue({ supabase: { rpc: vi.fn() } as never, user: { id: "manager-1" } as never });

    const response = await updateTeamMember(request({ status: "suspended" }), { params: Promise.resolve({ id: "membership-1" }) });

    expect(response.status).toBe(400);
    expect(auditMock).not.toHaveBeenCalled();
  });
});
