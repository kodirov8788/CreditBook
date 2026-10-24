import { NextResponse } from "next/server";
import { getAuthenticatedClient } from "@/lib/api/auth";
import { badRequest, forbidden, serverError, unauthorized } from "@/lib/api/response";
import { createSupabaseShopRepository, isShopId, ShopRepositoryError } from "@/lib/data/shops";

export async function POST(request: Request) {
  const { supabase, user } = await getAuthenticatedClient(request);
  if (!supabase || !user) return unauthorized();
  const body = await request.json().catch(() => null) as { shopId?: unknown } | null;
  if (!isShopId(body?.shopId)) return badRequest("Do'kon tanlanmadi.");
  try {
    const currentShopId = await createSupabaseShopRepository(supabase).switchTo(body.shopId);
    return NextResponse.json({ currentShopId }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof ShopRepositoryError && (error.code === "42501" || error.code === "P0002")) return forbidden();
    return serverError();
  }
}
