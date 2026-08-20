import { NextResponse } from "next/server";
import { badRequest, serverError, unauthorized } from "@/lib/api/response";
import { getAuthenticatedClient, requireShopPermission } from "@/lib/api/auth";

type Context = { params: Promise<{ id: string }> };
const reminderSelect = "id, customer_id, debt_id, channel, scheduled_for, sent_at, status, error_reason, message, created_at, customers(name, phone)";

export async function PATCH(request: Request, context: Context) {
  const { id } = await context.params;
  const { supabase, user } = await getAuthenticatedClient(request);
  if (!supabase || !user) return unauthorized();
  const access = await requireShopPermission(supabase, user, "reminder.update");
  if (!access.ok) return access.response;
  const body = await request.json().catch(() => null) as { scheduledFor?: string; message?: string; channel?: string; status?: string; errorReason?: string } | null;
  const { data: currentReminder, error: currentError } = await supabase.from("reminders").select("status, scheduled_for").eq("id", id).eq("shop_id", access.shopId).maybeSingle();
  if (currentError) return serverError();
  if (!currentReminder) return NextResponse.json({ error: "Eslatma topilmadi." }, { status: 404 });
  const updates: Record<string, string | null> = {};
  if (body?.scheduledFor) {
    const scheduledFor = new Date(body.scheduledFor);
    if (Number.isNaN(scheduledFor.getTime())) return badRequest("Muddat noto'g'ri.");
    updates.scheduled_for = scheduledFor.toISOString();
  }
  if (body?.message !== undefined) updates.message = body.message?.trim() || null;
  if (body?.errorReason !== undefined) updates.error_reason = body.errorReason?.trim() || null;
  if (body?.channel !== undefined) {
    if (!["manual", "sms", "whatsapp", "email"].includes(body.channel)) return badRequest("Eslatma kanali noto'g'ri.");
    updates.channel = body.channel;
  }
  if (body?.status) {
    if (!["pending", "sent", "failed", "cancelled"].includes(body.status)) return badRequest("Eslatma holati noto'g'ri.");
    const allowedTransitions: Record<string, string[]> = {
      pending: ["pending", "sent", "failed", "cancelled"],
      sent: ["sent"],
      failed: ["failed", "pending"],
      cancelled: ["cancelled", "pending"],
    };
    if (!allowedTransitions[currentReminder.status]?.includes(body.status)) return badRequest("Eslatma holatini bu tarzda o'zgartirib bo'lmaydi.");
    if (["failed", "cancelled"].includes(currentReminder.status) && body.status === "pending" && !body.scheduledFor) return badRequest("Qayta rejalash uchun yangi muddatni kiriting.");
    updates.status = body.status;
    updates.sent_at = body.status === "sent" ? new Date().toISOString() : null;
    if (body.status === "sent") updates.error_reason = null;
  }
  if (body?.scheduledFor && ["failed", "cancelled"].includes(currentReminder.status)) {
    updates.status = "pending";
    updates.sent_at = null;
    updates.error_reason = null;
  }
  if (!Object.keys(updates).length) return badRequest("O'zgartirish kiriting.");

  const { data, error } = await supabase.from("reminders").update(updates).eq("id", id).eq("shop_id", access.shopId).select(reminderSelect).single();
  if (error?.code === "PGRST116" || !data) return NextResponse.json({ error: "Eslatma topilmadi." }, { status: 404 });
  if (error) return serverError();
  return NextResponse.json({ reminder: data });
}
