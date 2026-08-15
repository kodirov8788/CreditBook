import { requirePlatformAdmin } from "@/lib/admin";
import AuditLogList, { type AuditRow } from "@/components/admin/audit-log-list";

type AuditRecord = { id: string; actor_user_id: string | null; shop_id: string | null; entity_type: string; entity_id: string | null; action: string; metadata: Record<string, unknown>; created_at: string };

export default async function AdminAuditPage() {
  const { client } = await requirePlatformAdmin();
  const { data, error } = await client.from("audit_logs").select("id, actor_user_id, shop_id, entity_type, entity_id, action, metadata, created_at").order("created_at", { ascending: false }).limit(100);
  if (error) return <div className="admin-page"><header className="admin-page-head"><div><div className="eyebrow">Xavfsizlik nazorati</div><h1>Audit tarixi</h1><p>Audit jadvali hali migration bilan yoqilmagan.</p></div></header><div className="admin-empty">Audit ma’lumotini olib bo‘lmadi.</div></div>;
  const records = (data ?? []) as AuditRecord[];
  const actorIds = [...new Set(records.map((record) => record.actor_user_id).filter((id): id is string => Boolean(id)))];
  const shopIds = [...new Set(records.map((record) => record.shop_id).filter((id): id is string => Boolean(id)))];
  const [actors, shopsResult] = await Promise.all([
    Promise.all(actorIds.map(async (id) => (await client.auth.admin.getUserById(id)).data.user)),
    shopIds.length ? client.from("shops").select("id, name").in("id", shopIds) : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
  ]);
  const actorById = new Map(actors.filter(Boolean).map((user) => [user!.id, user!.email ?? "Account"]));
  const shopById = new Map((shopsResult.data ?? []).map((shop) => [shop.id, shop.name]));
  const rows: AuditRow[] = records.map((record) => ({ id: record.id, action: record.action, entityType: record.entity_type, createdAt: record.created_at, actorEmail: record.actor_user_id ? actorById.get(record.actor_user_id) ?? "Account" : "System", shopName: record.shop_id ? shopById.get(record.shop_id) ?? null : null, metadata: record.metadata ?? {} }));
  return <div className="admin-page"><header className="admin-page-head"><div><div className="eyebrow">Xavfsizlik nazorati</div><h1>Audit tarixi</h1><p>Account, shop va rollardagi muhim o‘zgarishlar.</p></div><span className="admin-secure-badge">{rows.length} ta so‘nggi yozuv</span></header><section className="admin-panel"><div className="admin-panel-head"><div><h2>O‘zgarishlar jurnali</h2><p>Faqat platform owner va admin ko‘ra oladi.</p></div></div><AuditLogList rows={rows} /></section></div>;
}
