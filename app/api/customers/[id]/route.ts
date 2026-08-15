import { NextResponse } from "next/server";
import { badRequest, unauthorized } from "@/lib/api/response";
import { getAuthenticatedClient } from "@/lib/api/auth";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  const { id } = await context.params;
  const { supabase, user } = await getAuthenticatedClient(request);
  if (!supabase || !user) return unauthorized();

  const { data, error } = await supabase.from("customers").select("id, name, phone, address, notes, created_at, updated_at, debts(id, title, principal, due_date, status, created_at, payments(id, amount, paid_at, note, voided_at, void_reason))").eq("id", id).single();
  if (error) return NextResponse.json({ error: "Mijoz topilmadi." }, { status: 404 });
  return NextResponse.json({ customer: data });
}

export async function PATCH(request: Request, context: Context) {
  const { id } = await context.params;
  const { supabase, user } = await getAuthenticatedClient(request);
  if (!supabase || !user) return unauthorized();
  const body = await request.json().catch(() => null) as { name?: string; phone?: string; address?: string; notes?: string } | null;
  const name = body?.name?.trim();
  if (!name || name.length < 2) return badRequest("Mijoz ismini kiriting.");

  const { data, error } = await supabase.from("customers").update({ name, phone: body?.phone?.trim() || null, address: body?.address?.trim() || null, notes: body?.notes?.trim() || null }).eq("id", id).select("id, name, phone, address, notes, updated_at").single();
  if (error || !data) return NextResponse.json({ error: "Mijoz topilmadi." }, { status: 404 });
  return NextResponse.json({ customer: data });
}
