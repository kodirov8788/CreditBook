import { NextResponse } from "next/server";
import { getAuthenticatedClient } from "@/lib/api/auth";
import { unauthorized, serverError } from "@/lib/api/response";

export async function GET(request: Request) {
  const { supabase, user } = await getAuthenticatedClient(request);
  if (!supabase || !user) return unauthorized();

  const { data: memberships, error: membershipError } = await supabase
    .from("shop_members")
    .select("shop_id")
    .eq("user_id", user.id)
    .eq("status", "active")
    .order("created_at", { ascending: true });
  if (membershipError) return serverError();

  const shopIds = [...new Set((memberships ?? []).map((membership) => membership.shop_id))];
  if (!shopIds.length) return NextResponse.json({ shops: [], currentShopId: null });

  const [{ data: shops, error: shopsError }, { data: currentShopId }] = await Promise.all([
    supabase.from("shops").select("id, name").in("id", shopIds).eq("status", "active").order("created_at", { ascending: true }),
    supabase.rpc("get_current_shop_id"),
  ]);
  if (shopsError) return serverError();
  return NextResponse.json({ shops: shops ?? [], currentShopId: currentShopId ?? null });
}
