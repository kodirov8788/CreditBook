"use client";

import Link from "next/link";
import { ArrowRight, Search, UserRound } from "lucide-react";
import { useMemo, useState } from "react";
import { teamRoleLabel } from "@/lib/team-roles";

type AdminUserRow = { id: string; email: string; name: string; shop: string; role: string; memberStatus: string; banned: boolean };

export default function AdminUsersTable({ users }: { users: AdminUserRow[] }) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const filtered = useMemo(() => {
    const value = query.trim().toLowerCase();
    if (!value) return users;
    return users.filter((user) => `${user.name} ${user.email} ${user.shop} ${user.role}`.toLowerCase().includes(value));
  }, [query, users]);
  const pageSize = 20;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize);

  return <section className="admin-panel"><div className="admin-panel-head"><div><h2>{filtered.length} ta account</h2><p>{filtered.length === users.length ? "Foydalanuvchi ma’lumotlari faqat server orqali olinadi." : `${users.length} ta account ichidan qidirildi.`}</p></div><div className="admin-search"><Search size={16} /><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Email yoki ism bo‘yicha qidirish" aria-label="Foydalanuvchi qidirish" /></div></div><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Foydalanuvchi</th><th>Shop</th><th>Rol</th><th>Holat</th><th /></tr></thead><tbody>{visible.map((user) => <tr key={user.id}><td><span className="admin-user"><span className="admin-avatar"><UserRound size={16} /></span><span><strong>{user.name}</strong><small>{user.email}</small></span></span></td><td>{user.shop}</td><td><span className="role-badge">{teamRoleLabel(user.role)}</span></td><td><span className={`admin-status ${user.banned || user.memberStatus === "suspended" ? "suspended" : "active"}`}>{user.banned || user.memberStatus === "suspended" ? "Bloklangan" : "Faol"}</span></td><td><Link className="icon-button" href={`/admin/users/${user.id}`} aria-label={`${user.email} tafsilotlari`}><ArrowRight size={17} /></Link></td></tr>)}</tbody></table>{!filtered.length && <div className="admin-empty">Qidiruv bo‘yicha user topilmadi.</div>}</div>{pageCount > 1 && <div className="admin-pagination"><button className="text-button" disabled={page === 1} onClick={() => setPage((current) => current - 1)}>Oldingi</button><span>{page} / {pageCount}</span><button className="text-button" disabled={page === pageCount} onClick={() => setPage((current) => current + 1)}>Keyingi</button></div>}</section>;
}
