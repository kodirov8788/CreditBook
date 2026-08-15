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
    updates.status = body.status;
    updates.sent_at = body.status === "sent" ? new Date().toISOString() : null;
    if (body.status === "sent") updates.error_reason = null;
  }
  if (!Object.keys(updates).length) return badRequest("O'zgartirish kiriting.");

  const { data, error } = await supabase.from("reminders").update(updates).eq("id", id).select(reminderSelect).single();
  if (error || !data) return serverError();
  return NextResponse.json({ reminder: data });
}
