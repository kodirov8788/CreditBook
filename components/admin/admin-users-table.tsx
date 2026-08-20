"use client";

import Link from "next/link";
import { ArrowRight, Search, UserRound } from "lucide-react";
import { teamRoleLabel } from "@/lib/team-roles";

type AdminUserRow = { id: string; email: string; name: string; shop: string; role: string; memberStatus: string; banned: boolean };

export default function AdminUsersTable({ users, totalCount, page, pageCount, query }: { users: AdminUserRow[]; totalCount: number; page: number; pageCount: number; query: string }) {
  function pageHref(nextPage: number) {
    const params = new URLSearchParams({ page: String(nextPage) });
    if (query) params.set("q", query);
    return `/admin/users?${params.toString()}`;
  }

  return <section className="admin-panel"><div className="admin-panel-head"><div><h2>{totalCount} ta account</h2><p>Foydalanuvchi ma’lumotlari serverda qidiriladi va sahifalanadi.</p></div><form className="admin-search" action="/admin/users" method="get"><Search size={16} /><input defaultValue={query} name="q" placeholder="Email yoki ism bo‘yicha qidirish" aria-label="Foydalanuvchi qidirish" /><button className="text-button" type="submit">Qidirish</button></form></div><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Foydalanuvchi</th><th>Shop</th><th>Rol</th><th>Holat</th><th /></tr></thead><tbody>{users.map((user) => <tr key={user.id}><td><span className="admin-user"><span className="admin-avatar"><UserRound size={16} /></span><span><strong>{user.name}</strong><small>{user.email}</small></span></span></td><td>{user.shop}</td><td><span className="role-badge">{teamRoleLabel(user.role)}</span></td><td><span className={`admin-status ${user.banned || user.memberStatus === "suspended" ? "suspended" : "active"}`}>{user.banned || user.memberStatus === "suspended" ? "Bloklangan" : "Faol"}</span></td><td><Link className="icon-button" href={`/admin/users/${user.id}`} aria-label={`${user.email} tafsilotlari`}><ArrowRight size={17} /></Link></td></tr>)}</tbody></table>{!users.length && <div className="admin-empty">Qidiruv bo‘yicha user topilmadi.</div>}</div>{pageCount > 1 && <div className="admin-pagination"><Link className="text-button" aria-disabled={page === 1} href={page === 1 ? "#" : pageHref(page - 1)}>Oldingi</Link><span>{page} / {pageCount}</span><Link className="text-button" aria-disabled={page === pageCount} href={page === pageCount ? "#" : pageHref(page + 1)}>Keyingi</Link></div>}</section>;
}
