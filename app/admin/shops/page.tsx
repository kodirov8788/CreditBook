import Link from "next/link";
import { ArrowRight, Store } from "lucide-react";
import { requirePlatformAdmin } from "@/lib/admin";

export default async function AdminShopsPage() {
  const { client } = await requirePlatformAdmin();
  const { data: shops } = await client.from("shops").select("id, name, status, owner_user_id, created_at, shop_members(count)").order("created_at", { ascending: false });
  return <div className="admin-page"><header className="admin-page-head"><div><div className="eyebrow">Tenant nazorati</div><h1>Do‘konlar</h1><p>Shop holati va a’zolar sonini kuzating.</p></div></header><section className="admin-panel"><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Do‘kon</th><th>A’zolar</th><th>Holat</th><th /></tr></thead><tbody>{(shops ?? []).map((shop) => { const memberCount = Array.isArray(shop.shop_members) ? shop.shop_members[0]?.count ?? 0 : 0; return <tr key={shop.id}><td><span className="admin-user"><span className="admin-avatar"><Store size={16} /></span><span><strong>{shop.name}</strong><small>{new Date(shop.created_at).toLocaleDateString("uz-UZ")}</small></span></span></td><td>{memberCount}</td><td><span className={`admin-status ${shop.status}`}>{shop.status === "active" ? "Faol" : "To‘xtatilgan"}</span></td><td><Link className="icon-button" href={`/admin/shops/${shop.id}`} aria-label={`${shop.name} tafsilotlari`}><ArrowRight size={17} /></Link></td></tr>; })}</tbody></table></div></section></div>;
}
