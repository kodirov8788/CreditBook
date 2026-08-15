import Link from "next/link";
import { LayoutDashboard, Store, Users, ShieldCheck } from "lucide-react";
import { requirePlatformAdmin } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const admin = await requirePlatformAdmin();
  return <div className="admin-shell">
    <aside className="admin-sidebar">
      <Link href="/admin" className="admin-brand"><span className="brand-mark">C</span><span><strong>CreditBook</strong><small>Platform boshqaruvi</small></span></Link>
      <nav className="admin-nav" aria-label="Admin menyu">
        <Link href="/admin" className="admin-nav-item"><LayoutDashboard size={17} />Umumiy</Link>
        <Link href="/admin/users" className="admin-nav-item"><Users size={17} />Foydalanuvchilar</Link>
        <Link href="/admin/shops" className="admin-nav-item"><Store size={17} />Do‘konlar</Link>
      </nav>
      <div className="admin-sidebar-foot"><ShieldCheck size={16} /><span>{admin.user.email ?? "Platform admin"}</span></div>
    </aside>
    <main className="admin-main">{children}</main>
  </div>;
}
