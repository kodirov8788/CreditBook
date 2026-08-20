import { requirePlatformAdmin } from "@/lib/admin";
import AdminShopsTable from "@/components/admin/admin-shops-table";

const PAGE_SIZE = 20;

type SearchParams = Promise<{ page?: string; q?: string; status?: string }>;

export default async function AdminShopsPage({ searchParams }: { searchParams: SearchParams }) {
  const { client } = await requirePlatformAdmin();
  const params = await searchParams;
  const query = params.q?.trim() ?? "";
  const status = params.status === "active" || params.status === "suspended" ? params.status : "all";
  const requestedPage = Math.max(Number.parseInt(params.page ?? "1", 10) || 1, 1);
  let shopsQuery = client.from("shops").select("id, name, status, owner_user_id, created_at, shop_members(count)", { count: "exact" }).order("created_at", { ascending: false });
  if (query) shopsQuery = shopsQuery.ilike("name", `%${query.replace(/[,%()]/g, " ")}%`);
  if (status !== "all") shopsQuery = shopsQuery.eq("status", status);
  const { data: shops, count } = await shopsQuery.range((requestedPage - 1) * PAGE_SIZE, requestedPage * PAGE_SIZE - 1);
  const pageCount = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));
  const page = Math.min(requestedPage, pageCount);
  const rows = (shops ?? []).map((shop) => ({ id: shop.id, name: shop.name, status: shop.status, createdAt: shop.created_at, memberCount: Array.isArray(shop.shop_members) ? shop.shop_members[0]?.count ?? 0 : 0 }));
  return <div className="admin-page"><header className="admin-page-head"><div><div className="eyebrow">Tenant nazorati</div><h1>Do‘konlar</h1><p>Shop holati va a’zolar sonini kuzating.</p></div></header><AdminShopsTable shops={rows} totalCount={count ?? 0} page={page} pageCount={pageCount} query={query} status={status} /></div>;
}
