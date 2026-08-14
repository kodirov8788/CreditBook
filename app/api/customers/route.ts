import { NextResponse } from "next/server";
import { badRequest, serverError, unauthorized } from "@/lib/api/response";
import { getAuthenticatedClient } from "@/lib/api/auth";

export async function GET(request: Request) {
  const { supabase, user } = await getAuthenticatedClient(request);
  if (!supabase || !user) return unauthorized();

  const { data, error } = await supabase
    .from("customers")
    .select("id, name, phone, address, notes, created_at, updated_at, debts(id, title, principal, due_date, status, created_at, payments(id, amount, paid_at, note))")
    .order("created_at", { ascending: false });

  if (error) return serverError();
  return NextResponse.json({ customers: data });
}

export async function POST(request: Request) {
  const { supabase, user } = await getAuthenticatedClient(request);
  if (!supabase || !user) return unauthorized();

  const body = await request.json().catch(() => null) as { name?: string; phone?: string; address?: string; notes?: string; amount?: number; dueDate?: string } | null;
  const name = body?.name?.trim();
  if (!name || name.length < 2) return badRequest("Mijoz ismini kiriting.");

  const { data: customer, error } = await supabase
    .from("customers")
    .insert({ name, phone: body?.phone?.trim() || null, address: body?.address?.trim() || null, notes: body?.notes?.trim() || null })
    .select("id, name, phone, address, notes, created_at")
    .single();

  if (error || !customer) return serverError();

  if (body?.amount && body.amount > 0) {
    const { error: debtError } = await supabase.from("debts").insert({ customer_id: customer.id, principal: body.amount, due_date: body.dueDate || null, title: "Qarz" });
    if (debtError) return serverError();
  }

  return NextResponse.json({ customer }, { status: 201 });
}
