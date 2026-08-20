import { requirePlatformAdmin } from "@/lib/admin";
import AuditLogList, { type AuditRow } from "@/components/admin/audit-log-list";

type AuditRecord = { id: string; actor_user_id: string | null; shop_id: string | null; entity_type: string; entity_id: string | null; action: string; metadata: Record<string, unknown>; created_at: string };
const PAGE_SIZE = 50;
type SearchParams = Promise<{ page?: string; q?: string; action?: string }>;

export default async function AdminAuditPage({ searchParams }: { searchParams: SearchParams }) {
  const { client } = await requirePlatformAdmin();
  const params = await searchParams;
  const query = params.q?.trim() ?? "";
  const action = params.action?.trim() ?? "";
  const requestedPage = Math.max(Number.parseInt(params.page ?? "1", 10) || 1, 1);
  let countQuery = client.from("audit_logs").select("id", { count: "exact", head: true });
  if (action) countQuery = countQuery.eq("action", action);
  if (query) {
    const safeQuery = query.replace(/[(),]/g, " ");
    countQuery = countQuery.or(`action.ilike.%${safeQuery}%,entity_type.ilike.%${safeQuery}%`);
  }
  const { count } = await countQuery;
  const pageCount = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));
  const page = Math.min(requestedPage, pageCount);
  let auditQuery = client.from("audit_logs").select("id, actor_user_id, shop_id, entity_type, entity_id, action, metadata, created_at").order("created_at", { ascending: false });
  if (action) auditQuery = auditQuery.eq("action", action);
  if (query) {
    const safeQuery = query.replace(/[(),]/g, " ");
    auditQuery = auditQuery.or(`action.ilike.%${safeQuery}%,entity_type.ilike.%${safeQuery}%`);
  }
  const { data, error } = await auditQuery.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
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
  return <div className="admin-page"><header className="admin-page-head"><div><div className="eyebrow">Xavfsizlik nazorati</div><h1>Audit tarixi</h1><p>Account, shop va rollardagi muhim o‘zgarishlar.</p></div><span className="admin-secure-badge">{count ?? 0} ta yozuv</span></header><section className="admin-panel"><div className="admin-panel-head"><div><h2>O‘zgarishlar jurnali</h2><p>Faqat platform owner va admin ko‘ra oladi.</p></div></div><AuditLogList rows={rows} totalCount={count ?? 0} page={page} pageCount={pageCount} query={query} action={action} /></section></div>;
}
