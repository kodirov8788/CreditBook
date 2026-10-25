import { NextResponse } from "next/server";
import { badRequest, serverError, unauthorized } from "@/lib/api/response";
import { getAuthenticatedClient, requireShopPermission } from "@/lib/api/auth";
import { createSupabaseCustomerRepository, parseCustomerDetails } from "@/lib/data/customers";

export async function GET(request: Request) {
  const { supabase, user } = await getAuthenticatedClient(request);
  if (!supabase || !user) return unauthorized();
  const access = await requireShopPermission(supabase, user, "customer.read");
  if (!access.ok) return access.response;

  const { data, error } = await supabase
    .from("customers")
    .select("id, name, phone, address, notes, created_at, updated_at, debts(id, title, principal, due_date, status, created_at, payments(id, amount, paid_at, note, voided_at, void_reason))")
    .eq("shop_id", access.shopId)
    .order("created_at", { ascending: false });

  if (error) return serverError();
  return NextResponse.json({ customers: data });
}

export async function POST(request: Request) {
  const { supabase, user } = await getAuthenticatedClient(request);
  if (!supabase || !user) return unauthorized();
  const access = await requireShopPermission(supabase, user, "customer.create");
  if (!access.ok) return access.response;

  const body: unknown = await request.json().catch(() => null);
  const details = parseCustomerDetails(body);
  if (!details) return badRequest("Mijoz ismini kiriting.");
  const input = body as Record<string, unknown>;
  const amount = input.amount ?? 0;
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) return badRequest("Qarz summasini tekshiring.");
  if (input.dueDate != null && typeof input.dueDate !== "string") return badRequest("Sanani tekshiring.");
  try {
    const customer = await createSupabaseCustomerRepository(supabase, access.shopId).create({
      ...details, amount, dueDate: typeof input.dueDate === "string" ? input.dueDate || null : null,
    });
    return NextResponse.json({ customer }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch { return serverError(); }
}
