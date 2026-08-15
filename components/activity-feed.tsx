"use client";
/* eslint-disable react/no-unescaped-entities */

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Download, Filter, Search } from "lucide-react";
import type { DashboardCustomer } from "@/lib/types";

type ActivityItem = { id: string; customer_id: string | null; event_type: string; description: string; created_at: string; customers?: { name?: string; phone?: string | null } | null };
type ActivityFilters = { q: string; eventType: string; customerId: string; from: string; to: string };

const eventLabels: Record<string, string> = { all: "Barchasi", credit: "Qarz", payment: "To'lov", customer: "Mijoz", reminder: "Eslatma", expense: "Xarajat" };

function formatActivityDate(value: string) {
  return new Intl.DateTimeFormat("uz-UZ", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function localDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function currentMonthFilters(): ActivityFilters {
  const today = new Date();
  return {
    q: "",
    eventType: "all",
    customerId: "all",
    from: localDateInputValue(new Date(today.getFullYear(), today.getMonth(), 1)),
    to: localDateInputValue(today),
  };
}

function buildQuery(filters: ActivityFilters, page: number) {
  const params = new URLSearchParams({ page: String(page), pageSize: "50" });
  if (filters.q.trim()) params.set("q", filters.q.trim());
  if (filters.eventType !== "all") params.set("eventType", filters.eventType);
  if (filters.customerId !== "all") params.set("customerId", filters.customerId);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  return params;
}

export default function ActivityFeed({ initialActivities, customers, liveMode }: { initialActivities: ActivityItem[]; customers: DashboardCustomer[]; liveMode: boolean }) {
  const [activities, setActivities] = useState(initialActivities);
  const [filters, setFilters] = useState<ActivityFilters>({ q: "", eventType: "all", customerId: "all", from: "", to: "" });
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(initialActivities.length);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function load(nextPage: number, nextFilters: ActivityFilters, append = false) {
    if (!liveMode) return;
    setLoading(true);
    setError("");
    const response = await fetch(`/api/activity?${buildQuery(nextFilters, nextPage)}`);
    const payload = await response.json().catch(() => null) as { activities?: ActivityItem[]; total?: number; hasMore?: boolean; error?: string } | null;
    if (!response.ok || !payload?.activities) {
      setError(payload?.error || "Faoliyat olinmadi.");
      setLoading(false);
      return;
    }
    setActivities((current) => append ? [...current, ...payload.activities!] : payload.activities!);
    setPage(nextPage);
    setTotal(payload.total ?? payload.activities.length);
    setHasMore(Boolean(payload.hasMore));
    setLoading(false);
  }

  useEffect(() => {
    if (!liveMode) return;
    const timer = window.setTimeout(() => {
      const defaults = currentMonthFilters();
      setFilters(defaults);
      void load(1, defaults);
    }, 0);
    return () => window.clearTimeout(timer);
    // Load once for the authenticated activity page; filter changes are submitted explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveMode]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void load(1, filters);
  }

  const exportUrl = useMemo(() => `/api/activity?${buildQuery(filters, 1).toString()}&format=csv`, [filters]);

  return <div className="panel activity-page-panel" id="activity">
    <div className="panel-heading"><div><div className="panel-title">Faoliyat tarixi</div><div className="panel-subtitle">{total} ta yozuv · qarz, to'lov va boshqa o'zgarishlar</div></div><a className="button button-secondary" href={exportUrl}><Download size={16} />CSV</a></div>
    <form className="activity-filters" onSubmit={submit}>
      <div className="activity-filter-search"><Search size={17} aria-hidden="true" /><input value={filters.q} onChange={(event) => setFilters({ ...filters, q: event.target.value })} placeholder="Mijoz, izoh yoki summa..." aria-label="Faoliyat qidirish" /></div>
      <div className="activity-filter-grid">
        <div className="field"><label htmlFor="activity-type">Turi</label><select id="activity-type" value={filters.eventType} onChange={(event) => setFilters({ ...filters, eventType: event.target.value })}>{Object.entries(eventLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></div>
        <div className="field"><label htmlFor="activity-customer">Mijoz</label><select id="activity-customer" value={filters.customerId} onChange={(event) => setFilters({ ...filters, customerId: event.target.value })}><option value="all">Barcha mijoz</option>{customers.map((customer) => <option value={customer.id} key={customer.id}>{customer.name}</option>)}</select></div>
        <div className="field"><label htmlFor="activity-from">Dan</label><input id="activity-from" type="date" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} /></div>
        <div className="field"><label htmlFor="activity-to">Gacha</label><input id="activity-to" type="date" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} /></div>
      </div>
      <div className="activity-filter-actions"><button className="button button-primary" type="submit" disabled={loading}><Filter size={16} />{loading ? "Yuklanmoqda..." : "Ko'rsatish"}</button>{(filters.q || filters.eventType !== "all" || filters.customerId !== "all" || filters.from || filters.to) && <button type="button" className="text-button" onClick={() => { const empty = { q: "", eventType: "all", customerId: "all", from: "", to: "" }; setFilters(empty); void load(1, empty); }} disabled={loading}>Filtrni tozalash</button>}</div>
    </form>
    {error && <div className="form-error" role="alert">{error}</div>}
    <div className="activity-list activity-full-list">{activities.length ? activities.map((activity) => <article className="activity-item" key={activity.id}><span className={`activity-dot ${activity.event_type}`} aria-hidden="true" /><div><div className="activity-text">{activity.description}</div><div className="activity-meta"><span>{activity.customers?.name || "Umumiy faoliyat"}</span><span>{eventLabels[activity.event_type] || activity.event_type}</span><span suppressHydrationWarning>{formatActivityDate(activity.created_at)}</span></div></div></article>) : <div className="empty compact"><Search size={26} /><strong>{liveMode ? "Faoliyat topilmadi." : "Supabase ulanishi kerak."}</strong><span>Filtrni o'zgartirib qayta urinib ko'ring.</span></div>}</div>
    {hasMore && <div className="activity-more"><button className="button button-secondary" onClick={() => void load(page + 1, filters, true)} disabled={loading}>{loading ? "Yuklanmoqda..." : "Ko'proq ko'rsatish"}</button></div>}
  </div>;
}
