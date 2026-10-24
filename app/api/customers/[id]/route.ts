import { NextResponse } from "next/server";
import { badRequest, unauthorized } from "@/lib/api/response";
import { getAuthenticatedClient, requireShopPermission } from "@/lib/api/auth";
import { createSupabaseCustomerRepository, parseCustomerDetails } from "@/lib/data/customers";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  const { id } = await context.params;
  const { supabase, user } = await getAuthenticatedClient(request);
  if (!supabase || !user) return unauthorized();
  const access = await requireShopPermission(supabase, user, "customer.read");
  if (!access.ok) return access.response;

  const { data, error } = await supabase.from("customers").select("id, name, phone, address, notes, created_at, updated_at, debts(id, title, principal, due_date, status, created_at, payments(id, amount, paid_at, note, voided_at, void_reason))").eq("id", id).eq("shop_id", access.shopId).single();
  if (error) return NextResponse.json({ error: "Mijoz topilmadi." }, { status: 404 });
  return NextResponse.json({ customer: data });
}

export async function PATCH(request: Request, context: Context) {
  const { id } = await context.params;
  const { supabase, user } = await getAuthenticatedClient(request);
  if (!supabase || !user) return unauthorized();
  const access = await requireShopPermission(supabase, user, "customer.update");
  if (!access.ok) return access.response;
  const details = parseCustomerDetails(await request.json().catch(() => null));
  if (!details) return badRequest("Mijoz ismini kiriting.");
  try {
    const customer = await createSupabaseCustomerRepository(supabase, access.shopId).update(id, details);
    return NextResponse.json({ customer }, { headers: { "Cache-Control": "private, no-store" } });
  } catch { return NextResponse.json({ error: "Mijoz topilmadi." }, { status: 404 }); }
}
