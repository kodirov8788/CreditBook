import { NextResponse } from "next/server";
import { serverError, unauthorized } from "@/lib/api/response";
import { getAuthenticatedClient, requireShopPermission } from "@/lib/api/auth";
import { readShopDashboard } from "@/lib/shop-read-model";

export async function GET(request: Request) {
  const { supabase, user } = await getAuthenticatedClient(request);
  if (!supabase || !user) return unauthorized();
  const access = await requireShopPermission(supabase, user, "customer.read");
  if (!access.ok) return access.response;
  try {
    return NextResponse.json(await readShopDashboard(supabase, access.shopId), {headers: {"Cache-Control": "private, no-store"}});
  } catch {
    return serverError();
  }
}
