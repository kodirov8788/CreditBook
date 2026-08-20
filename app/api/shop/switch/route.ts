import { NextResponse } from "next/server";
import { getAuthenticatedClient } from "@/lib/api/auth";
import { badRequest, forbidden, serverError, unauthorized } from "@/lib/api/response";

export async function POST(request: Request) {
  const { supabase, user } = await getAuthenticatedClient(request);
  if (!supabase || !user) return unauthorized();
  const body = await request.json().catch(() => null) as { shopId?: string } | null;
  if (!body?.shopId || !/^[0-9a-f-]{36}$/i.test(body.shopId)) return badRequest("Do'kon tanlanmadi.");

  const { data, error } = await supabase.rpc("switch_current_shop", { p_shop_id: body.shopId });
  if (error) {
    if (error.code === "42501" || error.code === "P0002") return forbidden();
    return serverError();
  }
  return NextResponse.json({ currentShopId: data });
}
