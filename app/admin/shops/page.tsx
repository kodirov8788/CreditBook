import { requirePlatformAdmin } from "@/lib/admin";
import AdminShopsTable from "@/components/admin/admin-shops-table";

export default async function AdminShopsPage() {
  const { client } = await requirePlatformAdmin();
  const { data: shops } = await client.from("shops").select("id, name, status, owner_user_id, created_at, shop_members(count)").order("created_at", { ascending: false });
  const rows = (shops ?? []).map((shop) => ({ id: shop.id, name: shop.name, status: shop.status, createdAt: shop.created_at, memberCount: Array.isArray(shop.shop_members) ? shop.shop_members[0]?.count ?? 0 : 0 }));
  return <div className="admin-page"><header className="admin-page-head"><div><div className="eyebrow">Tenant nazorati</div><h1>Do‘konlar</h1><p>Shop holati va a’zolar sonini kuzating.</p></div></header><AdminShopsTable shops={rows} /></div>;
}
