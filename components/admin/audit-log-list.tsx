"use client";

import { History, Search, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { teamRoleLabel } from "@/lib/team-roles";
import { useMemo } from "react";

export type AuditRow = {
  id: string;
  action: string;
  entityType: string;
  createdAt: string;
  actorEmail: string;
  shopName: string | null;
  metadata: Record<string, unknown>;
};

const actionLabels: Record<string, string> = {
  "user.suspended": "Account to‘xtatildi",
  "user.reactivated": "Account faollashtirildi",
  "shop.suspended": "Shop to‘xtatildi",
  "shop.reactivated": "Shop faollashtirildi",
  "membership.invited": "Jamoaga taklif yuborildi",
  "membership.role_changed": "A’zo roli o‘zgartirildi",
  "membership.updated": "A’zo holati o‘zgartirildi",
};

function auditDetail(row: AuditRow) {
  const role = typeof row.metadata.role === "string" ? teamRoleLabel(row.metadata.role) : null;
  const status = typeof row.metadata.status === "string" ? row.metadata.status : null;
  if (role) return `Yangi rol: ${role}`;
  if (status === "suspended") return "Holat: To‘xtatilgan";
  if (status === "active") return "Holat: Faol";
  const after = row.metadata.after as { status?: string } | undefined;
  if (after?.status === "suspended") return "Holat: To‘xtatilgan";
  if (after?.status === "active") return "Holat: Faol";
  return row.shopName ? `Shop: ${row.shopName}` : "Platform nazorati";
}

export default function AuditLogList({ rows, totalCount, page, pageCount, query, action }: { rows: AuditRow[]; totalCount: number; page: number; pageCount: number; query: string; action: string }) {
  const actions = useMemo(() => [...new Set([...rows.map((row) => row.action), ...(action ? [action] : [])])], [action, rows]);
  function pageHref(nextPage: number) {
    const params = new URLSearchParams({ page: String(nextPage) });
    if (query) params.set("q", query);
    if (action) params.set("action", action);
    return `/admin/audit?${params.toString()}`;
  }

  return <><form className="admin-filters" action="/admin/audit" method="get"><label className="admin-search"><Search size={16} /><input defaultValue={query} name="q" placeholder="Amal yoki tur bo‘yicha qidirish" aria-label="Audit qidirish" /></label><select defaultValue={action || "all"} name="action" aria-label="Audit amal filtri"><option value="all">Barcha amallar</option>{actions.map((item) => <option value={item} key={item}>{actionLabels[item] ?? item}</option>)}</select><button className="text-button" type="submit">Qidirish</button></form><div className="audit-list">{rows.length ? rows.map((row) => <article className="audit-row" key={row.id}><span className="audit-icon"><History size={17} /></span><div className="audit-copy"><strong>{actionLabels[row.action] ?? row.action}</strong><small>{row.actorEmail} · {auditDetail(row)}</small></div><span className="audit-time">{new Date(row.createdAt).toLocaleString("uz-UZ", { dateStyle: "medium", timeStyle: "short" })}</span><ShieldCheck className="audit-secure" size={15} /></article>) : <div className="admin-empty">{totalCount ? "Filter bo‘yicha audit topilmadi." : "Hali audit yozuvlari yo‘q."}</div>}</div>{pageCount > 1 && <div className="admin-pagination"><Link className="text-button" aria-disabled={page === 1} href={page === 1 ? "#" : pageHref(page - 1)}>Oldingi</Link><span>{page} / {pageCount} · {totalCount} ta</span><Link className="text-button" aria-disabled={page === pageCount} href={page === pageCount ? "#" : pageHref(page + 1)}>Keyingi</Link></div>}</>;
}
