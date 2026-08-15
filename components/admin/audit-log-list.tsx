import { History, ShieldCheck } from "lucide-react";
import { teamRoleLabel } from "@/lib/team-roles";

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
  if (!rows.length) return <div className="admin-empty">Hali audit yozuvlari yo‘q.</div>;
  return <div className="audit-list">{rows.map((row) => <article className="audit-row" key={row.id}><span className="audit-icon"><History size={17} /></span><div className="audit-copy"><strong>{actionLabels[row.action] ?? row.action}</strong><small>{row.actorEmail} · {auditDetail(row)}</small></div><span className="audit-time">{new Date(row.createdAt).toLocaleString("uz-UZ", { dateStyle: "medium", timeStyle: "short" })}</span><ShieldCheck className="audit-secure" size={15} /></article>)}</div>;
}
