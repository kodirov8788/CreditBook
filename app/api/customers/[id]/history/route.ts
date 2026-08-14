import { NextResponse } from "next/server";
import { serverError, unauthorized } from "@/lib/api/response";
import { getAuthenticatedClient } from "@/lib/api/auth";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  const { id } = await context.params;
  const { supabase, user } = await getAuthenticatedClient();
  if (!supabase || !user) return unauthorized();

  const [{ data: credits, error: creditError }, { data: payments, error: paymentError }] = await Promise.all([
    supabase.from("debts").select("id, title, principal, due_date, status, created_at").eq("customer_id", id).order("created_at", { ascending: false }),
    supabase.from("payments").select("id, debt_id, amount, paid_at, note, created_at").eq("customer_id", id).order("paid_at", { ascending: false }),
  ]);
  if (creditError || paymentError) return serverError();
  return NextResponse.json({ credits, payments });
}
