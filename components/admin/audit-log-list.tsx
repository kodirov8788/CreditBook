"use client";

import { History, Search, ShieldCheck } from "lucide-react";
import { teamRoleLabel } from "@/lib/team-roles";
import { useMemo, useState } from "react";

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

export default function AuditLogList({ rows }: { rows: AuditRow[] }) {
  const [query, setQuery] = useState("");
  const [action, setAction] = useState("all");
  const actions = useMemo(() => [...new Set(rows.map((row) => row.action))], [rows]);
  const filtered = useMemo(() => rows.filter((row) => {
    const haystack = `${row.action} ${row.actorEmail} ${row.shopName ?? ""}`.toLowerCase();
    return (action === "all" || row.action === action) && (!query.trim() || haystack.includes(query.trim().toLowerCase()));
  }), [action, query, rows]);
  if (!rows.length) return <div className="admin-empty">Hali audit yozuvlari yo‘q.</div>;
  return <><div className="admin-filters"><label className="admin-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Actor yoki amal bo‘yicha qidirish" aria-label="Audit qidirish" /></label><select value={action} onChange={(event) => setAction(event.target.value)} aria-label="Audit amal filtri"><option value="all">Barcha amallar</option>{actions.map((item) => <option value={item} key={item}>{actionLabels[item] ?? item}</option>)}</select></div><div className="audit-list">{filtered.map((row) => <article className="audit-row" key={row.id}><span className="audit-icon"><History size={17} /></span><div className="audit-copy"><strong>{actionLabels[row.action] ?? row.action}</strong><small>{row.actorEmail} · {auditDetail(row)}</small></div><span className="audit-time">{new Date(row.createdAt).toLocaleString("uz-UZ", { dateStyle: "medium", timeStyle: "short" })}</span><ShieldCheck className="audit-secure" size={15} /></article>)}{!filtered.length && <div className="admin-empty">Filter bo‘yicha audit topilmadi.</div>}</div></>;
}
