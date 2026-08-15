import { NextResponse } from "next/server";
import { badRequest, serverError, unauthorized } from "@/lib/api/response";
import { getAuthenticatedClient } from "@/lib/api/auth";

type Context = { params: Promise<{ id: string }> };
const reminderSelect = "id, customer_id, debt_id, channel, scheduled_for, sent_at, status, message, created_at, customers(name)";

export async function PATCH(request: Request, context: Context) {
  const { id } = await context.params;
  const { supabase, user } = await getAuthenticatedClient(request);
  if (!supabase || !user) return unauthorized();
  const body = await request.json().catch(() => null) as { scheduledFor?: string; message?: string; status?: string } | null;
  const updates: Record<string, string | null> = {};
  if (body?.scheduledFor) {
    const scheduledFor = new Date(body.scheduledFor);
    if (Number.isNaN(scheduledFor.getTime())) return badRequest("Muddat noto'g'ri.");
    updates.scheduled_for = scheduledFor.toISOString();
  }
  if (body?.message !== undefined) updates.message = body.message?.trim() || null;
  if (body?.status) {
    if (!["pending", "cancelled"].includes(body.status)) return badRequest("Eslatma holati noto'g'ri.");
    updates.status = body.status;
  }
  if (!Object.keys(updates).length) return badRequest("O'zgartirish kiriting.");

  const { data, error } = await supabase.from("reminders").update(updates).eq("id", id).select(reminderSelect).single();
  if (error || !data) return serverError();
  return NextResponse.json({ reminder: data });
}
