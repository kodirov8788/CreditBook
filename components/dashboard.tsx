"use client";
/* Uzbek Latin text intentionally uses apostrophes in visible labels. */
/* eslint-disable react/no-unescaped-entities */

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDownToLine,
  Bell,
  BookOpen,
  CalendarDays,
  Check,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Ellipsis,
  LayoutDashboard,
  LogOut,
  Plus,
  Search,
  Users,
  WalletCards,
  X,
} from "lucide-react";
import { createClient, hasSupabaseEnv } from "@/lib/supabase/browser";
import { getCustomerStatus } from "@/lib/customer-status";
import type { DashboardCustomer, DashboardStats } from "@/lib/types";

const money = new Intl.NumberFormat("uz-UZ", { maximumFractionDigits: 0 });
const dateFormatter = new Intl.DateTimeFormat("uz-UZ", { month: "short", day: "numeric" });
const fullDateFormatter = new Intl.DateTimeFormat("uz-UZ", { weekday: "long", month: "long", day: "numeric" });
const statusLabels = { overdue: "Kechikkan", "due-soon": "Yaqin", "on-track": "Vaqtida", paid: "Yopilgan" } as const;
type QuickAction = "credit" | "payment" | "edit";
type EntryType = "credit" | "payment";
type HistoryFilter = "all" | "credit" | "payment";
type HistoryCredit = { id: string; title: string | null; principal: number; due_date: string | null; status: string; created_at: string };
type HistoryPayment = { id: string; debt_id: string; amount: number; paid_at: string | null; note: string | null; created_at: string };
type HistoryTransaction = { id: string; type: "credit" | "payment"; amount: number; description: string; occurredAt: string; dueDate: string | null; status: string | null; balanceAfter: number };
type ActivityItem = { id: string; customer_id: string | null; event_type: string; description: string; created_at: string };
type Notice = { tone: "success" | "info"; text: string } | null;

function formatMoney(value: number) {
  return `${money.format(value)} so'm`;
}

function formatDate(value: string | null) {
  if (!value) return "Muddat yo'q";
  return dateFormatter.format(new Date(`${value}T12:00:00`));
}

function formatHistoryDate(value: string) {
  const date = new Date(value.includes("T") ? value : `${value}T12:00:00`);
  return new Intl.DateTimeFormat("uz-UZ", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}

function formatHistoryGroup(value: string) {
  const date = new Date(value.includes("T") ? value : `${value}T12:00:00`);
  return new Intl.DateTimeFormat("uz-UZ", { day: "numeric", month: "long", year: "numeric" }).format(date);
}

function normalizeHistory(credits: HistoryCredit[], payments: HistoryPayment[]) {
  const raw: HistoryTransaction[] = [
    ...credits.map((credit) => ({ id: credit.id, type: "credit" as const, amount: Number(credit.principal), description: credit.title?.trim() || "Qarz", occurredAt: credit.created_at, dueDate: credit.due_date, status: credit.status, balanceAfter: 0 })),
    ...payments.map((payment) => ({ id: payment.id, type: "payment" as const, amount: Number(payment.amount), description: payment.note?.trim() || "To'lov", occurredAt: payment.paid_at ?? payment.created_at, dueDate: null, status: null, balanceAfter: 0 })),
  ].filter((transaction) => Number.isFinite(transaction.amount) && transaction.amount > 0).sort((left, right) => new Date(left.occurredAt).getTime() - new Date(right.occurredAt).getTime());

  let balance = 0;
  return raw.map((transaction) => {
    balance = Math.max(balance + (transaction.type === "credit" ? transaction.amount : -transaction.amount), 0);
    return { ...transaction, balanceAfter: balance };
  }).reverse();
}

function formatToday() {
  return fullDateFormatter.format(new Date());
}

function initials(value: string) {
  return value.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

export default function Dashboard({ initialCustomers, initialStats, initialActivities, userEmail, shopName = "Mahalla do'koni", liveMode, initialError = "" }: { initialCustomers: DashboardCustomer[]; initialStats: DashboardStats; initialActivities: ActivityItem[]; userEmail: string | null; shopName?: string; liveMode: boolean; initialError?: string }) {
  const [customers, setCustomers] = useState(initialCustomers);
  const [stats, setStats] = useState(initialStats);
  const [activities, setActivities] = useState(initialActivities);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [actionSheetOpen, setActionSheetOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", amount: "", dueDate: "" });
  const [formError, setFormError] = useState("");
  const [quickAction, setQuickAction] = useState<{ type: QuickAction; customer: DashboardCustomer } | null>(null);
  const [quickForm, setQuickForm] = useState({ name: "", phone: "", amount: "", dueDate: "", note: "" });
  const [quickError, setQuickError] = useState("");
  const [entryType, setEntryType] = useState<EntryType | null>(null);
  const [entryForm, setEntryForm] = useState({ customerId: "", amount: "", dueDate: "", note: "" });
  const [entryCustomerQuery, setEntryCustomerQuery] = useState("");
  const [entryError, setEntryError] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [historyCustomerId, setHistoryCustomerId] = useState<string | null>(null);
  const [historyTransactions, setHistoryTransactions] = useState<HistoryTransaction[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>("all");
  const [historySearch, setHistorySearch] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [activeSection, setActiveSection] = useState("dashboard");
  const supabase = hasSupabaseEnv() ? createClient() : null;
  const router = useRouter();

  useEffect(() => {
    function syncActiveSection() {
      setActiveSection(window.location.hash.replace(/^#/, "") || "dashboard");
    }

    syncActiveSection();
    window.addEventListener("hashchange", syncActiveSection);
    return () => window.removeEventListener("hashchange", syncActiveSection);
  }, []);

  const filteredCustomers = useMemo(() => customers.filter((customer) => `${customer.name} ${customer.phone}`.toLowerCase().includes(search.toLowerCase())), [customers, search]);
  const entryOptions = useMemo(() => {
    const query = entryCustomerQuery.toLowerCase().trim();
    return customers.filter((customer) => !query || `${customer.name} ${customer.phone}`.toLowerCase().includes(query)).slice(0, 5);
  }, [customers, entryCustomerQuery]);
  const entryCustomer = entryForm.customerId ? customers.find((customer) => customer.id === entryForm.customerId) ?? null : null;
  const selectedCustomer = selectedCustomerId ? customers.find((customer) => customer.id === selectedCustomerId) ?? null : null;
  const historyCustomer = historyCustomerId ? customers.find((customer) => customer.id === historyCustomerId) ?? null : null;
  const filteredHistory = useMemo(() => {
    const query = historySearch.trim().toLowerCase();
    return historyTransactions.filter((transaction) => {
      const matchesType = historyFilter === "all" || transaction.type === historyFilter;
      const matchesSearch = !query || `${transaction.description} ${transaction.type === "credit" ? "qarz" : "to'lov"} ${formatHistoryDate(transaction.occurredAt)}`.toLowerCase().includes(query);
      return matchesType && matchesSearch;
    });
  }, [historyFilter, historySearch, historyTransactions]);
  const historyGroups = useMemo(() => {
    const groups: Array<{ key: string; label: string; transactions: HistoryTransaction[] }> = [];
    for (const transaction of filteredHistory) {
      const key = transaction.occurredAt.slice(0, 10);
      const group = groups.find((item) => item.key === key);
      if (group) group.transactions.push(transaction);
      else groups.push({ key, label: formatHistoryGroup(transaction.occurredAt), transactions: [transaction] });
    }
    return groups;
  }, [filteredHistory]);

  async function loadCustomerHistory(customer: DashboardCustomer) {
    setHistoryCustomerId(customer.id);
    setHistoryLoading(true);
    setHistoryError("");

    if (!liveMode) {
      setHistoryTransactions([]);
      setHistoryError("Supabase ulanishi sozlanmagan.");
      setHistoryLoading(false);
      return;
    }

    if (!supabase) {
      setHistoryTransactions([]);
      setHistoryError("Tarixni ko'rish uchun ulanish kerak.");
      setHistoryLoading(false);
      return;
    }

    const [{ data: credits, error: creditError }, { data: payments, error: paymentError }] = await Promise.all([
      supabase.from("debts").select("id, title, principal, due_date, status, created_at").eq("customer_id", customer.id).order("created_at", { ascending: false }),
      supabase.from("payments").select("id, debt_id, amount, paid_at, note, created_at").eq("customer_id", customer.id).order("paid_at", { ascending: false }),
    ]);

    if (creditError || paymentError) {
      setHistoryTransactions([]);
      setHistoryError("Tarix olinmadi. Qayta urinib ko'ring.");
    } else {
      setHistoryTransactions(normalizeHistory((credits ?? []) as HistoryCredit[], (payments ?? []) as HistoryPayment[]));
    }
    setHistoryLoading(false);
  }

  function openCustomerDetails(customer: DashboardCustomer) {
    setSelectedCustomerId(customer.id);
    setHistoryFilter("all");
    setHistorySearch("");
    void loadCustomerHistory(customer);
  }

  function openFullHistory(customer: DashboardCustomer) {
    setSelectedCustomerId(null);
    setHistoryCustomerId(customer.id);
    setHistoryFilter("all");
    setHistorySearch("");
    setHistoryOpen(true);
    if (historyCustomerId !== customer.id) void loadCustomerHistory(customer);
  }

  function closeHistory() {
    setHistoryOpen(false);
    setHistoryFilter("all");
    setHistorySearch("");
  }

  async function handleLogout() {
    setSigningOut(true);
    if (supabase) {
      const { error } = await supabase.auth.signOut();
      if (error) {
        setSigningOut(false);
        setNotice({ tone: "info", text: "Chiqish amalga oshmadi. Qayta urinib ko'ring." });
        return;
      }
    }
    router.push("/login");
  }

  async function recordActivity(customerId: string | null, eventType: string, description: string) {
    const localActivity: ActivityItem = { id: `local-${Date.now()}-${Math.random()}`, customer_id: customerId, event_type: eventType, description, created_at: new Date().toISOString() };
    if (supabase && liveMode) {
      const { data, error } = await supabase.from("activity_logs").insert({ customer_id: customerId, event_type: eventType, description }).select("id, customer_id, event_type, description, created_at").single();
      if (!error && data) {
        setActivities((current) => [data as ActivityItem, ...current].slice(0, 10));
        return;
      }
    }
    setActivities((current) => [localActivity, ...current].slice(0, 10));
  }

  function closeAddCustomer() {
    setModalOpen(false);
    setFormError("");
    setForm({ name: "", phone: "", amount: "", dueDate: "" });
  }

  function openAddCustomer() {
    setActionSheetOpen(false);
    setMoreOpen(false);
    setFormError("");
    setModalOpen(true);
  }

  async function addCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = form.name.trim();
    const openingAmount = Number(form.amount);
    if (!name) {
      setFormError("Mijoz ismini kiriting.");
      return;
    }
    if (!Number.isFinite(openingAmount) || openingAmount < 0) {
      setFormError("Qarz summasini tekshiring.");
      return;
    }

    setSaving(true);
    setFormError("");
    try {
      let newCustomer: DashboardCustomer;
      if (supabase && liveMode) {
        const response = await fetch("/api/customers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, phone: form.phone.trim() || null, amount: openingAmount, dueDate: form.dueDate || null }) });
        const payload = await response.json().catch(() => null) as { customer?: { id: string; name: string; phone: string | null }; error?: string } | null;
        const customer = payload?.customer;
        if (!response.ok || !customer) {
          setFormError("Mijoz saqlanmadi. Qayta urinib ko'ring.");
          return;
        }
        newCustomer = { id: customer.id, name: customer.name, phone: customer.phone ?? "Telefon yo'q", balance: openingAmount, dueDate: openingAmount > 0 ? form.dueDate || null : null, status: getCustomerStatus(openingAmount, openingAmount > 0 ? form.dueDate || null : null), lastPayment: null };
      } else {
        newCustomer = { id: `local-${Date.now()}`, name, phone: form.phone.trim() || "Telefon yo'q", balance: openingAmount, dueDate: form.dueDate || null, status: getCustomerStatus(openingAmount, form.dueDate || null), lastPayment: null };
      }

      setCustomers((current) => [newCustomer, ...current]);
      setStats((current) => ({ ...current, activeCustomers: current.activeCustomers + (newCustomer.balance > 0 ? 1 : 0), totalOutstanding: current.totalOutstanding + newCustomer.balance, overdueAmount: current.overdueAmount + (newCustomer.status === "overdue" ? newCustomer.balance : 0) }));
      void recordActivity(newCustomer.id, "customer", `${newCustomer.name} qo'shildi.`);
      if (newCustomer.balance > 0) void recordActivity(newCustomer.id, "credit", `${newCustomer.name}ga ${formatMoney(newCustomer.balance)} qarz yozildi.`);
      setNotice({ tone: "success", text: "Mijoz saqlandi." });
      closeAddCustomer();
    } finally {
      setSaving(false);
    }
  }

  function openQuickAction(type: QuickAction, customer: DashboardCustomer) {
    setSelectedCustomerId(null);
    setQuickAction({ type, customer });
    setQuickError("");
    setQuickForm({ name: customer.name, phone: customer.phone === "Telefon yo'q" ? "" : customer.phone, amount: "", dueDate: customer.dueDate ?? "", note: "" });
  }

  function closeQuickAction() {
    setQuickAction(null);
    setQuickError("");
  }

  async function recordPayment(customer: DashboardCustomer, amount: number, note: string) {
    if (!liveMode) return null;
    const response = await fetch(`/api/customers/${customer.id}/payments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ amount, note: note.trim() || null }) });
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    return response.ok ? null : payload?.error || "To'lov yozilmadi. Qayta urinib ko'ring.";
  }

  function applyCredit(customer: DashboardCustomer, amount: number, dueDate: string | null) {
    const nextBalance = customer.balance + amount;
    const nextStatus = getCustomerStatus(nextBalance, dueDate ?? customer.dueDate);
    setCustomers((current) => current.map((item) => item.id === customer.id ? { ...item, balance: nextBalance, dueDate: dueDate || item.dueDate, status: nextStatus } : item));
    setStats((current) => ({ ...current, totalOutstanding: current.totalOutstanding + amount, overdueAmount: current.overdueAmount + (nextStatus === "overdue" ? amount : 0), activeCustomers: current.activeCustomers + (customer.balance <= 0 ? 1 : 0) }));
  }

  function applyPayment(customer: DashboardCustomer, amount: number) {
    const nextBalance = Math.max(customer.balance - amount, 0);
    const nextStatus = getCustomerStatus(nextBalance, customer.dueDate);
    setCustomers((current) => current.map((item) => item.id === customer.id ? { ...item, balance: nextBalance, status: nextStatus, lastPayment: new Date().toISOString() } : item));
    setStats((current) => ({ ...current, totalOutstanding: Math.max(current.totalOutstanding - amount, 0), overdueAmount: Math.max(current.overdueAmount - (customer.status === "overdue" ? amount : 0), 0), collectedThisMonth: current.collectedThisMonth + amount, activeCustomers: nextBalance <= 0 ? Math.max(current.activeCustomers - 1, 0) : current.activeCustomers }));
  }

  async function submitQuickAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!quickAction) return;
    const { type, customer } = quickAction;
    const amount = Number(quickForm.amount);
    setSaving(true);
    setQuickError("");

    try {
      if (type === "edit") {
        if (!quickForm.name.trim()) {
          setQuickError("Ismni kiriting.");
          return;
        }
        if (supabase && liveMode) {
          const { error } = await supabase.from("customers").update({ name: quickForm.name.trim(), phone: quickForm.phone.trim() || null }).eq("id", customer.id);
          if (error) {
            setQuickError("Saqlab bo'lmadi.");
            return;
          }
        }
        setCustomers((current) => current.map((item) => item.id === customer.id ? { ...item, name: quickForm.name.trim(), phone: quickForm.phone.trim() || "Telefon yo'q" } : item));
        void recordActivity(customer.id, "customer", `${quickForm.name.trim()} ma'lumotlari yangilandi.`);
        setNotice({ tone: "success", text: "Mijoz yangilandi." });
      }

      if (type === "credit") {
        if (!Number.isFinite(amount) || amount <= 0) {
          setQuickError("Summani kiriting.");
          return;
        }
        if (supabase && liveMode) {
          const { error } = await supabase.from("debts").insert({ customer_id: customer.id, principal: amount, due_date: quickForm.dueDate || null, title: quickForm.note.trim() || "Qarz" });
          if (error) {
            setQuickError("Qarz yozilmadi.");
            return;
          }
        }
        applyCredit(customer, amount, quickForm.dueDate || null);
        void recordActivity(customer.id, "credit", `${customer.name}ga ${formatMoney(amount)} qarz yozildi.`);
        setNotice({ tone: "success", text: `${customer.name}ga ${formatMoney(amount)} qarz yozildi.` });
      }

      if (type === "payment") {
        if (!Number.isFinite(amount) || amount <= 0 || amount > customer.balance) {
          setQuickError(`To'lov 0 dan katta va ${formatMoney(customer.balance)} dan oshmasin.`);
          return;
        }
        const paymentError = await recordPayment(customer, amount, quickForm.note);
        if (paymentError) {
          setQuickError(paymentError);
          return;
        }
        applyPayment(customer, amount);
        void recordActivity(customer.id, "payment", `${customer.name}dan ${formatMoney(amount)} to'lov olindi.`);
        setNotice({ tone: "success", text: `${formatMoney(amount)} to'lov saqlandi.` });
      }

      closeQuickAction();
    } finally {
      setSaving(false);
    }
  }

  function openEntry(type: EntryType) {
    setActionSheetOpen(false);
    setEntryType(type);
    setEntryError("");
    setEntryCustomerQuery("");
    setEntryForm({ customerId: "", amount: "", dueDate: "", note: "" });
  }

  function closeEntry() {
    setEntryType(null);
    setEntryError("");
    setEntryCustomerQuery("");
  }

  function chooseEntryCustomer(customer: DashboardCustomer) {
    setEntryForm((current) => ({ ...current, customerId: customer.id }));
    setEntryCustomerQuery(customer.name);
  }

  async function submitEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!entryType) return;
    const customer = customers.find((item) => item.id === entryForm.customerId);
    const amount = Number(entryForm.amount);
    if (!customer) {
      setEntryError("Avval mijozni tanlang.");
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setEntryError("Summani kiriting.");
      return;
    }
    if (entryType === "payment" && amount > customer.balance) {
      setEntryError(`To'lov ${formatMoney(customer.balance)} dan oshmasin.`);
      return;
    }

    setSaving(true);
    setEntryError("");
    try {
      if (entryType === "credit") {
        if (supabase && liveMode) {
          const { error } = await supabase.from("debts").insert({ customer_id: customer.id, principal: amount, due_date: entryForm.dueDate || null, title: entryForm.note.trim() || "Qarz" });
          if (error) {
            setEntryError("Qarz yozilmadi. Qayta urinib ko'ring.");
            return;
          }
        }
        applyCredit(customer, amount, entryForm.dueDate || null);
        void recordActivity(customer.id, "credit", `${customer.name}ga ${formatMoney(amount)} qarz yozildi.`);
        setNotice({ tone: "success", text: `${customer.name}ga ${formatMoney(amount)} qarz yozildi.` });
      } else {
        const paymentError = await recordPayment(customer, amount, entryForm.note);
        if (paymentError) {
          setEntryError(paymentError);
          return;
        }
        applyPayment(customer, amount);
        void recordActivity(customer.id, "payment", `${customer.name}dan ${formatMoney(amount)} to'lov olindi.`);
        setNotice({ tone: "success", text: `${formatMoney(amount)} to'lov saqlandi.` });
      }
      closeEntry();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark">C</div><div className="brand-name">CreditBook</div></div>
        <nav className="nav-list" aria-label="Asosiy menyu">
          <a className={`nav-item ${activeSection === "dashboard" ? "active" : ""}`} href="#dashboard"><LayoutDashboard size={18} />Bosh sahifa</a>
          <a className={`nav-item ${activeSection === "customers" ? "active" : ""}`} href="#customers"><Users size={18} />Mijozlar</a>
          <a className={`nav-item ${activeSection === "activity" ? "active" : ""}`} href="#activity"><CircleDollarSign size={18} />Faoliyat</a>
          <a className={`nav-item ${activeSection === "more" ? "active" : ""}`} href="#more" onClick={() => { setActiveSection("more"); setMoreOpen(true); }}><Bell size={18} />Eslatmalar</a>
          <a className={`nav-item ${activeSection === "more" ? "active" : ""}`} href="#more" onClick={() => { setActiveSection("more"); setMoreOpen(true); }}><ArrowDownToLine size={18} />Hisobot</a>
        </nav>
        <div className="sidebar-spacer" />
        <div className="shop-card"><div className="shop-label">Do'kon</div><div className="shop-name">{shopName}</div><div className="shop-owner">{userEmail ?? "Sinov rejimi"}</div></div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="mobile-brand"><div className="brand-mark">C</div><strong>CreditBook</strong></div>
          <div className="topbar-copy"><div className="topbar-title">{formatToday()}</div><div className="topbar-subtitle">Qarzlarni oson nazorat qiling.</div></div>
          <div className="user-chip"><span>{userEmail ?? "Sinov rejimi"}</span><div className="avatar">{userEmail ? initials(userEmail) : "SR"}</div><button className="icon-button mobile-notice" onClick={() => setMoreOpen(true)} aria-label="Eslatmalarni ochish"><Bell size={19} /></button><button className="icon-button" onClick={() => void handleLogout()} disabled={signingOut} aria-label="Chiqish" title="Chiqish"><LogOut size={18} /></button></div>
        </header>

        <div className="page" id="dashboard">
          <section className="hero">
            <div><div className="eyebrow">Bugun</div><h1>Qarzlar tayyor.</h1><p>Do'koningizdagi qoldiqni bir necha bosishda yozing.</p></div>
            <button className="button button-primary hero-action" onClick={() => setActionSheetOpen(true)}><Plus size={19} />Yozuv qo'shish</button>
          </section>

          {notice && <div className={`notice ${notice.tone}`} role="status"><Check size={17} /><span>{notice.text}</span><button className="notice-close" onClick={() => setNotice(null)} aria-label="Xabarni yopish"><X size={16} /></button></div>}

          <section className="stats-grid" aria-label="Umumiy qarz holati">
            <StatCard label="Jami qoldiq" value={formatMoney(stats.totalOutstanding)} icon={<WalletCards size={17} />} foot="Faol qarzlar" />
            <StatCard label="Kechikkan" value={formatMoney(stats.overdueAmount)} icon={<Clock3 size={17} />} foot="E'tibor kerak" footClass="warn" />
            <StatCard label="Bu oy to'lov" value={formatMoney(stats.collectedThisMonth)} icon={<Check size={17} />} foot="Yig'ilgan summa" footClass="good" />
            <StatCard label="Faol mijoz" value={String(stats.activeCustomers)} icon={<Users size={17} />} foot="Qoldig'i bor" />
          </section>

          {!liveMode && <div className="setup-note"><strong>Ulanish kerak:</strong> {initialError || "Supabase sozlamalarini kiriting."}</div>}
          {liveMode && initialError && <div className="setup-note"><strong>Ulanish holati:</strong> {initialError}</div>}

          <section className="content-grid">
            <div className="panel customers-panel" id="customers">
              <div className="panel-heading"><div><div className="panel-title">Mijozlar</div><div className="panel-subtitle">Barcha mijozlar</div></div><button className="button button-secondary panel-add" onClick={openAddCustomer}><Plus size={17} />Mijoz</button></div>
              <div className="search-wrap"><div className="search-box"><Search size={17} aria-hidden="true" /><input className="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Mijoz qidirish..." aria-label="Mijoz qidirish" /></div></div>
              <div className="customer-list">{filteredCustomers.length ? filteredCustomers.map((customer) => <CustomerRow customer={customer} key={customer.id} onAction={openQuickAction} onOpen={() => openCustomerDetails(customer)} />) : <div className="empty"><Users size={28} /><strong>Mijoz topilmadi.</strong><span>Boshqa ism yoki telefon bilan qidiring.</span><button className="button button-secondary" onClick={openAddCustomer}><Plus size={16} />Mijoz qo'shish</button></div>}</div>
            </div>

            <div className="panel activity-panel" id="activity">
              <div className="panel-heading"><div><div className="panel-title">So'nggi ishlar</div><div className="panel-subtitle">Daftardagi oxirgi o'zgarishlar</div></div><BookOpen size={18} className="panel-icon" /></div>
              <div className="activity-list">{activities.length ? activities.map((activity) => <ActivityRow activity={activity} key={activity.id} />) : <div className="empty compact"><BookOpen size={26} /><strong>{liveMode ? "Faoliyat shu yerda chiqadi." : "Supabase ulanishi kerak."}</strong><span>{liveMode ? "Yangi qarz yoki to'lov yozing." : "Haqiqiy ma'lumotlar uchun login qiling."}</span></div>}</div>
            </div>
          </section>
        </div>
      </main>

      <nav className="mobile-nav" aria-label="Mobil menyu">
        <a className={`mobile-nav-item ${activeSection === "dashboard" ? "active" : ""}`} href="#dashboard"><LayoutDashboard size={19} /><span>Bosh</span></a>
        <a className={`mobile-nav-item ${activeSection === "customers" ? "active" : ""}`} href="#customers"><Users size={19} /><span>Mijozlar</span></a>
        <a className={`mobile-nav-item ${activeSection === "activity" ? "active" : ""}`} href="#activity"><CircleDollarSign size={19} /><span>Faoliyat</span></a>
        <button className="mobile-nav-item" onClick={() => setMoreOpen(true)}><Ellipsis size={19} /><span>Yana</span></button>
      </nav>

      {actionSheetOpen && <div className="sheet-backdrop" role="presentation" onClick={() => setActionSheetOpen(false)}><section className="sheet action-sheet" role="dialog" aria-modal="true" aria-labelledby="action-sheet-title" onClick={(event) => event.stopPropagation()}><div className="sheet-handle" /><div className="sheet-heading"><div><div className="eyebrow">Tezkor amal</div><h2 id="action-sheet-title">Nima yozamiz?</h2></div><button className="icon-button" onClick={() => setActionSheetOpen(false)} aria-label="Yopish"><X size={19} /></button></div><div className="sheet-options"><button className="sheet-option" onClick={() => openEntry("credit")}><span className="sheet-option-icon green"><Plus size={20} /></span><span><strong>+ Qarz</strong><small>Mijozga yangi qarz yozish</small></span><ChevronRight size={18} /></button><button className="sheet-option" onClick={() => openEntry("payment")}><span className="sheet-option-icon blue"><Check size={20} /></span><span><strong>- To'lov</strong><small>Mijozdan to'lov olish</small></span><ChevronRight size={18} /></button><button className="sheet-option" onClick={openAddCustomer}><span className="sheet-option-icon amber"><Users size={20} /></span><span><strong>+ Mijoz</strong><small>Yangi mijoz qo'shish</small></span><ChevronRight size={18} /></button></div></section></div>}

      {entryType && <div className="modal-backdrop" role="presentation" onClick={closeEntry}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="entry-title" onClick={(event) => event.stopPropagation()}><div className="modal-heading"><div><div className="eyebrow">Yangi yozuv</div><h2 id="entry-title">{entryType === "credit" ? "+ Qarz" : "- To'lov"}</h2></div><button className="icon-button" onClick={closeEntry} aria-label="Yopish"><X size={19} /></button></div><form onSubmit={submitEntry}><div className="field-grid"><div className="field full"><label htmlFor="entry-customer">Mijoz</label><div className="picker-input"><Search size={17} aria-hidden="true" /><input id="entry-customer" value={entryCustomerQuery} onChange={(event) => { setEntryCustomerQuery(event.target.value); setEntryForm((current) => ({ ...current, customerId: "" })); }} placeholder="Ism yoki telefon..." autoComplete="off" /></div>{!entryForm.customerId && <div className="customer-picker">{entryOptions.length ? entryOptions.map((customer) => <button type="button" className="picker-option" key={customer.id} onClick={() => chooseEntryCustomer(customer)}><span className="mini-avatar">{initials(customer.name)}</span><span><strong>{customer.name}</strong><small>{formatMoney(customer.balance)} qoldiq</small></span></button>) : <div className="picker-empty">Mijoz topilmadi.</div>}</div>}{entryCustomer && <div className="selected-customer"><span className="mini-avatar">{initials(entryCustomer.name)}</span><span><strong>{entryCustomer.name}</strong><small>{formatMoney(entryCustomer.balance)} qoldiq</small></span><button type="button" className="icon-button" onClick={() => { setEntryForm((current) => ({ ...current, customerId: "" })); setEntryCustomerQuery(""); }} aria-label="Mijozni almashtirish"><X size={16} /></button></div>}</div><div className="field full"><label htmlFor="entry-amount">Summa</label><div className="money-input"><input id="entry-amount" type="number" inputMode="decimal" min="1" max={entryType === "payment" && entryCustomer ? entryCustomer.balance : undefined} required value={entryForm.amount} onChange={(event) => setEntryForm({ ...entryForm, amount: event.target.value })} placeholder="0" /><span>so'm</span></div>{entryType === "payment" && entryCustomer && <button type="button" className="amount-shortcut" onClick={() => setEntryForm({ ...entryForm, amount: String(entryCustomer.balance) })}>Hammasini yopish · {formatMoney(entryCustomer.balance)}</button>}</div>{entryType === "credit" && <div className="field"><label htmlFor="entry-due">Muddat</label><div className="date-input"><CalendarDays size={17} aria-hidden="true" /><input id="entry-due" type="date" value={entryForm.dueDate} onChange={(event) => setEntryForm({ ...entryForm, dueDate: event.target.value })} /></div></div>}<div className="field full"><label htmlFor="entry-note">Izoh <span>(ixtiyoriy)</span></label><input id="entry-note" value={entryForm.note} onChange={(event) => setEntryForm({ ...entryForm, note: event.target.value })} placeholder="Masalan: un va yog'" /></div></div>{entryError && <div className="form-error" role="alert">{entryError}</div>}<div className="modal-actions"><button type="button" className="button button-ghost" onClick={closeEntry}>Bekor</button><button type="submit" className="button button-primary" disabled={saving}>{saving ? "Saqlanmoqda..." : "Saqlash"}</button></div></form></div></div>}

      {modalOpen && <div className="modal-backdrop" role="presentation" onClick={closeAddCustomer}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="add-customer-title" onClick={(event) => event.stopPropagation()}><div className="modal-heading"><div><div className="eyebrow">Yangi yozuv</div><h2 id="add-customer-title">Mijoz qo'shish</h2></div><button className="icon-button" onClick={closeAddCustomer} aria-label="Yopish"><X size={19} /></button></div><form onSubmit={addCustomer}><div className="field-grid"><div className="field full"><label htmlFor="name">Mijoz ismi <span>*</span></label><input id="name" required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Masalan: Aziz Karimov" autoComplete="name" /></div><div className="field full"><label htmlFor="phone">Telefon <span>(ixtiyoriy)</span></label><input id="phone" type="tel" inputMode="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="+998 90 000 00 00" autoComplete="tel" /></div><div className="field"><label htmlFor="amount">Boshlang'ich qarz</label><div className="money-input"><input id="amount" type="number" inputMode="decimal" min="0" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} placeholder="0" /><span>so'm</span></div></div><div className="field"><label htmlFor="dueDate">Muddat</label><div className="date-input"><CalendarDays size={17} aria-hidden="true" /><input id="dueDate" type="date" value={form.dueDate} onChange={(event) => setForm({ ...form, dueDate: event.target.value })} /></div></div></div>{formError && <div className="form-error" role="alert">{formError}</div>}<div className="modal-actions"><button type="button" className="button button-ghost" onClick={closeAddCustomer}>Bekor</button><button type="submit" className="button button-primary" disabled={saving}>{saving ? "Saqlanmoqda..." : "Saqlash"}</button></div></form></div></div>}

      {quickAction && <div className="modal-backdrop" role="presentation" onClick={closeQuickAction}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="quick-action-title" onClick={(event) => event.stopPropagation()}><div className="modal-heading"><div><div className="eyebrow">{quickAction.customer.name}</div><h2 id="quick-action-title">{quickAction.type === "credit" ? "+ Qarz" : quickAction.type === "payment" ? "- To'lov" : "Tahrir"}</h2></div><button className="icon-button" onClick={closeQuickAction} aria-label="Yopish"><X size={19} /></button></div><form onSubmit={submitQuickAction}><div className="field-grid">{quickAction.type === "edit" ? <><div className="field full"><label htmlFor="quick-name">Mijoz ismi <span>*</span></label><input id="quick-name" required value={quickForm.name} onChange={(event) => setQuickForm({ ...quickForm, name: event.target.value })} autoComplete="name" /></div><div className="field full"><label htmlFor="quick-phone">Telefon</label><input id="quick-phone" type="tel" inputMode="tel" value={quickForm.phone} onChange={(event) => setQuickForm({ ...quickForm, phone: event.target.value })} autoComplete="tel" /></div></> : <><div className="field full"><label htmlFor="quick-amount">Summa <span>· Qoldiq: {formatMoney(quickAction.customer.balance)}</span></label><div className="money-input"><input id="quick-amount" type="number" inputMode="decimal" min="1" max={quickAction.type === "payment" ? quickAction.customer.balance : undefined} required value={quickForm.amount} onChange={(event) => setQuickForm({ ...quickForm, amount: event.target.value })} placeholder="0" /><span>so'm</span></div>{quickAction.type === "payment" && <button type="button" className="amount-shortcut" onClick={() => setQuickForm({ ...quickForm, amount: String(quickAction.customer.balance) })}>Hammasini yopish</button>}</div>{quickAction.type === "credit" && <div className="field"><label htmlFor="quick-due">Muddat</label><div className="date-input"><CalendarDays size={17} aria-hidden="true" /><input id="quick-due" type="date" value={quickForm.dueDate} onChange={(event) => setQuickForm({ ...quickForm, dueDate: event.target.value })} /></div></div>}<div className="field full"><label htmlFor="quick-note">Izoh <span>(ixtiyoriy)</span></label><input id="quick-note" value={quickForm.note} onChange={(event) => setQuickForm({ ...quickForm, note: event.target.value })} placeholder="Masalan: qayta xarid" /></div></>}</div>{quickError && <div className="form-error" role="alert">{quickError}</div>}<div className="modal-actions"><button type="button" className="button button-ghost" onClick={closeQuickAction}>Bekor</button><button type="submit" className="button button-primary" disabled={saving || (quickAction.type === "payment" && quickAction.customer.balance <= 0)}>{saving ? "Saqlanmoqda..." : "Saqlash"}</button></div></form></div></div>}

      {selectedCustomer && <div className="sheet-backdrop" role="presentation" onClick={() => setSelectedCustomerId(null)}><section className="sheet customer-sheet" role="dialog" aria-modal="true" aria-labelledby="customer-sheet-title" onClick={(event) => event.stopPropagation()}><div className="sheet-handle" /><div className="customer-sheet-head"><div className="customer-avatar large">{initials(selectedCustomer.name)}</div><div><h2 id="customer-sheet-title">{selectedCustomer.name}</h2><p>{selectedCustomer.phone}</p></div><button className="icon-button" onClick={() => setSelectedCustomerId(null)} aria-label="Yopish"><X size={19} /></button></div><div className="customer-balance"><span>Qoldiq</span><strong className="money">{formatMoney(selectedCustomer.balance)}</strong><span className={`status ${selectedCustomer.status}`}>{statusLabels[selectedCustomer.status]}</span></div><div className="customer-sheet-meta"><div><span>Muddat</span><strong>{formatDate(selectedCustomer.dueDate)}</strong></div><div><span>Oxirgi to'lov</span><strong>{selectedCustomer.lastPayment ? formatDate(selectedCustomer.lastPayment.slice(0, 10)) : "Hali yo'q"}</strong></div></div><div className="customer-sheet-actions"><button className="button button-secondary" onClick={() => openQuickAction("credit", selectedCustomer)}><Plus size={17} />Qarz</button><button className="button button-primary" onClick={() => openQuickAction("payment", selectedCustomer)} disabled={selectedCustomer.balance <= 0}><Check size={17} />To'lov</button><button className="button button-ghost" onClick={() => openQuickAction("edit", selectedCustomer)}><Ellipsis size={18} />Tahrir</button></div><div className="recent-history"><div className="recent-history-heading"><div><h3>So'nggi yozuvlar</h3><span>{historyLoading ? "Yuklanmoqda..." : `${historyTransactions.length} ta yozuv`}</span></div><button className="text-button" onClick={() => openFullHistory(selectedCustomer)}>Barcha tarix</button></div>{historyLoading ? <div className="history-loading">Tarix yuklanmoqda...</div> : historyError ? <div className="history-error" role="alert"><span>{historyError}</span><button className="text-button" onClick={() => void loadCustomerHistory(selectedCustomer)}>Qayta</button></div> : historyTransactions.length ? <div className="history-list preview">{historyTransactions.slice(0, 3).map((transaction) => <TransactionRow transaction={transaction} key={transaction.id} />)}</div> : <div className="history-empty compact-history"><BookOpen size={21} /><span>Hali qarz yoki to'lov yozilmagan.</span></div>}</div><div className="sheet-note"><BookOpen size={17} /><span>Har bir yangi qarz va to'lov mijoz tarixida saqlanadi.</span></div></section></div>}

      {historyOpen && historyCustomer && <div className="history-backdrop" role="presentation" onClick={closeHistory}><section className="history-screen" role="dialog" aria-modal="true" aria-labelledby="history-title" onClick={(event) => event.stopPropagation()}><div className="history-screen-head"><div><div className="eyebrow">Mijoz tarixi</div><h2 id="history-title">{historyCustomer.name}</h2><p>{historyTransactions.length} ta yozuv · Qoldiq {formatMoney(historyCustomer.balance)}</p></div><button className="icon-button" onClick={closeHistory} aria-label="Tarixni yopish"><X size={20} /></button></div><div className="history-controls"><div className="history-filters" role="tablist" aria-label="Tarix turi"><button className={`history-filter ${historyFilter === "all" ? "active" : ""}`} onClick={() => setHistoryFilter("all")} aria-pressed={historyFilter === "all"}>Barchasi</button><button className={`history-filter ${historyFilter === "credit" ? "active" : ""}`} onClick={() => setHistoryFilter("credit")} aria-pressed={historyFilter === "credit"}>Qarz</button><button className={`history-filter ${historyFilter === "payment" ? "active" : ""}`} onClick={() => setHistoryFilter("payment")} aria-pressed={historyFilter === "payment"}>To'lov</button></div><div className="history-search"><Search size={17} aria-hidden="true" /><input value={historySearch} onChange={(event) => setHistorySearch(event.target.value)} placeholder="Tarixdan qidirish..." aria-label="Tarixdan qidirish" /></div></div>{historyLoading ? <div className="history-empty"><BookOpen size={29} /><strong>Tarix yuklanmoqda...</strong><span>Yozuvlar olinmoqda.</span></div> : historyError ? <div className="history-empty"><BookOpen size={29} /><strong>Tarixni olib bo'lmadi.</strong><span>{historyError}</span><button className="button button-secondary" onClick={() => void loadCustomerHistory(historyCustomer)}>Qayta yuklash</button></div> : historyGroups.length ? <div className="history-groups">{historyGroups.map((group) => <section className="history-group" key={group.key}><h3 className="history-group-title">{group.label}</h3><div className="history-list">{group.transactions.map((transaction) => <TransactionRow transaction={transaction} key={transaction.id} />)}</div></section>)}</div> : <div className="history-empty"><BookOpen size={29} /><strong>Bu filtrda yozuv yo'q.</strong><span>Qidiruv yoki filtrni o'zgartirib ko'ring.</span>{(historySearch || historyFilter !== "all") && <button className="button button-secondary" onClick={() => { setHistorySearch(""); setHistoryFilter("all"); }}>Filtrni tozalash</button>}</div>}</section></div>}

      {moreOpen && <div className="sheet-backdrop" role="presentation" onClick={() => setMoreOpen(false)}><section className="sheet small-sheet" role="dialog" aria-modal="true" aria-labelledby="more-title" onClick={(event) => event.stopPropagation()}><div className="sheet-handle" /><div className="sheet-heading"><div><div className="eyebrow">Qo'shimcha</div><h2 id="more-title">Yana</h2></div><button className="icon-button" onClick={() => setMoreOpen(false)} aria-label="Yopish"><X size={19} /></button></div><div className="more-list"><div><Bell size={18} /><span><strong>Eslatmalar</strong><small>Tez orada</small></span></div><div><ArrowDownToLine size={18} /><span><strong>Hisobot</strong><small>Tez orada</small></span></div></div></section></div>}
    </div>
  );
}

function StatCard({ label, value, icon, foot, footClass = "" }: { label: string; value: string; icon: ReactNode; foot: string; footClass?: string }) {
  return <div className="stat-card"><div className="stat-label"><span>{label}</span><span className="stat-icon">{icon}</span></div><div className="stat-value money">{value}</div><div className={`stat-foot ${footClass}`}>{foot}</div></div>;
}

function TransactionRow({ transaction }: { transaction: HistoryTransaction }) {
  const isCredit = transaction.type === "credit";
  return <article className={`history-row ${transaction.type}`}><span className={`history-type-icon ${transaction.type}`} aria-hidden="true">{isCredit ? <Plus size={16} /> : <Check size={16} />}</span><div className="history-row-copy"><div className="history-row-title"><strong>{transaction.description}</strong><span>{isCredit ? "Qarz" : "To'lov"}</span></div><small>{formatHistoryDate(transaction.occurredAt)}{isCredit && transaction.dueDate ? ` · Muddat ${formatDate(transaction.dueDate)}` : ""}</small></div><div className="history-row-values"><strong className="money">{isCredit ? "+" : "−"}{formatMoney(transaction.amount)}</strong><small>Qoldiq {formatMoney(transaction.balanceAfter)}</small></div></article>;
}

function ActivityRow({ activity }: { activity: ActivityItem }) {
  return <article className="activity-item"><span className={`activity-dot ${activity.event_type}`} aria-hidden="true" /><div><div className="activity-text">{activity.description}</div><div className="activity-time">{formatHistoryDate(activity.created_at)}</div></div></article>;
}

function CustomerRow({ customer, onAction, onOpen }: { customer: DashboardCustomer; onAction: (type: QuickAction, customer: DashboardCustomer) => void; onOpen: () => void }) {
  return <article className="customer-row"><button className="customer-main" onClick={onOpen} aria-label={`${customer.name} tafsilotlarini ochish`}><span className="customer-avatar">{initials(customer.name)}</span><span className="customer-main-copy"><strong className="customer-name">{customer.name}</strong><small className="customer-phone">{customer.phone}</small></span><ChevronRight size={17} className="customer-chevron" /></button><div className="customer-meta"><span>Qoldiq</span><strong className={`row-value money ${customer.balance > 0 && customer.status === "overdue" ? "balance-alert" : ""}`}>{formatMoney(customer.balance)}</strong></div><div className="customer-meta"><span>Muddat</span><strong className="row-value">{formatDate(customer.dueDate)}</strong></div><div className="customer-meta status-meta"><span>Holat</span><span className={`status ${customer.status}`}>{statusLabels[customer.status]}</span></div><div className="quick-actions"><button className="button button-secondary quick-action" onClick={() => onAction("credit", customer)} aria-label={`${customer.name}ga qarz qo'shish`}><Plus size={15} />Qarz</button><button className="button button-primary quick-action" onClick={() => onAction("payment", customer)} aria-label={`${customer.name}dan to'lov olish`} disabled={customer.balance <= 0}><Check size={15} />To'lov</button><button className="button button-ghost quick-action icon-action" onClick={() => onAction("edit", customer)} aria-label={`${customer.name}ni tahrirlash`}><Ellipsis size={17} /></button></div></article>;
}
