import { NextResponse } from "next/server";
import { badRequest, serverError, unauthorized } from "@/lib/api/response";
import { getAuthenticatedClient } from "@/lib/api/auth";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  const { id } = await context.params;
  const { supabase, user } = await getAuthenticatedClient();
  if (!supabase || !user) return unauthorized();
  const { data, error } = await supabase.from("debts").select("id, title, principal, due_date, status, notes, created_at, updated_at, payments(id, amount, paid_at, note)").eq("customer_id", id).order("created_at", { ascending: false });
  if (error) return serverError();
  return NextResponse.json({ credits: data });
}

export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  const { supabase, user } = await getAuthenticatedClient();
  if (!supabase || !user) return unauthorized();
  const body = await request.json().catch(() => null) as { amount?: number; title?: string; dueDate?: string; notes?: string } | null;
  if (!body?.amount || body.amount <= 0) return badRequest("Qarz summasini kiriting.");

  const { data, error } = await supabase.from("debts").insert({ customer_id: id, principal: body.amount, title: body.title?.trim() || "Qarz", due_date: body.dueDate || null, notes: body.notes?.trim() || null }).select("id, title, principal, due_date, status, created_at").single();
  if (error || !data) return serverError();
  return NextResponse.json({ credit: data }, { status: 201 });
}
