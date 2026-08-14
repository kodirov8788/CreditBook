"use client";

import { useMemo, useState } from "react";
import { ArrowDownToLine, Bell, BookOpen, Check, CircleDollarSign, Clock3, LayoutDashboard, Plus, Search, Settings, UserRound, Users, X } from "lucide-react";
import { createClient, hasSupabaseEnv } from "@/lib/supabase/browser";
import type { DashboardCustomer, DashboardStats } from "@/lib/types";

const money = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const dateFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

function formatMoney(value: number) {
  return `${money.format(value)} UZS`;
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
      const newCustomer: DashboardCustomer = { id: `local-${Date.now()}`, name: form.name.trim(), phone: form.phone.trim() || "No phone added", balance: Number(form.amount) || 0, dueDate: form.dueDate || null, status: form.amount ? "on-track" : "paid", lastPayment: null };
      setCustomers((current) => [newCustomer, ...current]);
      setStats((current) => ({ ...current, activeCustomers: current.activeCustomers + 1, totalOutstanding: current.totalOutstanding + newCustomer.balance }));
    }

    setSaving(false);
    setModalOpen(false);
    setForm({ name: "", phone: "", amount: "", dueDate: "" });
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark">C</div><div className="brand-name">CreditBook</div></div>
        <nav className="nav-list" aria-label="Main navigation">
          <a className="nav-item active" href="#dashboard"><LayoutDashboard size={17} />Dashboard</a>
          <a className="nav-item" href="#customers"><Users size={17} />Customers</a>
          <a className="nav-item" href="#payments"><CircleDollarSign size={17} />Payments</a>
          <a className="nav-item" href="#reminders"><Bell size={17} />Reminders</a>
          <a className="nav-item" href="#reports"><ArrowDownToLine size={17} />Reports</a>
        </nav>
        <div className="sidebar-spacer" />
        <div className="shop-card"><div className="shop-label">Current shop</div><div className="shop-name">My neighborhood shop</div><div className="shop-owner">{userEmail ?? "Demo workspace"}</div></div>
      </aside>

      <main className="main-area">
        <header className="topbar"><div><div className="topbar-title">Tuesday, August 18, 2026</div><div className="topbar-subtitle">Keep every balance clear.</div></div><div className="user-chip"><span>{userEmail ?? "Demo mode"}</span><div className="avatar">{userEmail ? initials(userEmail) : "DB"}</div></div></header>
        <div className="page" id="dashboard">
          <div className="page-heading"><div><div className="eyebrow">Overview</div><h1>Good morning.</h1><div className="muted" style={{ marginTop: 10, fontSize: 13 }}>Here’s what is happening with your credit book.</div></div><button className="button button-primary" onClick={() => setModalOpen(true)}><Plus size={17} />Add customer</button></div>

          <section className="stats-grid" aria-label="Credit book totals">
            <StatCard label="Outstanding credit" value={formatMoney(stats.totalOutstanding)} icon={<CircleDollarSign size={16} />} foot="Across all active debts" />
            <StatCard label="Collected this month" value={formatMoney(stats.collectedThisMonth)} icon={<Check size={16} />} foot="12.4% more than last month" footClass="good" />
            <StatCard label="Overdue amount" value={formatMoney(stats.overdueAmount)} icon={<Clock3 size={16} />} foot="Needs your attention" footClass="warn" />
            <StatCard label="Active customers" value={String(stats.activeCustomers)} icon={<Users size={16} />} foot="With an outstanding balance" />
          </section>

          {!liveMode && <div className="setup-note"><strong>Demo preview:</strong> connect Supabase and run the schema to replace this sample data with your shop’s live records.</div>}

          <section className="content-grid" id="customers">
            <div className="panel"><div className="panel-heading"><div><div className="panel-title">Customer balances</div><div className="panel-subtitle">Your most recent outstanding accounts</div></div><button className="button button-ghost" aria-label="Customer settings"><Settings size={17} /></button></div><div className="search-wrap"><div style={{ position: "relative" }}><Search size={16} color="#6d7b73" style={{ position: "absolute", left: 12, top: 12 }} /><input className="search" style={{ paddingLeft: 37 }} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search customers..." /></div></div><div className="customer-list">{filteredCustomers.length ? filteredCustomers.map((customer) => <CustomerRow customer={customer} key={customer.id} />) : <div className="empty">No customers match your search.</div>}</div></div>
            <div className="panel" id="payments"><div className="panel-heading"><div><div className="panel-title">Recent activity</div><div className="panel-subtitle">Latest changes in your book</div></div><BookOpen size={17} color="#1e7a4f" /></div><div className="activity-list"><Activity text="Payment received from Jasur Abduqodirov" amount="450,000 UZS" time="Today, 09:42" /><Activity text="New credit added for Dilshod Karimov" amount="1,250,000 UZS" time="Aug 2, 15:10" /><Activity text="Reminder sent to Malika Tursunova" amount="Due Aug 12" time="Aug 1, 10:25" /></div></div>
          </section>
        </div>
      </main>

      {modalOpen && <div className="modal-backdrop" role="presentation"><div className="modal" role="dialog" aria-modal="true" aria-labelledby="add-customer-title"><div className="modal-heading"><div><div className="eyebrow">New account</div><h2 id="add-customer-title">Add customer</h2></div><button className="button button-ghost" onClick={() => setModalOpen(false)} aria-label="Close dialog"><X size={18} /></button></div><form onSubmit={addCustomer}><div className="field-grid"><div className="field full"><label htmlFor="name">Customer name *</label><input id="name" required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="e.g. Aziz Karimov" /></div><div className="field full"><label htmlFor="phone">Phone number</label><input id="phone" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="+998 90 000 00 00" /></div><div className="field"><label htmlFor="amount">Opening credit</label><input id="amount" type="number" min="0" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} placeholder="0" /></div><div className="field"><label htmlFor="dueDate">Due date</label><input id="dueDate" type="date" value={form.dueDate} onChange={(event) => setForm({ ...form, dueDate: event.target.value })} /></div></div><div className="modal-actions"><button type="button" className="button button-ghost" onClick={() => setModalOpen(false)}>Cancel</button><button type="submit" className="button button-primary" disabled={saving}>{saving ? "Saving..." : "Save customer"}</button></div></form></div></div>}
    </div>
  );
}

function StatCard({ label, value, icon, foot, footClass = "" }: { label: string; value: string; icon: React.ReactNode; foot: string; footClass?: string }) { return <div className="stat-card"><div className="stat-label"><span>{label}</span><span className="stat-icon">{icon}</span></div><div className="stat-value">{value}</div><div className={`stat-foot ${footClass}`}>{foot}</div></div>; }
function CustomerRow({ customer }: { customer: DashboardCustomer }) { return <div className="customer-row"><div><div className="customer-name">{customer.name}</div><div className="customer-phone">{customer.phone}</div></div><div><div className="row-label">Balance</div><div className="row-value balance">{formatMoney(customer.balance)}</div></div><div><div className="row-label">Due date</div><div className="row-value">{formatDate(customer.dueDate)}</div></div><div><div className="row-label">Status</div><div className={`status ${customer.status}`}>{customer.status === "due-soon" ? "Due soon" : customer.status === "on-track" ? "On track" : customer.status[0].toUpperCase() + customer.status.slice(1)}</div></div><button className="button button-ghost" aria-label={`Open ${customer.name}`}><UserRound size={16} /></button></div>; }
function Activity({ text, amount, time }: { text: string; amount: string; time: string }) { return <div className="activity-item"><div className="activity-dot" /><div><div className="activity-text">{text}<br /><strong>{amount}</strong></div><div className="activity-time">{time}</div></div></div>; }
