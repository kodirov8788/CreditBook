"use client";
/* Uzbek Latin text intentionally uses apostrophes in visible labels. */
/* eslint-disable react/no-unescaped-entities */

import { useMemo, useState } from "react";
import { ArrowDownToLine, Bell, BookOpen, Check, CircleDollarSign, Clock3, Ellipsis, LayoutDashboard, Plus, Search, Settings, Users, X } from "lucide-react";
import { createClient, hasSupabaseEnv } from "@/lib/supabase/browser";
import type { DashboardCustomer, DashboardStats } from "@/lib/types";

const money = new Intl.NumberFormat("uz-UZ", { maximumFractionDigits: 0 });
const dateFormatter = new Intl.DateTimeFormat("uz-UZ", { month: "short", day: "numeric" });
const statusLabels = { overdue: "Kechikkan", "due-soon": "Yaqin", "on-track": "Vaqtida", paid: "Yopilgan" } as const;
type QuickAction = "credit" | "payment" | "edit";

function formatMoney(value: number) {
  return `${money.format(value)} so'm`;
}

function formatDate(value: string | null) {
  if (!value) return "Not set";
  return dateFormatter.format(new Date(`${value}T12:00:00`));
}

function initials(value: string) {
  return value.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

export default function Dashboard({ initialCustomers, initialStats, userEmail, liveMode }: { initialCustomers: DashboardCustomer[]; initialStats: DashboardStats; userEmail: string | null; liveMode: boolean }) {
  const [customers, setCustomers] = useState(initialCustomers);
  const [stats, setStats] = useState(initialStats);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", amount: "", dueDate: "" });
  const [quickAction, setQuickAction] = useState<{ type: QuickAction; customer: DashboardCustomer } | null>(null);
  const [quickForm, setQuickForm] = useState({ name: "", phone: "", amount: "", dueDate: "", note: "" });
  const [quickError, setQuickError] = useState("");
  const supabase = hasSupabaseEnv() ? createClient() : null;

  const filteredCustomers = useMemo(() => customers.filter((customer) => `${customer.name} ${customer.phone}`.toLowerCase().includes(search.toLowerCase())), [customers, search]);

  async function addCustomer(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);

    if (supabase && liveMode) {
      const { data: customer, error } = await supabase.from("customers").insert({ name: form.name.trim(), phone: form.phone.trim() || null }).select("id, name, phone").single();
      if (!error && customer) {
        if (Number(form.amount) > 0) await supabase.from("debts").insert({ customer_id: customer.id, principal: Number(form.amount), due_date: form.dueDate || null, title: "Opening credit" });
      }
    } else {
      const newCustomer: DashboardCustomer = { id: `local-${Date.now()}`, name: form.name.trim(), phone: form.phone.trim() || "Telefon yo'q", balance: Number(form.amount) || 0, dueDate: form.dueDate || null, status: form.amount ? "on-track" : "paid", lastPayment: null };
      setCustomers((current) => [newCustomer, ...current]);
      setStats((current) => ({ ...current, activeCustomers: current.activeCustomers + 1, totalOutstanding: current.totalOutstanding + newCustomer.balance }));
    }

    setSaving(false);
    setModalOpen(false);
    setForm({ name: "", phone: "", amount: "", dueDate: "" });
  }

  function openQuickAction(type: QuickAction, customer: DashboardCustomer) {
    setQuickAction({ type, customer });
    setQuickError("");
    setQuickForm({ name: customer.name, phone: customer.phone === "Telefon yo'q" ? "" : customer.phone, amount: type === "payment" ? String(customer.balance) : "", dueDate: customer.dueDate ?? "", note: "" });
  }

  function closeQuickAction() {
    setQuickAction(null);
    setQuickError("");
  }

  async function submitQuickAction(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!quickAction) return;
    const { type, customer } = quickAction;
    const amount = Number(quickForm.amount);
    setSaving(true);
    setQuickError("");

    if (type === "edit") {
      if (!quickForm.name.trim()) { setQuickError("Ismni kiriting."); setSaving(false); return; }
      if (supabase && liveMode) {
        const { error } = await supabase.from("customers").update({ name: quickForm.name.trim(), phone: quickForm.phone.trim() || null }).eq("id", customer.id);
        if (error) { setQuickError("Saqlab bo'lmadi."); setSaving(false); return; }
      }
      setCustomers((current) => current.map((item) => item.id === customer.id ? { ...item, name: quickForm.name.trim(), phone: quickForm.phone.trim() || "Telefon yo'q" } : item));
    }

    if (type === "credit") {
      if (!Number.isFinite(amount) || amount <= 0) { setQuickError("Summani kiriting."); setSaving(false); return; }
      if (supabase && liveMode) {
        const { error } = await supabase.from("debts").insert({ customer_id: customer.id, principal: amount, due_date: quickForm.dueDate || null, title: quickForm.note.trim() || "Qarz" });
        if (error) { setQuickError("Qarz yozilmadi."); setSaving(false); return; }
      }
      setCustomers((current) => current.map((item) => item.id === customer.id ? { ...item, balance: item.balance + amount, dueDate: quickForm.dueDate || item.dueDate, status: "on-track" } : item));
      setStats((current) => ({ ...current, totalOutstanding: current.totalOutstanding + amount, activeCustomers: current.activeCustomers + (customer.balance === 0 ? 1 : 0) }));
    }

    if (type === "payment") {
      if (!Number.isFinite(amount) || amount <= 0 || amount > customer.balance) { setQuickError("To'lov qoldiqdan oshmasin."); setSaving(false); return; }
      if (supabase && liveMode) {
        const { data: debts, error: debtError } = await supabase.from("debts").select("id, principal, payments(amount)").eq("customer_id", customer.id).eq("status", "open").order("created_at", { ascending: true });
        if (debtError) { setQuickError("Qarzlar olinmadi."); setSaving(false); return; }
        let left = amount;
        for (const debt of (debts ?? []) as Array<{ id: string; principal: number; payments: Array<{ amount: number }> }>) {
          if (left <= 0) break;
          const paid = debt.payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
          const open = Math.max(Number(debt.principal) - paid, 0);
          const part = Math.min(left, open);
          if (part > 0) {
            await supabase.from("payments").insert({ customer_id: customer.id, debt_id: debt.id, amount: part, note: quickForm.note.trim() || null });
            if (part >= open) await supabase.from("debts").update({ status: "paid" }).eq("id", debt.id);
            left -= part;
          }
        }
      }
      setCustomers((current) => current.map((item) => item.id === customer.id ? { ...item, balance: item.balance - amount, status: item.balance - amount <= 0 ? "paid" : item.status } : item));
      setStats((current) => ({ ...current, totalOutstanding: Math.max(current.totalOutstanding - amount, 0), collectedThisMonth: current.collectedThisMonth + amount, activeCustomers: customer.balance - amount <= 0 ? Math.max(current.activeCustomers - 1, 0) : current.activeCustomers }));
    }

    setSaving(false);
    closeQuickAction();
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark">C</div><div className="brand-name">CreditBook</div></div>
        <nav className="nav-list" aria-label="Asosiy menyu">
          <a className="nav-item active" href="#dashboard"><LayoutDashboard size={17} />Bosh sahifa</a>
          <a className="nav-item" href="#customers"><Users size={17} />Mijozlar</a>
          <a className="nav-item" href="#payments"><CircleDollarSign size={17} />To'lovlar</a>
          <a className="nav-item" href="#reminders"><Bell size={17} />Eslatmalar</a>
          <a className="nav-item" href="#reports"><ArrowDownToLine size={17} />Hisobot</a>
        </nav>
        <div className="sidebar-spacer" />
        <div className="shop-card"><div className="shop-label">Do'kon</div><div className="shop-name">Mahalla do'koni</div><div className="shop-owner">{userEmail ?? "Sinov rejimi"}</div></div>
      </aside>

      <main className="main-area">
        <header className="topbar"><div><div className="topbar-title">18-avgust, seshanba</div><div className="topbar-subtitle">Qarzlarni oson nazorat qiling.</div></div><div className="user-chip"><span>{userEmail ?? "Sinov rejimi"}</span><div className="avatar">{userEmail ? initials(userEmail) : "SR"}</div></div></header>
        <div className="page" id="dashboard">
          <div className="page-heading"><div><div className="eyebrow">Umumiy</div><h1>Xayrli tong.</h1><div className="muted" style={{ marginTop: 10, fontSize: 13 }}>Bugungi qarzlar holati.</div></div><button className="button button-primary" onClick={() => setModalOpen(true)}><Plus size={17} />Mijoz qo'shish</button></div>

          <section className="stats-grid" aria-label="Credit book totals">
            <StatCard label="Jami qarz" value={formatMoney(stats.totalOutstanding)} icon={<CircleDollarSign size={16} />} foot="Barcha faol qarzlar" />
            <StatCard label="Bu oy to'lov" value={formatMoney(stats.collectedThisMonth)} icon={<Check size={16} />} foot="O'tgan oydan 12,4% ko'p" footClass="good" />
            <StatCard label="Kechikkan" value={formatMoney(stats.overdueAmount)} icon={<Clock3 size={16} />} foot="E'tibor kerak" footClass="warn" />
            <StatCard label="Faol mijoz" value={String(stats.activeCustomers)} icon={<Users size={16} />} foot="Qoldig'i bor mijozlar" />
          </section>

          {!liveMode && <div className="setup-note"><strong>Sinov ko'rinishi:</strong> haqiqiy ma'lumotlar uchun Supabase sxemasini ishga tushiring.</div>}

          <section className="content-grid" id="customers">
            <div className="panel"><div className="panel-heading"><div><div className="panel-title">Mijozlar</div><div className="panel-subtitle">Qarz qoldig'i bor mijozlar</div></div><button className="button button-ghost" aria-label="Sozlamalar"><Settings size={17} /></button></div><div className="search-wrap"><div style={{ position: "relative" }}><Search size={16} color="#6d7b73" style={{ position: "absolute", left: 12, top: 12 }} /><input className="search" style={{ paddingLeft: 37 }} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Mijoz izlash..." /></div></div><div className="customer-list">{filteredCustomers.length ? filteredCustomers.map((customer) => <CustomerRow customer={customer} key={customer.id} onAction={openQuickAction} />) : <div className="empty">Mijoz topilmadi.</div>}</div></div>
            <div className="panel" id="payments"><div className="panel-heading"><div><div className="panel-title">So'nggi ishlar</div><div className="panel-subtitle">Daftardagi so'nggi o'zgarishlar</div></div><BookOpen size={17} color="#1e7a4f" /></div><div className="activity-list"><Activity text="Jasur Abduqodirovdan to'lov olindi" amount="450 000 so'm" time="Bugun, 09:42" /><Activity text="Dilshod Karimovga qarz yozildi" amount="1 250 000 so'm" time="2-avgust, 15:10" /><Activity text="Malika Tursunovaga eslatma yuborildi" amount="Muddat: 12-avgust" time="1-avgust, 10:25" /></div></div>
          </section>
        </div>
      </main>

      {modalOpen && <div className="modal-backdrop" role="presentation"><div className="modal" role="dialog" aria-modal="true" aria-labelledby="add-customer-title"><div className="modal-heading"><div><div className="eyebrow">Yangi yozuv</div><h2 id="add-customer-title">Mijoz qo'shish</h2></div><button className="button button-ghost" onClick={() => setModalOpen(false)} aria-label="Yopish"><X size={18} /></button></div><form onSubmit={addCustomer}><div className="field-grid"><div className="field full"><label htmlFor="name">Mijoz ismi *</label><input id="name" required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Masalan: Aziz Karimov" /></div><div className="field full"><label htmlFor="phone">Telefon</label><input id="phone" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="+998 90 000 00 00" /></div><div className="field"><label htmlFor="amount">Qarz</label><input id="amount" type="number" min="0" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} placeholder="0" /></div><div className="field"><label htmlFor="dueDate">Muddat</label><input id="dueDate" type="date" value={form.dueDate} onChange={(event) => setForm({ ...form, dueDate: event.target.value })} /></div></div><div className="modal-actions"><button type="button" className="button button-ghost" onClick={() => setModalOpen(false)}>Bekor</button><button type="submit" className="button button-primary" disabled={saving}>{saving ? "Saqlanmoqda..." : "Saqlash"}</button></div></form></div></div>}
      {quickAction && <div className="modal-backdrop" role="presentation"><div className="modal" role="dialog" aria-modal="true" aria-labelledby="quick-action-title"><div className="modal-heading"><div><div className="eyebrow">{quickAction.customer.name}</div><h2 id="quick-action-title">{quickAction.type === "credit" ? "Yangi qarz" : quickAction.type === "payment" ? "To'lov" : "Tahrir"}</h2></div><button className="button button-ghost" onClick={closeQuickAction} aria-label="Yopish"><X size={18} /></button></div><form onSubmit={submitQuickAction}><div className="field-grid">{quickAction.type === "edit" ? <><div className="field full"><label htmlFor="quick-name">Mijoz ismi</label><input id="quick-name" required value={quickForm.name} onChange={(event) => setQuickForm({ ...quickForm, name: event.target.value })} /></div><div className="field full"><label htmlFor="quick-phone">Telefon</label><input id="quick-phone" value={quickForm.phone} onChange={(event) => setQuickForm({ ...quickForm, phone: event.target.value })} /></div></> : <><div className="field full"><label htmlFor="quick-amount">{quickAction.type === "payment" ? `Qoldiq: ${formatMoney(quickAction.customer.balance)}` : "Summa"}</label><input id="quick-amount" type="number" min="0" max={quickAction.type === "payment" ? quickAction.customer.balance : undefined} required value={quickForm.amount} onChange={(event) => setQuickForm({ ...quickForm, amount: event.target.value })} /></div>{quickAction.type === "credit" && <div className="field"><label htmlFor="quick-due">Muddat</label><input id="quick-due" type="date" value={quickForm.dueDate} onChange={(event) => setQuickForm({ ...quickForm, dueDate: event.target.value })} /></div>}<div className="field full"><label htmlFor="quick-note">Izoh</label><input id="quick-note" value={quickForm.note} onChange={(event) => setQuickForm({ ...quickForm, note: event.target.value })} placeholder="Ixtiyoriy" /></div></>}</div>{quickError && <div className="setup-note">{quickError}</div>}<div className="modal-actions"><button type="button" className="button button-ghost" onClick={closeQuickAction}>Bekor</button><button type="submit" className="button button-primary" disabled={saving}>{saving ? "Saqlanmoqda..." : "Saqlash"}</button></div></form></div></div>}
    </div>
  );
}

function StatCard({ label, value, icon, foot, footClass = "" }: { label: string; value: string; icon: React.ReactNode; foot: string; footClass?: string }) { return <div className="stat-card"><div className="stat-label"><span>{label}</span><span className="stat-icon">{icon}</span></div><div className="stat-value">{value}</div><div className={`stat-foot ${footClass}`}>{foot}</div></div>; }
function CustomerRow({ customer, onAction }: { customer: DashboardCustomer; onAction: (type: QuickAction, customer: DashboardCustomer) => void }) { return <div className="customer-row"><div><div className="customer-name">{customer.name}</div><div className="customer-phone">{customer.phone}</div></div><div><div className="row-label">Qoldiq</div><div className="row-value balance">{formatMoney(customer.balance)}</div></div><div><div className="row-label">Muddat</div><div className="row-value">{formatDate(customer.dueDate)}</div></div><div><div className="row-label">Holat</div><div className={`status ${customer.status}`}>{statusLabels[customer.status]}</div></div><div className="quick-actions"><button className="button button-secondary quick-action" onClick={() => onAction("credit", customer)} aria-label={`${customer.name}ga qarz qo'shish`}>+ Qarz</button><button className="button button-primary quick-action" onClick={() => onAction("payment", customer)} aria-label={`${customer.name}dan to'lov olish`}>- To'lov</button><button className="button button-ghost quick-action" onClick={() => onAction("edit", customer)} aria-label={`${customer.name}ni tahrirlash`}><Ellipsis size={16} /></button></div></div>; }
function Activity({ text, amount, time }: { text: string; amount: string; time: string }) { return <div className="activity-item"><div className="activity-dot" /><div><div className="activity-text">{text}<br /><strong>{amount}</strong></div><div className="activity-time">{time}</div></div></div>; }
