import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

type AuditEvent = {
  actorUserId: string | null;
  shopId?: string | null;
  entityType: "user" | "shop" | "membership";
  entityId?: string | null;
  action: string;
  metadata?: Record<string, unknown>;
};

export async function recordAudit(client: SupabaseClient, event: AuditEvent) {
  const { error } = await client.from("audit_logs").insert({
    actor_user_id: event.actorUserId,
    shop_id: event.shopId ?? null,
    entity_type: event.entityType,
    entity_id: event.entityId ?? null,
    action: event.action,
    metadata: event.metadata ?? {},
  });

  if (error) {
    console.error("Audit log yozilmadi:", error.message);
    throw new Error("Audit log yozilmadi.");
  }
  return true;
}
