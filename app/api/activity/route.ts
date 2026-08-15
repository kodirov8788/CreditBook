import { NextResponse } from "next/server";
import { badRequest, serverError, unauthorized } from "@/lib/api/response";
import { getAuthenticatedClient } from "@/lib/api/auth";

export async function POST(request: Request) {
  const { supabase, user } = await getAuthenticatedClient(request);
  if (!supabase || !user) return unauthorized();

  const body = await request.json().catch(() => null) as { customerId?: string | null; eventType?: string; description?: string } | null;
  const description = body?.description?.trim();
  const eventType = body?.eventType?.trim();
  if (!description || !eventType) return badRequest("Faoliyat ma'lumotini kiriting.");

  const { data, error } = await supabase
    .from("activity_logs")
    .insert({ customer_id: body?.customerId || null, event_type: eventType, description })
    .select("id, customer_id, event_type, description, created_at")
    .single();

  if (error || !data) return serverError();
  return NextResponse.json({ activity: data }, { status: 201 });
}
