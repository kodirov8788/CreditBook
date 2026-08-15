import { NextResponse } from "next/server";
import { badRequest, serverError, unauthorized } from "@/lib/api/response";
import { getAuthenticatedClient, requireShopPermission } from "@/lib/api/auth";
import { createServiceClient } from "@/lib/admin";
import { recordAudit } from "@/lib/audit";

const MIN_NAME_LENGTH = 2;
const MAX_NAME_LENGTH = 80;

export async function PATCH(request: Request) {
  const { supabase, user } = await getAuthenticatedClient(request);
  if (!supabase || !user) return unauthorized();

  const access = await requireShopPermission(supabase, user, "shop.update");
  if (!access.ok) return access.response;

  const body = await request.json().catch(() => null) as { name?: string } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (name.length < MIN_NAME_LENGTH || name.length > MAX_NAME_LENGTH) {
    return badRequest("Shop nomi 2–80 belgidan iborat bo‘lsin.");
  }

  const { data: current, error: currentError } = await supabase
    .from("shops")
    .select("id, name")
    .eq("id", access.shopId)
    .maybeSingle();
  if (currentError || !current) return serverError();

  const { data: shop, error } = await supabase
    .from("shops")
    .update({ name })
    .eq("id", access.shopId)
    .select("id, name")
    .single();
  if (error || !shop) return serverError();

  if (current.name !== shop.name) {
    const service = createServiceClient();
    if (service) {
      await recordAudit(service, {
        actorUserId: user.id,
        shopId: shop.id,
        entityType: "shop",
        entityId: shop.id,
        action: "shop.name_updated",
        metadata: { oldName: current.name, newName: shop.name },
      });
    }
  }

  return NextResponse.json({ shop });
}
