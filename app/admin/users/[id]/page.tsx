import Link from "next/link";
import { ArrowLeft, Mail, ShieldCheck, UserRound } from "lucide-react";
import { requirePlatformAdmin } from "@/lib/admin";
import AdminUserActions from "@/components/admin/admin-user-actions";
import AdminMembershipRole from "@/components/admin/admin-membership-role";

type Context = { params: Promise<{ id: string }> };

export default async function AdminUserDetailPage({ params }: Context) {
  const { id } = await params;
  const { client } = await requirePlatformAdmin();
  const [{ data: result }, { data: memberships }] = await Promise.all([
    client.auth.admin.getUserById(id),
    client.from("shop_members").select("id, shop_id, role, status, created_at, shops(name)").eq("user_id", id),
  ]);
  const user = result.user;
  if (!user) return <div className="admin-empty">Foydalanuvchi topilmadi.</div>;
  const banned = Boolean(user.banned_until && new Date(user.banned_until) > new Date());

  return <div className="admin-page"><Link href="/admin/users" className="admin-back"><ArrowLeft size={16} />Foydalanuvchilarga qaytish</Link><header className="admin-detail-head"><span className="admin-avatar large"><UserRound size={24} /></span><div><div className="eyebrow">Account tafsiloti</div><h1>{user.user_metadata?.full_name || "Ism kiritilmagan"}</h1><p>{user.email ?? "Email yo‘q"}</p></div><span className={`admin-status ${banned ? "suspended" : "active"}`}>{banned ? "Bloklangan" : "Faol"}</span></header><section className="admin-detail-grid"><div className="admin-panel"><div className="admin-panel-head"><div><h2>Account nazorati</h2><p>Login va kirish holatini boshqaring.</p></div></div><div className="admin-detail-meta"><span><Mail size={16} />{user.email ?? "Email yo‘q"}</span><span><ShieldCheck size={16} />ID: {user.id}</span></div><AdminUserActions userId={user.id} banned={banned} /></div><div className="admin-panel"><div className="admin-panel-head"><div><h2>Shop membership’lari</h2><p>Bu account qaysi shop’larda ishlaydi.</p></div></div>{memberships?.length ? <div className="admin-list">{memberships.map((member) => { const shop = Array.isArray(member.shops) ? member.shops[0] : member.shops; return <div className="admin-list-row" key={member.id}><span className="admin-list-icon"><ShieldCheck size={17} /></span><span className="admin-list-copy"><strong>{shop?.name ?? "Do‘kon"}</strong><small>{member.status === "active" ? "Faol a’zo" : "To‘xtatilgan"}</small></span><AdminMembershipRole userId={user.id} shopId={member.shop_id} initialRole={member.role} /></div>; })}</div> : <div className="admin-empty">Membership topilmadi.</div>}</div></section></div>;
}
