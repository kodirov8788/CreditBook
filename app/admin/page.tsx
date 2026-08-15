import Link from "next/link";
import { ArrowRight, Store, Users, ShieldCheck } from "lucide-react";
import { requirePlatformAdmin } from "@/lib/admin";

export default async function AdminPage() {
  const { client } = await requirePlatformAdmin();
  const [{ count: shopCount }, { count: memberCount }, { data: recentShops }] = await Promise.all([
    client.from("shops").select("id", { count: "exact", head: true }),
    client.from("shop_members").select("id", { count: "exact", head: true }).eq("status", "active"),
    client.from("shops").select("id, name, status, created_at").order("created_at", { ascending: false }).limit(5),
  ]);

  return <div className="admin-page">
    <header className="admin-page-head"><div><div className="eyebrow">Platform nazorati</div><h1>Boshqaruv markazi</h1><p>Account va do‘kon holatini bir joydan boshqaring.</p></div><span className="admin-secure-badge"><ShieldCheck size={15} />Himoyalangan</span></header>
    <section className="admin-stats" aria-label="Platform statistikasi">
      <div className="admin-stat"><Users size={19} /><span>Foydalanuvchilar</span><strong>{memberCount ?? 0}</strong></div>
      <div className="admin-stat"><Store size={19} /><span>Do‘konlar</span><strong>{shopCount ?? 0}</strong></div>
      <div className="admin-stat"><ShieldCheck size={19} /><span>RLS holati</span><strong className="admin-good">Faol</strong></div>
    </section>
    <section className="admin-panel"><div className="admin-panel-head"><div><h2>So‘nggi do‘konlar</h2><p>Yangi shop’lar va ularning holati.</p></div><Link className="text-button" href="/admin/shops">Barchasi <ArrowRight size={15} /></Link></div>{recentShops?.length ? <div className="admin-list">{recentShops.map((shop) => <Link href={`/admin/shops/${shop.id}`} className="admin-list-row" key={shop.id}><span className="admin-list-icon"><Store size={17} /></span><span className="admin-list-copy"><strong>{shop.name}</strong><small>{new Date(shop.created_at).toLocaleDateString("uz-UZ")}</small></span><span className={`admin-status ${shop.status}`}>{shop.status === "active" ? "Faol" : "To‘xtatilgan"}</span><ArrowRight size={16} /></Link>)}</div> : <div className="admin-empty">Hali do‘konlar yo‘q.</div>}</section>
  </div>;
}
