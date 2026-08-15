import { requirePlatformAdmin } from "@/lib/admin";
import AdminUsersTable from "@/components/admin/admin-users-table";

export default async function AdminUsersPage() {
  const { client } = await requirePlatformAdmin();
  const [{ data: usersData }, { data: memberships }] = await Promise.all([
    client.auth.admin.listUsers({ page: 1, perPage: 100 }),
    client.from("shop_members").select("user_id, role, status, shops(name)").order("created_at", { ascending: false }),
  ]);
  const memberByUser = new Map<string, { role: string; status: string; shop: string }>();
  for (const member of memberships ?? []) {
    if (!memberByUser.has(member.user_id)) {
      const shop = Array.isArray(member.shops) ? member.shops[0] : member.shops;
      memberByUser.set(member.user_id, { role: member.role, status: member.status, shop: shop?.name ?? "Do‘kon" });
    }
  }

  const rows = usersData.users.map((user) => { const member = memberByUser.get(user.id); return { id: user.id, email: user.email ?? "Email yo‘q", name: user.user_metadata?.full_name || "Ism kiritilmagan", shop: member?.shop ?? "—", role: member?.role ?? "—", memberStatus: member?.status ?? "active", banned: Boolean(user.banned_until && new Date(user.banned_until) > new Date()) }; });
  return <div className="admin-page"><header className="admin-page-head"><div><div className="eyebrow">Account nazorati</div><h1>Foydalanuvchilar</h1><p>Foydalanuvchi holati va asosiy shop membership’larini boshqaring.</p></div></header><AdminUsersTable users={rows} /></div>;
}
