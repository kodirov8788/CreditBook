"use client";
/* Uzbek Latin text intentionally uses apostrophes in visible labels. */
/* eslint-disable react/no-unescaped-entities */

import { useEffect, useMemo, useState, type Dispatch, type FormEvent, type ReactNode, type SetStateAction } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
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
import ActivityFeed from "@/components/activity-feed";

const money = new Intl.NumberFormat("uz-UZ", { maximumFractionDigits: 0 });
const dateFormatter = new Intl.DateTimeFormat("uz-UZ", { month: "short", day: "numeric" });
const fullDateFormatter = new Intl.DateTimeFormat("uz-UZ", { weekday: "long", month: "long", day: "numeric" });
const statusLabels = { overdue: "Kechikkan", "due-soon": "Yaqin", "on-track": "Vaqtida", paid: "Yopilgan" } as const;
type QuickAction = "credit" | "payment" | "edit";
type EntryType = "credit" | "payment";
type HistoryFilter = "all" | "credit" | "payment";
type MoreView = "reminders" | "reports" | null;
type DashboardView = "dashboard" | "customers" | "activity" | "reminders" | "reports";
type HistoryCredit = { id: string; title: string | null; principal: number; due_date: string | null; status: string; created_at: string };
type HistoryPayment = { id: string; debt_id: string; amount: number; paid_at: string | null; note: string | null; created_at: string; voided_at: string | null; void_reason: string | null };
type HistoryTransaction = { id: string; type: "credit" | "payment"; amount: number; description: string; occurredAt: string; dueDate: string | null; status: string | null; balanceAfter: number; voided: boolean };
type ReminderItem = { id: string; customer_id: string; channel: string; scheduled_for: string | null; sent_at: string | null; status: string; error_reason?: string | null; message: string | null; customers?: { name?: string; phone?: string | null } | null };
type ExpenseItem = { id: string; category: string; amount: number; spent_at: string; vendor: string | null; note: string | null; payment_method: string; voided_at: string | null };
type MonthlyReport = { month: string; credits: number; collected: number; expenses: number; netCashflow: number };
type ReportData = { from: string | null; to: string | null; newCredits: number; collected: number; expensesTotal: number; netCashflow: number; outstanding: number; overdueAmount: number; overdueCount: number; activeCustomers: number; monthly: MonthlyReport[]; expenses: ExpenseItem[] };
type ActivityItem = { id: string; customer_id: string | null; event_type: string; description: string; created_at: string };
type Notice = { tone: "success" | "info"; text: string } | null;
type HistoryCacheEntry = { transactions: HistoryTransaction[]; savedAt: number };

const historyCache = new Map<string, HistoryCacheEntry>();
const HISTORY_CACHE_TTL = 30_000;

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
    ...credits.map((credit) => ({ id: credit.id, type: "credit" as const, amount: Number(credit.principal), description: credit.title?.trim() || "Qarz", occurredAt: credit.created_at, dueDate: credit.due_date, status: credit.status, balanceAfter: 0, voided: credit.status === "cancelled" })),
    ...payments.map((payment) => ({ id: payment.id, type: "payment" as const, amount: Number(payment.amount), description: payment.note?.trim() || "To'lov", occurredAt: payment.paid_at ?? payment.created_at, dueDate: null, status: payment.voided_at ? "voided" : null, balanceAfter: 0, voided: Boolean(payment.voided_at) })),
  ].filter((transaction) => Number.isFinite(transaction.amount) && transaction.amount > 0).sort((left, right) => new Date(left.occurredAt).getTime() - new Date(right.occurredAt).getTime());

  let balance = 0;
  return raw.map((transaction) => {
    if (!transaction.voided) balance = Math.max(balance + (transaction.type === "credit" ? transaction.amount : -transaction.amount), 0);
    return { ...transaction, balanceAfter: balance };
  }).reverse();
}

function formatToday() {
  return fullDateFormatter.format(new Date());
}

function localDateInputValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function currentMonthRange() {
  const now = new Date();
  return { from: localDateInputValue(new Date(now.getFullYear(), now.getMonth(), 1)), to: localDateInputValue(now) };
}

function nextHourInputValue() {
  const next = new Date();
  next.setMinutes(0, 0, 0);
  next.setHours(next.getHours() + 1);
  const date = localDateInputValue(next);
  const hours = String(next.getHours()).padStart(2, "0");
  return `${date}T${hours}:00`;
}

function initials(value: string) {
  return value.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

export default function Dashboard({ initialCustomers, initialStats, initialActivities, userEmail, shopName = "Mahalla do'koni", liveMode, canManageMembers = false, initialError = "", initialView = "dashboard", initialCustomerId }: { initialCustomers: DashboardCustomer[]; initialStats: DashboardStats; initialActivities: ActivityItem[]; userEmail: string | null; shopName?: string; liveMode: boolean; canManageMembers?: boolean; initialError?: string; initialView?: DashboardView; initialCustomerId?: string }) {
  const [customers, setCustomers] = useState(initialCustomers);
  const [stats, setStats] = useState(initialStats);
  const [activities, setActivities] = useState(initialActivities);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [actionSheetOpen, setActionSheetOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [moreView, setMoreView] = useState<MoreView>(initialView === "reminders" || initialView === "reports" ? initialView : null);
  const [reminders, setReminders] = useState<ReminderItem[]>([]);
  const [reminderLoading, setReminderLoading] = useState(false);
  const [reminderSaving, setReminderSaving] = useState(false);
  const [reminderActionId, setReminderActionId] = useState<string | null>(null);
  const [reminderError, setReminderError] = useState("");
  const [reminderForm, setReminderForm] = useState({ customerId: "", scheduledFor: "", message: "", channel: "manual" });
  const [editingReminderId, setEditingReminderId] = useState<string | null>(null);
  const [report, setReport] = useState<ReportData | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState("");
  const [reportRange, setReportRange] = useState({ from: "", to: "" });
  const [expenseForm, setExpenseForm] = useState({ category: "", amount: "", spentAt: "", vendor: "", note: "" });
  const [expenseError, setExpenseError] = useState("");
  const [expenseSaving, setExpenseSaving] = useState(false);
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
  const [historyCustomerId, setHistoryCustomerId] = useState<string | null>(initialCustomerId ?? null);
  const [historyTransactions, setHistoryTransactions] = useState<HistoryTransaction[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [historyOpen, setHistoryOpen] = useState(Boolean(initialCustomerId && liveMode));
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>("all");
  const [historySearch, setHistorySearch] = useState("");
  const [correctionId, setCorrectionId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [activeSection, setActiveSection] = useState(initialView === "reminders" || initialView === "reports" ? "more" : initialView);
  const [todayLabel, setTodayLabel] = useState("Bugun");
  const supabase = hasSupabaseEnv() ? createClient() : null;
  const router = useRouter();

  useEffect(() => {
    function syncActiveSection() {
      setActiveSection(window.location.hash.replace(/^#/, "") || (initialView === "reminders" || initialView === "reports" ? "more" : initialView));
    }

    syncActiveSection();
    window.addEventListener("hashchange", syncActiveSection);
    return () => window.removeEventListener("hashchange", syncActiveSection);
  }, [initialView]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setTodayLabel(formatToday());
      setReportRange(currentMonthRange());
      setExpenseForm((current) => ({ ...current, spentAt: current.spentAt || localDateInputValue() }));
      setReminderForm((current) => ({ ...current, scheduledFor: current.scheduledFor || nextHourInputValue() }));
    }, 0);
    return () => window.clearTimeout(timer);
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
    const cached = historyCache.get(customer.id);
    const hasFreshCache = cached && Date.now() - cached.savedAt < HISTORY_CACHE_TTL;
    if (hasFreshCache) {
      setHistoryTransactions(cached.transactions);
    }
    setHistoryLoading(!hasFreshCache);
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
      supabase.from("payments").select("id, debt_id, amount, paid_at, note, created_at, voided_at, void_reason").eq("customer_id", customer.id).order("paid_at", { ascending: false }),
    ]);

    if (creditError || paymentError) {
      setHistoryTransactions([]);
      setHistoryError("Tarix olinmadi. Qayta urinib ko'ring.");
    } else {
      const transactions = normalizeHistory((credits ?? []) as HistoryCredit[], (payments ?? []) as HistoryPayment[]);
      historyCache.set(customer.id, { transactions, savedAt: Date.now() });
      setHistoryTransactions(transactions);
    }
    setHistoryLoading(false);
  }

  function openCustomerDetails(customer: DashboardCustomer) {
    if (liveMode) {
      router.push(`/customers/${customer.id}`);
      return;
    }
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

  useEffect(() => {
    if (!initialCustomerId || !liveMode) return;
    const customer = customers.find((item) => item.id === initialCustomerId);
    if (!customer) return;
    queueMicrotask(() => void loadCustomerHistory(customer));
    // The loader intentionally uses the current customer snapshot for the initial route.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customers, initialCustomerId, liveMode]);

  function closeHistory() {
    setHistoryOpen(false);
    setHistoryFilter("all");
    setHistorySearch("");
  }

  async function reverseTransaction(transaction: HistoryTransaction) {
    if (!historyCustomer || transaction.voided || correctionId) return;
    const actionLabel = transaction.type === "payment" ? "to'lovni" : "qarzni";
    if (!window.confirm(`${formatMoney(transaction.amount)} ${actionLabel} bekor qilinsinmi? Bu amal tarixda saqlanadi.`)) return;

    setCorrectionId(transaction.id);
    setHistoryError("");
    try {
      const endpoint = transaction.type === "payment"
        ? `/api/customers/${historyCustomer.id}/payments/${transaction.id}/void`
        : `/api/customers/${historyCustomer.id}/credits/${transaction.id}/cancel`;
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: "Foydalanuvchi tuzatishi" }) });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) {
        setHistoryError(payload?.error || "Yozuvni bekor qilib bo'lmadi.");
        return;
      }

      const nextBalance = Math.max(historyCustomer.balance + (transaction.type === "payment" ? transaction.amount : -transaction.amount), 0);
      const nextStatus = getCustomerStatus(nextBalance, historyCustomer.dueDate);
      setCustomers((current) => current.map((item) => item.id === historyCustomer.id ? { ...item, balance: nextBalance, status: nextStatus } : item));
      setStats((current) => ({
        ...current,
        totalOutstanding: Math.max(current.totalOutstanding + (transaction.type === "payment" ? transaction.amount : -transaction.amount), 0),
        overdueAmount: Math.max(current.overdueAmount + (nextStatus === "overdue" ? nextBalance : 0) - (historyCustomer.status === "overdue" ? historyCustomer.balance : 0), 0),
        activeCustomers: current.activeCustomers + (historyCustomer.balance <= 0 && nextBalance > 0 ? 1 : historyCustomer.balance > 0 && nextBalance <= 0 ? -1 : 0),
        collectedThisMonth: transaction.type === "payment" && transaction.occurredAt.slice(0, 7) === new Date().toISOString().slice(0, 7) ? Math.max(current.collectedThisMonth - transaction.amount, 0) : current.collectedThisMonth,
      }));
      setNotice({ tone: "success", text: `${actionLabel[0].toUpperCase()}${actionLabel.slice(1)} bekor qilindi.` });
      void recordActivity(historyCustomer.id, transaction.type, `${historyCustomer.name} uchun ${formatMoney(transaction.amount)} ${actionLabel} bekor qilindi.`);
      await loadCustomerHistory({ ...historyCustomer, balance: nextBalance, status: nextStatus });
    } catch {
      setHistoryError("Yozuvni bekor qilib bo'lmadi. Qayta urinib ko'ring.");
    } finally {
      setCorrectionId(null);
    }
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

  async function loadReminders() {
    setReminderLoading(true);
    setReminderError("");
    if (!liveMode) {
      setReminderError("Eslatmalar uchun Supabase ulanishi kerak.");
      setReminderLoading(false);
      return;
    }
    const response = await fetch("/api/reminders");
    const payload = await response.json().catch(() => null) as { reminders?: ReminderItem[]; error?: string } | null;
    if (!response.ok) setReminderError(payload?.error || "Eslatmalar olinmadi.");
    else setReminders(payload?.reminders ?? []);
    setReminderLoading(false);
  }

  function openMoreView(view: MoreView) {
    setMoreOpen(false);
    setMoreView(view);
    if (view === "reminders") void loadReminders();
    if (view === "reports") void loadReport(reportRange);
  }

  async function saveReminder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setReminderError("");
    if (!reminderForm.customerId || !reminderForm.scheduledFor) {
      setReminderError("Mijoz va muddatni kiriting.");
      return;
    }
    const isEditing = Boolean(editingReminderId);
    const url = isEditing ? `/api/reminders/${editingReminderId}` : "/api/reminders";
    setReminderSaving(true);
    try {
      const response = await fetch(url, { method: isEditing ? "PATCH" : "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ customerId: reminderForm.customerId, scheduledFor: new Date(reminderForm.scheduledFor).toISOString(), message: reminderForm.message, channel: reminderForm.channel }) });
      const payload = await response.json().catch(() => null) as { reminder?: ReminderItem; error?: string } | null;
      if (!response.ok || !payload?.reminder) {
        setReminderError(payload?.error || "Eslatma saqlanmadi.");
        return;
      }
      setReminderForm({ customerId: "", scheduledFor: nextHourInputValue(), message: "", channel: "manual" });
      setEditingReminderId(null);
      setNotice({ tone: "success", text: isEditing ? "Eslatma yangilandi." : "Eslatma saqlandi." });
      const customer = customers.find((item) => item.id === reminderForm.customerId);
      void recordActivity(reminderForm.customerId, "reminder", `${customer?.name || "Mijoz"} uchun eslatma ${isEditing ? "yangilandi" : "saqlandi"}.`);
      await loadReminders();
    } finally {
      setReminderSaving(false);
    }
  }

  async function cancelReminder(id: string) {
    setReminderActionId(id);
    try {
      const response = await fetch(`/api/reminders/${id}`, { method: "PATCH", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "cancelled" }) });
      if (!response.ok) {
        setReminderError("Eslatma bekor qilinmadi.");
        return;
      }
      setReminders((current) => current.map((reminder) => reminder.id === id ? { ...reminder, status: "cancelled" } : reminder));
      setNotice({ tone: "success", text: "Eslatma bekor qilindi." });
      void recordActivity(null, "reminder", "Eslatma bekor qilindi.");
    } finally {
      setReminderActionId(null);
    }
  }

  function editReminder(reminder: ReminderItem) {
    setEditingReminderId(reminder.id);
    setReminderForm({ customerId: reminder.customer_id, scheduledFor: reminder.scheduled_for ? new Date(reminder.scheduled_for).toISOString().slice(0, 16) : "", message: reminder.message || "", channel: reminder.channel || "manual" });
  }

  async function sendReminder(reminder: ReminderItem) {
    setReminderActionId(reminder.id);
    try {
      const response = await fetch(`/api/reminders/${reminder.id}`, { method: "PATCH", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "sent" }) });
      const payload = await response.json().catch(() => null) as { reminder?: ReminderItem } | null;
      if (!response.ok || !payload?.reminder) {
        setReminderError("Eslatma yuborilgan deb belgilanmadi.");
        return;
      }
      setReminders((current) => current.map((item) => item.id === reminder.id ? payload.reminder! : item));
      setNotice({ tone: "success", text: "Eslatma yuborildi deb qayd qilindi." });
      void recordActivity(reminder.customer_id, "reminder", `${reminder.customers?.name || "Mijoz"}ga eslatma yuborildi.`);
    } finally {
      setReminderActionId(null);
    }
  }

  async function loadReport(range: { from: string; to: string }) {
    setReportLoading(true);
    setReportError("");
    if (!liveMode) {
      setReportError("Hisobot uchun Supabase ulanishi kerak.");
      setReportLoading(false);
      return;
    }
    const params = new URLSearchParams();
    if (range.from) params.set("from", range.from);
    if (range.to) params.set("to", range.to);
    const response = await fetch(`/api/reports?${params.toString()}`);
    const payload = await response.json().catch(() => null) as { report?: ReportData; error?: string } | null;
    if (!response.ok || !payload?.report) setReportError(payload?.error || "Hisobot olinmadi.");
    else setReport(payload.report);
    setReportLoading(false);
  }

  async function saveExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setExpenseError("");
    setExpenseSaving(true);
    try {
      const response = await fetch("/api/expenses", { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ category: expenseForm.category, amount: Number(expenseForm.amount), spentAt: expenseForm.spentAt, vendor: expenseForm.vendor, note: expenseForm.note }) });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) {
        setExpenseError(payload?.error || "Xarajat saqlanmadi.");
        return;
      }
      setExpenseForm({ category: "", amount: "", spentAt: localDateInputValue(), vendor: "", note: "" });
      setNotice({ tone: "success", text: "Xarajat saqlandi." });
      void recordActivity(null, "expense", `${expenseForm.category} uchun ${formatMoney(Number(expenseForm.amount))} xarajat yozildi.`);
      await loadReport(reportRange);
    } finally {
      setExpenseSaving(false);
    }
  }

  async function voidExpense(id: string) {
    setExpenseSaving(true);
    try {
      const response = await fetch(`/api/expenses/${id}`, { method: "PATCH", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ void: true, reason: "Foydalanuvchi tuzatishi" }) });
      if (!response.ok) {
        setExpenseError("Xarajat bekor qilinmadi.");
        return;
      }
      setNotice({ tone: "success", text: "Xarajat bekor qilindi." });
      void recordActivity(null, "expense", "Xarajat bekor qilindi.");
      await loadReport(reportRange);
    } finally {
      setExpenseSaving(false);
    }
  }

  async function recordActivity(customerId: string | null, eventType: string, description: string) {
    const localActivity: ActivityItem = { id: `local-${eventType}-${customerId ?? "general"}-${description}`, customer_id: customerId, event_type: eventType, description, created_at: new Date().toISOString() };
    if (liveMode) {
      const response = await fetch("/api/activity", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ customerId, eventType, description }) });
      const payload = await response.json().catch(() => null) as { activity?: ActivityItem } | null;
      if (response.ok && payload?.activity) {
        setActivities((current) => [payload.activity as ActivityItem, ...current].slice(0, 10));
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
    if (response.ok) historyCache.delete(customer.id);
    return response.ok ? null : payload?.error || "To'lov yozilmadi. Qayta urinib ko'ring.";
  }

  async function recordCredit(customer: DashboardCustomer, amount: number, dueDate: string | null, title: string) {
    if (!liveMode) return null;
    const response = await fetch(`/api/customers/${customer.id}/credits`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ amount, dueDate, title: title.trim() || "Qarz" }) });
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    if (response.ok) historyCache.delete(customer.id);
    return response.ok ? null : payload?.error || "Qarz yozilmadi. Qayta urinib ko'ring.";
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
          const response = await fetch(`/api/customers/${customer.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: quickForm.name.trim(), phone: quickForm.phone.trim() || null }) });
          const payload = await response.json().catch(() => null) as { error?: string } | null;
          if (!response.ok) {
            setQuickError(payload?.error || "Saqlab bo'lmadi.");
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
        const creditError = await recordCredit(customer, amount, quickForm.dueDate || null, quickForm.note);
        if (creditError) {
          setQuickError(creditError);
          return;
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
        const creditError = await recordCredit(customer, amount, entryForm.dueDate || null, entryForm.note);
        if (creditError) {
          setEntryError(creditError);
          return;
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
          <Link className={`nav-item ${activeSection === "dashboard" ? "active" : ""}`} href="/dashboard"><LayoutDashboard size={18} />Bosh sahifa</Link>
          <Link className={`nav-item ${activeSection === "customers" ? "active" : ""}`} href="/customers"><Users size={18} />Mijozlar</Link>
          <Link className={`nav-item ${activeSection === "activity" ? "active" : ""}`} href="/activity"><CircleDollarSign size={18} />Faoliyat</Link>
          <Link className={`nav-item ${moreView === "reminders" ? "active" : ""}`} href="/reminders"><Bell size={18} />Eslatmalar</Link>
          <Link className={`nav-item ${moreView === "reports" ? "active" : ""}`} href="/reports"><ArrowDownToLine size={18} />Hisobot</Link>
          {canManageMembers && <Link className="nav-item" href="/team"><Users size={18} />Jamoa</Link>}
        </nav>
        <div className="sidebar-spacer" />
        <div className="shop-card"><div className="shop-label">Do'kon</div><div className="shop-name">{shopName}</div><div className="shop-owner">{userEmail ?? "Sinov rejimi"}</div></div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="mobile-brand"><div className="brand-mark">C</div><strong>CreditBook</strong></div>
          <div className="topbar-copy"><div className="topbar-title">{todayLabel}</div><div className="topbar-subtitle">Qarzlarni oson nazorat qiling.</div></div>
          <div className="user-chip"><span>{userEmail ?? "Sinov rejimi"}</span><div className="avatar">{userEmail ? initials(userEmail) : "SR"}</div><button className="icon-button mobile-notice" onClick={() => setMoreOpen(true)} aria-label="Eslatmalarni ochish"><Bell size={19} /></button><button className="icon-button" onClick={() => void handleLogout()} disabled={signingOut} aria-label="Chiqish" title="Chiqish"><LogOut size={18} /></button></div>
        </header>

        <div className="page" id="dashboard">
          {initialView === "dashboard" && <section className="hero">
            <div><div className="eyebrow">Bugun</div><h1>Qarzlar tayyor.</h1><p>Do'koningizdagi qoldiqni bir necha bosishda yozing.</p></div>
            <button className="button button-primary hero-action" onClick={() => setActionSheetOpen(true)}><Plus size={19} />Yozuv qo'shish</button>
          </section>}

          {notice && <div className={`notice ${notice.tone}`} role="status"><Check size={17} /><span>{notice.text}</span><button className="notice-close" onClick={() => setNotice(null)} aria-label="Xabarni yopish"><X size={16} /></button></div>}

          {initialView === "dashboard" && <section className="stats-grid" aria-label="Umumiy qarz holati">
            <StatCard label="Jami qoldiq" value={formatMoney(stats.totalOutstanding)} icon={<WalletCards size={17} />} foot="Faol qarzlar" />
            <StatCard label="Kechikkan" value={formatMoney(stats.overdueAmount)} icon={<Clock3 size={17} />} foot="E'tibor kerak" footClass="warn" />
            <StatCard label="Bu oy to'lov" value={formatMoney(stats.collectedThisMonth)} icon={<Check size={17} />} foot="Yig'ilgan summa" footClass="good" />
            <StatCard label="Faol mijoz" value={String(stats.activeCustomers)} icon={<Users size={17} />} foot="Qoldig'i bor" />
          </section>}

          {!liveMode && <div className="setup-note"><strong>Ulanish kerak:</strong> {initialError || "Supabase sozlamalarini kiriting."}</div>}
          {liveMode && initialError && <div className="setup-note"><strong>Ulanish holati:</strong> {initialError}</div>}

          <section className="content-grid">
            {(initialView === "dashboard" || initialView === "customers") && <div className="panel customers-panel" id="customers">
              <div className="panel-heading"><div><div className="panel-title">Mijozlar</div><div className="panel-subtitle">Barcha mijozlar</div></div><button className="button button-secondary panel-add" onClick={openAddCustomer}><Plus size={17} />Mijoz</button></div>
              <div className="search-wrap"><div className="search-box"><Search size={17} aria-hidden="true" /><input className="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Mijoz qidirish..." aria-label="Mijoz qidirish" /></div></div>
              <div className="customer-list">{filteredCustomers.length ? filteredCustomers.map((customer) => <CustomerRow customer={customer} key={customer.id} onAction={openQuickAction} onOpen={() => openCustomerDetails(customer)} />) : <div className="empty"><Users size={28} /><strong>Mijoz topilmadi.</strong><span>Boshqa ism yoki telefon bilan qidiring.</span><button className="button button-secondary" onClick={openAddCustomer}><Plus size={16} />Mijoz qo'shish</button></div>}</div>
            </div>}

            {initialView === "dashboard" && <div className="panel activity-panel" id="activity">
              <div className="panel-heading"><div><div className="panel-title">So'nggi ishlar</div><div className="panel-subtitle">Daftardagi oxirgi o'zgarishlar</div></div><BookOpen size={18} className="panel-icon" /></div>
              <div className="activity-list">{activities.length ? activities.map((activity) => <ActivityRow activity={activity} key={activity.id} />) : <div className="empty compact"><BookOpen size={26} /><strong>{liveMode ? "Faoliyat shu yerda chiqadi." : "Supabase ulanishi kerak."}</strong><span>{liveMode ? "Yangi qarz yoki to'lov yozing." : "Haqiqiy ma'lumotlar uchun login qiling."}</span></div>}</div>
            </div>}
            {initialView === "activity" && <ActivityFeed initialActivities={activities} customers={customers} liveMode={liveMode} />}
          </section>
        </div>
      </main>

      <nav className="mobile-nav" aria-label="Mobil menyu">
        <Link className={`mobile-nav-item ${activeSection === "dashboard" ? "active" : ""}`} href="/dashboard"><LayoutDashboard size={19} /><span>Bosh</span></Link>
        <Link className={`mobile-nav-item ${activeSection === "customers" ? "active" : ""}`} href="/customers"><Users size={19} /><span>Mijozlar</span></Link>
        <Link className={`mobile-nav-item ${activeSection === "activity" ? "active" : ""}`} href="/activity"><CircleDollarSign size={19} /><span>Faoliyat</span></Link>
        <button className="mobile-nav-item" onClick={() => setMoreOpen(true)}><Ellipsis size={19} /><span>Yana</span></button>
      </nav>

      {actionSheetOpen && <div className="sheet-backdrop" role="presentation" onClick={() => setActionSheetOpen(false)}><section className="sheet action-sheet" role="dialog" aria-modal="true" aria-labelledby="action-sheet-title" onClick={(event) => event.stopPropagation()}><div className="sheet-handle" /><div className="sheet-heading"><div><div className="eyebrow">Tezkor amal</div><h2 id="action-sheet-title">Nima yozamiz?</h2></div><button className="icon-button" onClick={() => setActionSheetOpen(false)} aria-label="Yopish"><X size={19} /></button></div><div className="sheet-options"><button className="sheet-option" onClick={() => openEntry("credit")}><span className="sheet-option-icon green"><Plus size={20} /></span><span><strong>+ Qarz</strong><small>Mijozga yangi qarz yozish</small></span><ChevronRight size={18} /></button><button className="sheet-option" onClick={() => openEntry("payment")}><span className="sheet-option-icon blue"><Check size={20} /></span><span><strong>- To'lov</strong><small>Mijozdan to'lov olish</small></span><ChevronRight size={18} /></button><button className="sheet-option" onClick={openAddCustomer}><span className="sheet-option-icon amber"><Users size={20} /></span><span><strong>+ Mijoz</strong><small>Yangi mijoz qo'shish</small></span><ChevronRight size={18} /></button></div></section></div>}

      {entryType && <div className="modal-backdrop" role="presentation" onClick={closeEntry}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="entry-title" onClick={(event) => event.stopPropagation()}><div className="modal-heading"><div><div className="eyebrow">Yangi yozuv</div><h2 id="entry-title">{entryType === "credit" ? "+ Qarz" : "- To'lov"}</h2></div><button className="icon-button" onClick={closeEntry} aria-label="Yopish"><X size={19} /></button></div><form onSubmit={submitEntry}><div className="field-grid"><div className="field full"><label htmlFor="entry-customer">Mijoz</label><div className="picker-input"><Search size={17} aria-hidden="true" /><input id="entry-customer" value={entryCustomerQuery} onChange={(event) => { setEntryCustomerQuery(event.target.value); setEntryForm((current) => ({ ...current, customerId: "" })); }} placeholder="Ism yoki telefon..." autoComplete="off" /></div>{!entryForm.customerId && <div className="customer-picker">{entryOptions.length ? entryOptions.map((customer) => <button type="button" className="picker-option" key={customer.id} onClick={() => chooseEntryCustomer(customer)}><span className="mini-avatar">{initials(customer.name)}</span><span><strong>{customer.name}</strong><small>{formatMoney(customer.balance)} qoldiq</small></span></button>) : <div className="picker-empty">Mijoz topilmadi.</div>}</div>}{entryCustomer && <div className="selected-customer"><span className="mini-avatar">{initials(entryCustomer.name)}</span><span><strong>{entryCustomer.name}</strong><small>{formatMoney(entryCustomer.balance)} qoldiq</small></span><button type="button" className="icon-button" onClick={() => { setEntryForm((current) => ({ ...current, customerId: "" })); setEntryCustomerQuery(""); }} aria-label="Mijozni almashtirish"><X size={16} /></button></div>}</div><div className="field full"><label htmlFor="entry-amount">Summa</label><div className="money-input"><input id="entry-amount" type="number" inputMode="decimal" min="1" max={entryType === "payment" && entryCustomer ? entryCustomer.balance : undefined} required value={entryForm.amount} onChange={(event) => setEntryForm({ ...entryForm, amount: event.target.value })} placeholder="0" /><span>so'm</span></div>{entryType === "payment" && entryCustomer && <button type="button" className="amount-shortcut" onClick={() => setEntryForm({ ...entryForm, amount: String(entryCustomer.balance) })}>Hammasini yopish · {formatMoney(entryCustomer.balance)}</button>}</div>{entryType === "credit" && <div className="field"><label htmlFor="entry-due">Muddat</label><div className="date-input"><CalendarDays size={17} aria-hidden="true" /><input id="entry-due" type="date" value={entryForm.dueDate} onChange={(event) => setEntryForm({ ...entryForm, dueDate: event.target.value })} /></div></div>}<div className="field full"><label htmlFor="entry-note">Izoh <span>(ixtiyoriy)</span></label><input id="entry-note" value={entryForm.note} onChange={(event) => setEntryForm({ ...entryForm, note: event.target.value })} placeholder="Masalan: un va yog'" /></div></div>{entryError && <div className="form-error" role="alert">{entryError}</div>}<div className="modal-actions"><button type="button" className="button button-ghost" onClick={closeEntry}>Bekor</button><button type="submit" className="button button-primary" disabled={saving}>{saving ? "Saqlanmoqda..." : "Saqlash"}</button></div></form></div></div>}

      {modalOpen && <div className="modal-backdrop" role="presentation" onClick={closeAddCustomer}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="add-customer-title" onClick={(event) => event.stopPropagation()}><div className="modal-heading"><div><div className="eyebrow">Yangi yozuv</div><h2 id="add-customer-title">Mijoz qo'shish</h2></div><button className="icon-button" onClick={closeAddCustomer} aria-label="Yopish"><X size={19} /></button></div><form onSubmit={addCustomer}><div className="field-grid"><div className="field full"><label htmlFor="name">Mijoz ismi <span>*</span></label><input id="name" required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Masalan: Aziz Karimov" autoComplete="name" /></div><div className="field full"><label htmlFor="phone">Telefon <span>(ixtiyoriy)</span></label><input id="phone" type="tel" inputMode="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="+998 90 000 00 00" autoComplete="tel" /></div><div className="field"><label htmlFor="amount">Boshlang'ich qarz</label><div className="money-input"><input id="amount" type="number" inputMode="decimal" min="0" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} placeholder="0" /><span>so'm</span></div></div><div className="field"><label htmlFor="dueDate">Muddat</label><div className="date-input"><CalendarDays size={17} aria-hidden="true" /><input id="dueDate" type="date" value={form.dueDate} onChange={(event) => setForm({ ...form, dueDate: event.target.value })} /></div></div></div>{formError && <div className="form-error" role="alert">{formError}</div>}<div className="modal-actions"><button type="button" className="button button-ghost" onClick={closeAddCustomer}>Bekor</button><button type="submit" className="button button-primary" disabled={saving}>{saving ? "Saqlanmoqda..." : "Saqlash"}</button></div></form></div></div>}

      {quickAction && <div className="modal-backdrop" role="presentation" onClick={closeQuickAction}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="quick-action-title" onClick={(event) => event.stopPropagation()}><div className="modal-heading"><div><div className="eyebrow">{quickAction.customer.name}</div><h2 id="quick-action-title">{quickAction.type === "credit" ? "+ Qarz" : quickAction.type === "payment" ? "- To'lov" : "Tahrir"}</h2></div><button className="icon-button" onClick={closeQuickAction} aria-label="Yopish"><X size={19} /></button></div><form onSubmit={submitQuickAction}><div className="field-grid">{quickAction.type === "edit" ? <><div className="field full"><label htmlFor="quick-name">Mijoz ismi <span>*</span></label><input id="quick-name" required value={quickForm.name} onChange={(event) => setQuickForm({ ...quickForm, name: event.target.value })} autoComplete="name" /></div><div className="field full"><label htmlFor="quick-phone">Telefon</label><input id="quick-phone" type="tel" inputMode="tel" value={quickForm.phone} onChange={(event) => setQuickForm({ ...quickForm, phone: event.target.value })} autoComplete="tel" /></div></> : <><div className="field full"><label htmlFor="quick-amount">Summa <span>· Qoldiq: {formatMoney(quickAction.customer.balance)}</span></label><div className="money-input"><input id="quick-amount" type="number" inputMode="decimal" min="1" max={quickAction.type === "payment" ? quickAction.customer.balance : undefined} required value={quickForm.amount} onChange={(event) => setQuickForm({ ...quickForm, amount: event.target.value })} placeholder="0" /><span>so'm</span></div>{quickAction.type === "payment" && <button type="button" className="amount-shortcut" onClick={() => setQuickForm({ ...quickForm, amount: String(quickAction.customer.balance) })}>Hammasini yopish</button>}</div>{quickAction.type === "credit" && <div className="field"><label htmlFor="quick-due">Muddat</label><div className="date-input"><CalendarDays size={17} aria-hidden="true" /><input id="quick-due" type="date" value={quickForm.dueDate} onChange={(event) => setQuickForm({ ...quickForm, dueDate: event.target.value })} /></div></div>}<div className="field full"><label htmlFor="quick-note">Izoh <span>(ixtiyoriy)</span></label><input id="quick-note" value={quickForm.note} onChange={(event) => setQuickForm({ ...quickForm, note: event.target.value })} placeholder="Masalan: qayta xarid" /></div></>}</div>{quickError && <div className="form-error" role="alert">{quickError}</div>}<div className="modal-actions"><button type="button" className="button button-ghost" onClick={closeQuickAction}>Bekor</button><button type="submit" className="button button-primary" disabled={saving || (quickAction.type === "payment" && quickAction.customer.balance <= 0)}>{saving ? "Saqlanmoqda..." : "Saqlash"}</button></div></form></div></div>}

      {selectedCustomer && <div className="sheet-backdrop" role="presentation" onClick={() => setSelectedCustomerId(null)}><section className="sheet customer-sheet" role="dialog" aria-modal="true" aria-labelledby="customer-sheet-title" onClick={(event) => event.stopPropagation()}><div className="sheet-handle" /><div className="customer-sheet-head"><div className="customer-avatar large">{initials(selectedCustomer.name)}</div><div><h2 id="customer-sheet-title">{selectedCustomer.name}</h2><p>{selectedCustomer.phone}</p></div><button className="icon-button" onClick={() => setSelectedCustomerId(null)} aria-label="Yopish"><X size={19} /></button></div><div className="customer-balance"><span>Qoldiq</span><strong className="money">{formatMoney(selectedCustomer.balance)}</strong><span className={`status ${selectedCustomer.status}`}>{statusLabels[selectedCustomer.status]}</span></div><div className="customer-sheet-meta"><div><span>Muddat</span><strong>{formatDate(selectedCustomer.dueDate)}</strong></div><div><span>Oxirgi to'lov</span><strong>{selectedCustomer.lastPayment ? formatDate(selectedCustomer.lastPayment.slice(0, 10)) : "Hali yo'q"}</strong></div></div><div className="customer-sheet-actions"><button className="button button-secondary" onClick={() => openQuickAction("credit", selectedCustomer)}><Plus size={17} />Qarz</button><button className="button button-primary" onClick={() => openQuickAction("payment", selectedCustomer)} disabled={selectedCustomer.balance <= 0}><Check size={17} />To'lov</button><button className="button button-ghost" onClick={() => openQuickAction("edit", selectedCustomer)}><Ellipsis size={18} />Tahrir</button></div><div className="recent-history"><div className="recent-history-heading"><div><h3>So'nggi yozuvlar</h3><span>{historyLoading ? "Yuklanmoqda..." : `${historyTransactions.length} ta yozuv`}</span></div><button className="text-button" onClick={() => openFullHistory(selectedCustomer)}>Barcha tarix</button></div>{historyLoading ? <div className="history-loading">Tarix yuklanmoqda...</div> : historyError ? <div className="history-error" role="alert"><span>{historyError}</span><button className="text-button" onClick={() => void loadCustomerHistory(selectedCustomer)}>Qayta</button></div> : historyTransactions.length ? <div className="history-list preview">{historyTransactions.slice(0, 3).map((transaction) => <TransactionRow transaction={transaction} key={transaction.id} />)}</div> : <div className="history-empty compact-history"><BookOpen size={21} /><span>Hali qarz yoki to'lov yozilmagan.</span></div>}</div><div className="sheet-note"><BookOpen size={17} /><span>Har bir yangi qarz va to'lov mijoz tarixida saqlanadi.</span></div></section></div>}

      {historyOpen && historyCustomer && <div className="history-backdrop" role="presentation" onClick={closeHistory}><section className="history-screen" role="dialog" aria-modal="true" aria-labelledby="history-title" onClick={(event) => event.stopPropagation()}><div className="history-screen-head"><div><div className="eyebrow">Mijoz tarixi</div><h2 id="history-title">{historyCustomer.name}</h2><p>{historyTransactions.length} ta yozuv · Qoldiq {formatMoney(historyCustomer.balance)}</p></div><button className="icon-button" onClick={closeHistory} aria-label="Tarixni yopish"><X size={20} /></button></div><div className="history-controls"><div className="history-filters" role="tablist" aria-label="Tarix turi"><button className={`history-filter ${historyFilter === "all" ? "active" : ""}`} onClick={() => setHistoryFilter("all")} aria-pressed={historyFilter === "all"}>Barchasi</button><button className={`history-filter ${historyFilter === "credit" ? "active" : ""}`} onClick={() => setHistoryFilter("credit")} aria-pressed={historyFilter === "credit"}>Qarz</button><button className={`history-filter ${historyFilter === "payment" ? "active" : ""}`} onClick={() => setHistoryFilter("payment")} aria-pressed={historyFilter === "payment"}>To'lov</button></div><div className="history-search"><Search size={17} aria-hidden="true" /><input value={historySearch} onChange={(event) => setHistorySearch(event.target.value)} placeholder="Tarixdan qidirish..." aria-label="Tarixdan qidirish" /></div></div>{historyLoading ? <div className="history-empty"><BookOpen size={29} /><strong>Tarix yuklanmoqda...</strong><span>Yozuvlar olinmoqda.</span></div> : historyError ? <div className="history-empty"><BookOpen size={29} /><strong>Tarixni olib bo'lmadi.</strong><span>{historyError}</span><button className="button button-secondary" onClick={() => void loadCustomerHistory(historyCustomer)}>Qayta yuklash</button></div> : historyGroups.length ? <div className="history-groups">{historyGroups.map((group) => <section className="history-group" key={group.key}><h3 className="history-group-title">{group.label}</h3><div className="history-list">{group.transactions.map((transaction) => <TransactionRow transaction={transaction} key={transaction.id} onReverse={reverseTransaction} reversing={correctionId === transaction.id} />)}</div></section>)}</div> : <div className="history-empty"><BookOpen size={29} /><strong>Bu filtrda yozuv yo'q.</strong><span>Qidiruv yoki filtrni o'zgartirib ko'ring.</span>{(historySearch || historyFilter !== "all") && <button className="button button-secondary" onClick={() => { setHistorySearch(""); setHistoryFilter("all"); }}>Filtrni tozalash</button>}</div>}</section></div>}

      {moreOpen && <div className="sheet-backdrop" role="presentation" onClick={() => setMoreOpen(false)}><section className="sheet small-sheet" role="dialog" aria-modal="true" aria-labelledby="more-title" onClick={(event) => event.stopPropagation()}><div className="sheet-handle" /><div className="sheet-heading"><div><div className="eyebrow">Qo'shimcha</div><h2 id="more-title">Yana</h2></div><button className="icon-button" onClick={() => setMoreOpen(false)} aria-label="Yopish"><X size={19} /></button></div><div className="more-list"><button onClick={() => openMoreView("reminders")}><Bell size={18} /><span><strong>Eslatmalar</strong><small>Muddatlarni eslab qolish</small></span><ChevronRight size={17} /></button><button onClick={() => openMoreView("reports")}><ArrowDownToLine size={18} /><span><strong>Hisobot</strong><small>Qarz va to'lov tahlili</small></span><ChevronRight size={17} /></button>{canManageMembers && <Link className="more-list-link" href="/team" onClick={() => setMoreOpen(false)}><Users size={18} /><span><strong>Jamoa</strong><small>Xodimlar va rollar</small></span><ChevronRight size={17} /></Link>}</div></section></div>}

      {moreView === "reminders" && <ReminderPanel reminders={reminders} customers={customers} loading={reminderLoading} saving={reminderSaving} actionId={reminderActionId} error={reminderError} form={reminderForm} setForm={setReminderForm} editingId={editingReminderId} onSubmit={saveReminder} onEdit={editReminder} onCancel={cancelReminder} onSend={sendReminder} onClose={() => setMoreView(null)} onClear={() => { setEditingReminderId(null); setReminderForm({ customerId: "", scheduledFor: nextHourInputValue(), message: "", channel: "manual" }); }} />}

      {moreView === "reports" && <div className="modal-backdrop" role="presentation" onClick={() => setMoreView(null)}><div className="modal more-modal" role="dialog" aria-modal="true" aria-labelledby="reports-title" onClick={(event) => event.stopPropagation()}><div className="modal-heading"><div><div className="eyebrow">Raqamlar</div><h2 id="reports-title">Hisobot</h2></div><button className="icon-button" onClick={() => setMoreView(null)} aria-label="Hisobotni yopish"><X size={19} /></button></div><ReportPanel report={report} reportLoading={reportLoading} reportError={reportError} reportRange={reportRange} setReportRange={setReportRange} expenseForm={expenseForm} setExpenseForm={setExpenseForm} expenseError={expenseError} expenseSaving={expenseSaving} onRefresh={() => void loadReport(reportRange)} onSaveExpense={saveExpense} onVoidExpense={voidExpense} /></div></div>}
    </div>
  );
}

function ReminderPanel({ reminders, customers, loading, saving, actionId, error, form, setForm, editingId, onSubmit, onEdit, onCancel, onSend, onClose, onClear }: { reminders: ReminderItem[]; customers: DashboardCustomer[]; loading: boolean; saving: boolean; actionId: string | null; error: string; form: { customerId: string; scheduledFor: string; message: string; channel: string }; setForm: Dispatch<SetStateAction<{ customerId: string; scheduledFor: string; message: string; channel: string }>>; editingId: string | null; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onEdit: (reminder: ReminderItem) => void; onCancel: (id: string) => void; onSend: (reminder: ReminderItem) => void; onClose: () => void; onClear: () => void }) {
  return <div className="modal-backdrop" role="presentation" onClick={onClose}><div className="modal more-modal" role="dialog" aria-modal="true" aria-labelledby="reminders-title" onClick={(event) => event.stopPropagation()}><div className="modal-heading"><div><div className="eyebrow">Vaqtida eslatma</div><h2 id="reminders-title">Eslatmalar</h2></div><button className="icon-button" onClick={onClose} aria-label="Eslatmalarni yopish"><X size={19} /></button></div><form onSubmit={onSubmit}><div className="field-grid"><div className="field full"><label htmlFor="reminder-customer">Mijoz</label><select id="reminder-customer" required value={form.customerId} onChange={(event) => setForm({ ...form, customerId: event.target.value })}><option value="">Mijozni tanlang</option>{customers.filter((customer) => customer.balance > 0).map((customer) => <option key={customer.id} value={customer.id}>{customer.name} · {formatMoney(customer.balance)}</option>)}</select></div><div className="field"><label htmlFor="reminder-date">Eslatma vaqti</label><input id="reminder-date" required type="datetime-local" value={form.scheduledFor} onChange={(event) => setForm({ ...form, scheduledFor: event.target.value })} /></div><div className="field"><label htmlFor="reminder-channel">Kanal</label><select id="reminder-channel" value={form.channel} onChange={(event) => setForm({ ...form, channel: event.target.value })}><option value="manual">Manual</option><option value="whatsapp">WhatsApp</option><option value="sms">SMS</option><option value="email">Email</option></select></div><div className="field full"><label htmlFor="reminder-message">Xabar <span>(ixtiyoriy)</span></label><input id="reminder-message" value={form.message} onChange={(event) => setForm({ ...form, message: event.target.value })} placeholder="Masalan: qarz muddatini eslatish" /></div></div>{error && <div className="form-error" role="alert">{error}</div>}<div className="modal-actions"><button type="button" className="button button-ghost" onClick={onClear}>Tozalash</button><button type="submit" className="button button-primary" disabled={saving}>{saving ? "Saqlanmoqda..." : editingId ? "Eslatmani yangilash" : "Eslatma qo'shish"}</button></div></form><div className="reminder-list"><div className="section-label">Eslatmalar tarixi</div>{loading ? <div className="history-loading">Yuklanmoqda...</div> : reminders.length ? reminders.map((reminder) => <ReminderRow reminder={reminder} key={reminder.id} onEdit={onEdit} onCancel={onCancel} onSend={onSend} actionId={actionId} />) : <div className="history-empty compact-history"><Bell size={20} /><span>Eslatma yo'q.</span></div>}</div></div></div>;
}

function ReminderRow({ reminder, onEdit, onCancel, onSend, actionId }: { reminder: ReminderItem; onEdit: (reminder: ReminderItem) => void; onCancel: (id: string) => void; onSend: (reminder: ReminderItem) => void; actionId: string | null }) {
  const phone = reminder.customers?.phone?.replace(/\D/g, "") || "";
  const message = reminder.message || "Qarz muddatini eslataman.";
  const statusLabel = reminder.status === "sent" ? "Yuborildi" : reminder.status === "failed" ? "Xato" : reminder.status === "cancelled" ? "Bekor" : "Kutilmoqda";
  const busy = actionId === reminder.id;
  return <div className="reminder-item"><div><strong>{reminder.customers?.name || "Mijoz"} <span className={`reminder-status ${reminder.status}`}>{statusLabel}</span></strong><small>{reminder.scheduled_for ? formatHistoryDate(reminder.scheduled_for) : "Vaqt belgilanmagan"}{reminder.message ? ` · ${reminder.message}` : ""}{reminder.sent_at ? ` · ${formatHistoryDate(reminder.sent_at)} yuborildi` : ""}{reminder.error_reason ? ` · ${reminder.error_reason}` : ""}</small>{phone && <span className="reminder-links"><a href={`https://wa.me/${phone}?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer">WhatsApp</a><a href={`sms:${reminder.customers?.phone}?body=${encodeURIComponent(message)}`}>SMS</a></span>}</div><div className="reminder-actions">{reminder.status === "pending" && <><button className="text-button" onClick={() => onEdit(reminder)} disabled={busy}>Tahrir</button><button className="text-button" onClick={() => onSend(reminder)} disabled={busy}>{busy ? "..." : "Yuborildi"}</button><button className="text-button danger-text" onClick={() => onCancel(reminder.id)} disabled={busy}>{busy ? "..." : "Bekor"}</button></>}{(reminder.status === "cancelled" || reminder.status === "failed") && <button className="text-button" onClick={() => onEdit(reminder)} disabled={busy}>Qayta rejalash</button>}</div></div>;
}

function StatCard({ label, value, icon, foot, footClass = "" }: { label: string; value: string; icon: ReactNode; foot: string; footClass?: string }) {
  return <div className="stat-card"><div className="stat-label"><span>{label}</span><span className="stat-icon">{icon}</span></div><div className="stat-value money">{value}</div><div className={`stat-foot ${footClass}`}>{foot}</div></div>;
}

function TransactionRow({ transaction, onReverse, reversing = false }: { transaction: HistoryTransaction; onReverse?: (transaction: HistoryTransaction) => void; reversing?: boolean }) {
  const isCredit = transaction.type === "credit";
  return <article className={`history-row ${transaction.type} ${transaction.voided ? "voided" : ""}`}><span className={`history-type-icon ${transaction.type}`} aria-hidden="true">{isCredit ? <Plus size={16} /> : <Check size={16} />}</span><div className="history-row-copy"><div className="history-row-title"><strong>{transaction.description}</strong><span>{transaction.voided ? "Bekor qilingan" : isCredit ? "Qarz" : "To'lov"}</span></div><small>{formatHistoryDate(transaction.occurredAt)}{isCredit && transaction.dueDate ? ` · Muddat ${formatDate(transaction.dueDate)}` : ""}</small></div><div className="history-row-values"><strong className="money">{transaction.voided ? "Bekor" : `${isCredit ? "+" : "−"}${formatMoney(transaction.amount)}`}</strong><small>Qoldiq {formatMoney(transaction.balanceAfter)}</small></div>{onReverse && !transaction.voided && <button className="text-button history-reverse" onClick={() => onReverse(transaction)} disabled={reversing}>{reversing ? "..." : "Bekor qilish"}</button>}</article>;
}

function ReportPanel({ report, reportLoading, reportError, reportRange, setReportRange, expenseForm, setExpenseForm, expenseError, expenseSaving, onRefresh, onSaveExpense, onVoidExpense }: { report: ReportData | null; reportLoading: boolean; reportError: string; reportRange: { from: string; to: string }; setReportRange: Dispatch<SetStateAction<{ from: string; to: string }>>; expenseForm: { category: string; amount: string; spentAt: string; vendor: string; note: string }; setExpenseForm: Dispatch<SetStateAction<{ category: string; amount: string; spentAt: string; vendor: string; note: string }>>; expenseError: string; expenseSaving: boolean; onRefresh: () => void; onSaveExpense: (event: FormEvent<HTMLFormElement>) => void; onVoidExpense: (id: string) => void }) {
  const maxBar = Math.max(...(report?.monthly ?? []).flatMap((item) => [item.collected, item.expenses]), 1);
  return <>
    <div className="report-filters"><div className="field"><label htmlFor="report-from">Boshlanish</label><input id="report-from" type="date" value={reportRange.from} onChange={(event) => setReportRange({ ...reportRange, from: event.target.value })} /></div><div className="field"><label htmlFor="report-to">Tugash</label><input id="report-to" type="date" value={reportRange.to} onChange={(event) => setReportRange({ ...reportRange, to: event.target.value })} /></div><button className="button button-secondary" onClick={onRefresh} disabled={reportLoading}>{reportLoading ? "Yuklanmoqda..." : "Ko'rsatish"}</button></div>
    {reportError && <div className="form-error" role="alert">{reportError}</div>}
    {report && <>
      <div className="report-grid"><StatCard label="Naqd tushum" value={formatMoney(report.collected)} icon={<Check size={17} />} foot="Faol to'lovlar" /><StatCard label="Xarajat" value={formatMoney(report.expensesTotal)} icon={<ArrowDownToLine size={17} />} foot="Faol xarajatlar" /><StatCard label="Sof cashflow" value={formatMoney(report.netCashflow)} icon={<WalletCards size={17} />} foot="Tushum − xarajat" /><StatCard label="Qoldiq qarz" value={formatMoney(report.outstanding)} icon={<Clock3 size={17} />} foot={`${report.overdueCount} ta kechikkan`} /><StatCard label="Yangi qarz" value={formatMoney(report.newCredits)} icon={<Plus size={17} />} foot="Receivable yozuvi" /></div>
      <section className="report-chart"><div className="section-label">Oylar bo'yicha cashflow</div>{report.monthly.length ? report.monthly.map((item) => <div className="chart-row" key={item.month}><strong>{item.month}</strong><div className="chart-bars"><span className="chart-bar income" style={{ width: `${Math.max((item.collected / maxBar) * 100, item.collected ? 3 : 0)}%` }} title={`Tushum ${formatMoney(item.collected)}`} /><span className="chart-bar expense" style={{ width: `${Math.max((item.expenses / maxBar) * 100, item.expenses ? 3 : 0)}%` }} title={`Xarajat ${formatMoney(item.expenses)}`} /></div><small>{formatMoney(item.netCashflow)}</small></div>) : <div className="history-empty compact-history">Bu davrda ma'lumot yo'q.</div>}<div className="chart-legend"><span className="income-dot" />Tushum <span className="expense-dot" />Xarajat</div></section>
      <section className="expense-section"><div className="section-label">Xarajat qo'shish</div><form onSubmit={onSaveExpense}><div className="field-grid"><div className="field"><label htmlFor="expense-category">Tur</label><select id="expense-category" value={expenseForm.category} onChange={(event) => setExpenseForm({ ...expenseForm, category: event.target.value })}><option value="">Tanlang</option><option value="Tovar">Tovar</option><option value="Ijara">Ijara</option><option value="Transport">Transport</option><option value="Kommunal">Kommunal</option><option value="Boshqa">Boshqa</option></select></div><div className="field"><label htmlFor="expense-amount">Summa</label><input id="expense-amount" type="number" min="1" required value={expenseForm.amount} onChange={(event) => setExpenseForm({ ...expenseForm, amount: event.target.value })} placeholder="0" /></div><div className="field"><label htmlFor="expense-date">Sana</label><input id="expense-date" type="date" required value={expenseForm.spentAt} onChange={(event) => setExpenseForm({ ...expenseForm, spentAt: event.target.value })} /></div><div className="field"><label htmlFor="expense-vendor">Kimga <span>(ixtiyoriy)</span></label><input id="expense-vendor" value={expenseForm.vendor} onChange={(event) => setExpenseForm({ ...expenseForm, vendor: event.target.value })} placeholder="Yetkazuvchi" /></div><div className="field full"><label htmlFor="expense-note">Izoh <span>(ixtiyoriy)</span></label><input id="expense-note" value={expenseForm.note} onChange={(event) => setExpenseForm({ ...expenseForm, note: event.target.value })} placeholder="Masalan: do'kon ijara haqi" /></div></div>{expenseError && <div className="form-error" role="alert">{expenseError}</div>}<button className="button button-primary" type="submit" disabled={expenseSaving}>{expenseSaving ? "Saqlanmoqda..." : "Xarajatni saqlash"}</button></form></section>
      <section className="expense-section"><div className="section-label">Xarajatlar tarixi</div>{report.expenses.length ? report.expenses.map((expense) => <div className="reminder-item" key={expense.id}><div><strong>{expense.category} · {formatMoney(Number(expense.amount))}</strong><small>{expense.spent_at}{expense.vendor ? ` · ${expense.vendor}` : ""}{expense.note ? ` · ${expense.note}` : ""}</small></div><button className="text-button" onClick={() => onVoidExpense(expense.id)} disabled={expenseSaving}>{expenseSaving ? "..." : "Bekor"}</button></div>) : <div className="history-empty compact-history">Xarajat yozilmagan.</div>}</section>
    </>}
  </>;
}

function ActivityRow({ activity }: { activity: ActivityItem }) {
  return <article className="activity-item"><span className={`activity-dot ${activity.event_type}`} aria-hidden="true" /><div><div className="activity-text">{activity.description}</div><div className="activity-time" suppressHydrationWarning>{formatHistoryDate(activity.created_at)}</div></div></article>;
}

function CustomerRow({ customer, onAction, onOpen }: { customer: DashboardCustomer; onAction: (type: QuickAction, customer: DashboardCustomer) => void; onOpen: () => void }) {
  return <article className="customer-row"><button className="customer-main" onClick={onOpen} aria-label={`${customer.name} tafsilotlarini ochish`}><span className="customer-avatar">{initials(customer.name)}</span><span className="customer-main-copy"><strong className="customer-name">{customer.name}</strong><small className="customer-phone">{customer.phone}</small></span><ChevronRight size={17} className="customer-chevron" /></button><div className="customer-meta"><span>Qoldiq</span><strong className={`row-value money ${customer.balance > 0 && customer.status === "overdue" ? "balance-alert" : ""}`}>{formatMoney(customer.balance)}</strong></div><div className="customer-meta"><span>Muddat</span><strong className="row-value">{formatDate(customer.dueDate)}</strong></div><div className="customer-meta status-meta"><span>Holat</span><span className={`status ${customer.status}`}>{statusLabels[customer.status]}</span></div><div className="quick-actions"><button className="button button-secondary quick-action" onClick={() => onAction("credit", customer)} aria-label={`${customer.name}ga qarz qo'shish`}><Plus size={15} />Qarz</button><button className="button button-primary quick-action" onClick={() => onAction("payment", customer)} aria-label={`${customer.name}dan to'lov olish`} disabled={customer.balance <= 0}><Check size={15} />To'lov</button><button className="button button-ghost quick-action icon-action" onClick={() => onAction("edit", customer)} aria-label={`${customer.name}ni tahrirlash`}><Ellipsis size={17} /></button></div></article>;
}
