import { NextResponse } from "next/server";
import { badRequest, serverError, unauthorized } from "@/lib/api/response";
import { getAuthenticatedClient, requireShopPermission } from "@/lib/api/auth";

const reminderSelect = "id, customer_id, debt_id, channel, scheduled_for, sent_at, status, error_reason, message, created_at, customers(name, phone)";

export async function GET(request: Request) {
  const { supabase, user } = await getAuthenticatedClient(request);
  if (!supabase || !user) return unauthorized();
  const access = await requireShopPermission(supabase, user, "reminder.read");
  if (!access.ok) return access.response;

  const status = new URL(request.url).searchParams.get("status");
  let query = supabase.from("reminders").select(reminderSelect).eq("shop_id", access.shopId).order("scheduled_for", { ascending: true, nullsFirst: false });
  if (status === "pending" || status === "sent" || status === "cancelled" || status === "failed") query = query.eq("status", status);
  const { data, error } = await query;
  if (error) return serverError();
  return NextResponse.json({ reminders: data });
}

export async function POST(request: Request) {
  const { supabase, user } = await getAuthenticatedClient(request);
  if (!supabase || !user) return unauthorized();
  const access = await requireShopPermission(supabase, user, "reminder.create");
  if (!access.ok) return access.response;

  const body = await request.json().catch(() => null) as { customerId?: string; debtId?: string | null; scheduledFor?: string; message?: string; channel?: string } | null;
  if (!body?.customerId || !body.scheduledFor) return badRequest("Mijoz va muddatni kiriting.");
  const scheduledFor = new Date(body.scheduledFor);
  if (Number.isNaN(scheduledFor.getTime())) return badRequest("Muddat noto'g'ri.");
  const channel = body.channel || "manual";
  if (!["manual", "sms", "whatsapp", "email"].includes(channel)) return badRequest("Eslatma kanali noto'g'ri.");

  const { data, error } = await supabase.from("reminders").insert({
    customer_id: body.customerId,
    debt_id: body.debtId || null,
    channel,
    scheduled_for: scheduledFor.toISOString(),
    message: body.message?.trim() || null,
  }).select(reminderSelect).single();
  if (error || !data) return serverError();
  return NextResponse.json({ reminder: data }, { status: 201 });
}
