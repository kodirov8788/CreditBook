import { requirePlatformAdmin } from "@/lib/admin";
import AdminUsersTable from "@/components/admin/admin-users-table";

const PAGE_SIZE = 20;
const AUTH_PAGE_SIZE = 100;

type SearchParams = Promise<{ page?: string; q?: string }>;

async function listAllUsers(client: Awaited<ReturnType<typeof requirePlatformAdmin>>["client"]) {
  const users = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: AUTH_PAGE_SIZE });
    if (error) return { users: [], error };
    users.push(...data.users);
    if (data.users.length < AUTH_PAGE_SIZE) break;
  }
  return { users, error: null };
}

export default async function AdminUsersPage({ searchParams }: { searchParams: SearchParams }) {
  const { client } = await requirePlatformAdmin();
  const params = await searchParams;
  const query = params.q?.trim().toLowerCase() ?? "";
  const requestedPage = Math.max(Number.parseInt(params.page ?? "1", 10) || 1, 1);
  const [{ users: allUsers }, { data: memberships }] = await Promise.all([
    listAllUsers(client),
    client.from("shop_members").select("user_id, role, status, shops(name)").order("created_at", { ascending: false }),
  ]);
  const memberByUser = new Map<string, { role: string; status: string; shop: string }>();
  for (const member of memberships ?? []) {
    if (!memberByUser.has(member.user_id)) {
      const shop = Array.isArray(member.shops) ? member.shops[0] : member.shops;
      memberByUser.set(member.user_id, { role: member.role, status: member.status, shop: shop?.name ?? "Do‘kon" });
    }
  }

  const filteredUsers = allUsers.filter((user) => !query || `${user.email ?? ""} ${user.user_metadata?.full_name ?? ""} ${user.id}`.toLowerCase().includes(query));
  const pageCount = Math.max(1, Math.ceil(filteredUsers.length / PAGE_SIZE));
  const page = Math.min(requestedPage, pageCount);
  const rows = filteredUsers.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((user) => { const member = memberByUser.get(user.id); return { id: user.id, email: user.email ?? "Email yo‘q", name: user.user_metadata?.full_name || "Ism kiritilmagan", shop: member?.shop ?? "—", role: member?.role ?? "—", memberStatus: member?.status ?? "active", banned: Boolean(user.banned_until && new Date(user.banned_until) > new Date()) }; });
  return <div className="admin-page"><header className="admin-page-head"><div><div className="eyebrow">Account nazorati</div><h1>Foydalanuvchilar</h1><p>Foydalanuvchi holati va asosiy shop membership’larini boshqaring.</p></div></header><AdminUsersTable users={rows} totalCount={filteredUsers.length} page={page} pageCount={pageCount} query={params.q?.trim() ?? ""} /></div>;
}
