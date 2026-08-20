import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { PATCH as updateReminder } from "@/app/api/reminders/[id]/route";
import { getAuthenticatedClient, requireShopPermission } from "@/lib/api/auth";

vi.mock("@/lib/api/auth", () => ({ getAuthenticatedClient: vi.fn(), requireShopPermission: vi.fn() }));

const authMock = vi.mocked(getAuthenticatedClient);
const permissionMock = vi.mocked(requireShopPermission);

function request(body: unknown) {
  return new Request("http://localhost/api/reminders/reminder-1", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

describe("reminder lifecycle", () => {
  beforeEach(() => {
    authMock.mockReset();
    permissionMock.mockReset();
    permissionMock.mockResolvedValue({ ok: true, shopId: "shop-1" });
  });

  it("moves failed reminders back to pending when they receive a new schedule", async () => {
    const currentQuery = { eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: { status: "failed", scheduled_for: "2026-08-20T00:00:00.000Z" }, error: null }) };
    const updateQuery = {
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: "reminder-1", status: "pending" }, error: null }) }),
    };
    const update = vi.fn().mockReturnValue(updateQuery);
    const supabase = {
      from: vi.fn()
        .mockReturnValueOnce({ select: vi.fn().mockReturnValue(currentQuery) })
        .mockReturnValueOnce({ update }),
    };
    authMock.mockResolvedValue({ supabase: supabase as never, user: { id: "user-1" } as never });

    const response = await updateReminder(request({ scheduledFor: "2026-08-21T10:00:00.000Z", message: "Qayta qo'ng'iroq" }), { params: Promise.resolve({ id: "reminder-1" }) });

    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: "pending", sent_at: null, error_reason: null }));
    expect(updateQuery.eq).toHaveBeenCalledWith("shop_id", "shop-1");
  });

  it("rejects invalid status transitions before writing", async () => {
    const currentQuery = { eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: { status: "sent", scheduled_for: "2026-08-20T00:00:00.000Z" }, error: null }) };
    const from = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue(currentQuery), update: vi.fn() });
    authMock.mockResolvedValue({ supabase: { from } as never, user: { id: "user-1" } as never });

    const response = await updateReminder(request({ status: "cancelled" }), { params: Promise.resolve({ id: "reminder-1" }) });

    expect(response.status).toBe(400);
    expect(from).toHaveBeenCalledTimes(1);
  });

  it("returns permission errors without reading reminder data", async () => {
    permissionMock.mockResolvedValue({ ok: false, response: NextResponse.json({ error: "Bu amal uchun ruxsat yo'q." }, { status: 403 }) });
    authMock.mockResolvedValue({ supabase: { from: vi.fn() } as never, user: { id: "user-1" } as never });

    const response = await updateReminder(request({ status: "sent" }), { params: Promise.resolve({ id: "reminder-1" }) });

    expect(response.status).toBe(403);
  });
});
