import { NextResponse } from "next/server";
import { getAuthenticatedClient } from "@/lib/api/auth";
import { unauthorized, serverError } from "@/lib/api/response";

export async function GET(request: Request) {
  const { supabase, user } = await getAuthenticatedClient(request);
  if (!supabase || !user) return unauthorized();

  const [{ data: shops, error: shopsError }, { data: currentShopId, error: currentShopError }] = await Promise.all([
    supabase.rpc("list_user_shops"),
    supabase.rpc("get_current_shop_id"),
  ]);
  if (shopsError || currentShopError) return serverError();
  return NextResponse.json({ shops: shops ?? [], currentShopId: currentShopId ?? null });
}
