import Link from "next/link";
import { ArrowLeft, Store, UserRound } from "lucide-react";
import { requirePlatformAdmin } from "@/lib/admin";
import AdminShopActions from "@/components/admin/admin-shop-actions";
import { teamRoleLabel } from "@/lib/team-roles";

type Context = { params: Promise<{ id: string }> };

export default async function AdminShopDetailPage({ params }: Context) {
  const { id } = await params;
  const { client } = await requirePlatformAdmin();
  const [{ data: shop }, { data: members }] = await Promise.all([
    client.from("shops").select("id, name, status, owner_user_id, created_at").eq("id", id).maybeSingle(),
    client.from("shop_members").select("id, user_id, role, status, created_at").eq("shop_id", id).order("created_at", { ascending: true }),
  ]);
  if (!shop) return <div className="admin-empty">Do‘kon topilmadi.</div>;
  const userIds = (members ?? []).map((member) => member.user_id);
  const users = await Promise.all(userIds.map(async (userId) => (await client.auth.admin.getUserById(userId)).data.user));
  const userById = new Map(users.filter(Boolean).map((user) => [user!.id, user!]));

  return <div className="admin-page"><Link href="/admin/shops" className="admin-back"><ArrowLeft size={16} />Do‘konlarga qaytish</Link><header className="admin-detail-head"><span className="admin-avatar large"><Store size={24} /></span><div><div className="eyebrow">Shop tafsiloti</div><h1>{shop.name}</h1><p>{members?.length ?? 0} ta a’zo</p></div><span className={`admin-status ${shop.status}`}>{shop.status === "active" ? "Faol" : "To‘xtatilgan"}</span></header><section className="admin-panel"><div className="admin-panel-head"><div><h2>Shop nazorati</h2><p>Shop’ni vaqtincha to‘xtatish barcha a’zolar access’ini yopadi.</p></div></div><AdminShopActions shopId={shop.id} status={shop.status} /></section><section className="admin-panel"><div className="admin-panel-head"><div><h2>Jamoa</h2><p>Shop’dagi barcha a’zolar va rollar.</p></div></div><div className="admin-list">{(members ?? []).map((member) => { const user = userById.get(member.user_id); return <div className="admin-list-row" key={member.id}><span className="admin-list-icon"><UserRound size={17} /></span><span className="admin-list-copy"><strong>{user?.user_metadata?.full_name || user?.email || "User"}</strong><small>{user?.email ?? "Email yo‘q"}</small></span><span className="role-badge">{teamRoleLabel(member.role)}</span><span className={`admin-status ${member.status}`}>{member.status === "active" ? "Faol" : member.status === "invited" ? "Taklif yuborilgan" : "To‘xtatilgan"}</span></div>; })}</div></section></div>;
}
