"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowLeft, MailPlus, ShieldCheck, UserRound } from "lucide-react";
import { TEAM_ROLE_LABELS, TEAM_ROLES } from "@/lib/team-roles";

type Member = { id: string; user_id: string; role: string; status: string; user?: { email?: string | null; fullName?: string | null } | null };
const roles = TEAM_ROLES;

export default function TeamManager({ shopName, initialMembers, currentUserId, canEditShopName }: { shopName: string; initialMembers: Member[]; currentUserId: string; canEditShopName: boolean }) {
  const [members, setMembers] = useState(initialMembers);
  const [shopNameValue, setShopNameValue] = useState(shopName);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("cashier");
  const [saving, setSaving] = useState(false);
  const [shopNameSaving, setShopNameSaving] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [shopNameMessage, setShopNameMessage] = useState("");

  async function saveShopName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setShopNameSaving(true); setShopNameMessage("");
    try {
      const response = await fetch("/api/shop", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: shopNameValue }) });
      const payload = await response.json().catch(() => null) as { shop?: { name?: string }; error?: string } | null;
      if (response.ok && payload?.shop?.name) {
        setShopNameValue(payload.shop.name);
        setShopNameMessage("Shop nomi saqlandi.");
      } else {
        setShopNameMessage(payload?.error || "Shop nomi saqlanmadi.");
      }
    } catch {
      setShopNameMessage("Ulanish xatosi. Qayta urinib ko‘ring.");
    } finally {
      setShopNameSaving(false);
    }
  }

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true); setMessage("");
    const response = await fetch("/api/team", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, role }) });
    const payload = await response.json().catch(() => null) as { member?: Member; error?: string } | null;
    if (response.ok && payload?.member) { setMembers((current) => [...current, payload.member!]); setEmail(""); setMessage("Taklif yuborildi."); } else setMessage(payload?.error || "Taklif yuborilmadi.");
    setSaving(false);
  }

  async function updateMember(id: string, changes: { role?: string; status?: string }) {
    setUpdatingId(id); setMessage("");
    const response = await fetch(`/api/team/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(changes) });
    const payload = await response.json().catch(() => null) as { member?: Member; error?: string } | null;
    if (!response.ok || !payload?.member) { setMessage(payload?.error || "O‘zgarish saqlanmadi."); setUpdatingId(null); return; }
    setMembers((current) => current.map((member) => member.id === id ? { ...member, ...payload.member } : member));
    setMessage("O‘zgarish saqlandi."); setUpdatingId(null);
  }

  return <main className="team-page"><header className="team-head"><div><Link className="team-back" href="/dashboard"><ArrowLeft size={15} />Bosh sahifa</Link><div className="eyebrow">Jamoa boshqaruvi</div><h1>{shopNameValue}</h1><p>Xodimlar kim nimalarga kira olishini boshqaring.</p></div><span className="team-secure"><ShieldCheck size={15} />Ruxsatlar himoyalangan</span></header>{canEditShopName && <section className="team-panel team-settings"><div className="team-panel-head"><div><div className="section-label">Shop sozlamalari</div><h2>Shop nomi</h2><p>Bu nom dashboard va platform boshqaruvida ko‘rinadi.</p></div></div><form onSubmit={saveShopName} className="team-settings-form"><input type="text" required minLength={2} maxLength={80} value={shopNameValue} onChange={(event) => setShopNameValue(event.target.value)} aria-label="Shop nomi" /><button className="button button-primary" disabled={shopNameSaving}>{shopNameSaving ? "Saqlanmoqda..." : "Nomni saqlash"}</button></form>{shopNameMessage && <p className="team-message" role="status">{shopNameMessage}</p>}</section>}<section className="team-invite"><div><div className="section-label">Yangi xodim</div><h2>Email orqali taklif qiling</h2><p>Taklif qabul qilingach, xodim avtomatik faol bo‘ladi.</p></div><form onSubmit={invite} className="team-invite-form"><input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="xodim@example.com" aria-label="Xodim emaili" /><select value={role} onChange={(event) => setRole(event.target.value)} aria-label="Boshlang‘ich rol">{roles.filter((item) => item !== "shop_owner").map((item) => <option value={item} key={item}>{TEAM_ROLE_LABELS[item]}</option>)}</select><button className="button button-primary" disabled={saving}><MailPlus size={16} />{saving ? "Yuborilmoqda..." : "Taklif yuborish"}</button></form>{message && <p className="team-message" role="status">{message}</p>}</section><section className="team-panel"><div className="team-panel-head"><div><h2>Jamoa a’zolari</h2><p>{members.length} ta a’zo · rollar va kirish holati</p></div></div><div className="team-list">{members.map((member) => { const busy = updatingId === member.id; return <article className="team-row" key={member.id}><span className="admin-avatar"><UserRound size={17} /></span><div className="team-user"><strong>{member.user?.fullName || member.user?.email || "Taklif qilingan user"}</strong><small>{member.user?.email ?? "Email hali tasdiqlanmagan"}</small></div><select value={member.role} onChange={(event) => void updateMember(member.id, { role: event.target.value })} disabled={member.user_id === currentUserId || busy} aria-label={`${member.user?.email ?? "A’zo"} roli`}>{roles.map((item) => <option key={item} value={item}>{TEAM_ROLE_LABELS[item]}</option>)}</select><span className={`admin-status ${member.status === "active" ? "active" : member.status === "suspended" ? "suspended" : "pending"}`}>{member.status === "active" ? "Faol" : member.status === "invited" ? "Taklif yuborilgan" : "To‘xtatilgan"}</span>{member.user_id !== currentUserId && <button className="text-button danger-text" onClick={() => void updateMember(member.id, { status: member.status === "suspended" ? "active" : "suspended" })} disabled={busy}>{busy ? "Saqlanmoqda..." : member.status === "suspended" ? "Faollashtirish" : member.status === "invited" ? "Bekor qilish" : "To‘xtatish"}</button>}</article>; })}</div></section></main>;
}
