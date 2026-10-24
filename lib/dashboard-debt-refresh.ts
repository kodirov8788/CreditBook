import { getCustomerStatus } from "./customer-status";
import type { CustomerStatus } from "./types";
import type { ShopDashboardTotals } from "./shop-read-model";

type DebtProjection = {id: string; balance: number; dueDate: string | null; status: CustomerStatus; lastPayment: string | null};

/** Read-after-write only. Failure must never replay the financial mutation. */
export async function refreshDashboardDebts(request: typeof fetch = fetch) {
  const response = await request("/api/dashboard", {method: "GET", cache: "no-store", signal: AbortSignal.timeout(20000)});
  if (!response.ok) throw new Error("Qoldiq va muddatlar yangilanmadi.");
  const body: unknown = await response.json();
  if (!body || typeof body !== "object" || !("summary" in body) || !Array.isArray(body.summary)) throw new Error("Dashboard javobi noto‘g‘ri.");
  const ids = new Set<string>();
  const summary: DebtProjection[] = body.summary.map((row: unknown) => {
    if (!row || typeof row !== "object" || !("id" in row) || typeof row.id !== "string" || ids.has(row.id)
      || !("balance" in row) || typeof row.balance !== "number" || !Number.isFinite(row.balance) || row.balance < 0
      || !("due_date" in row) || (row.due_date !== null && (typeof row.due_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(row.due_date)))) throw new Error("Dashboard javobi noto‘g‘ri.");
    ids.add(row.id);
    if (!("last_payment" in row) || (row.last_payment !== null && (typeof row.last_payment !== "string" || !Number.isFinite(Date.parse(row.last_payment))))) throw new Error("Oxirgi to‘lov javobi noto‘g‘ri.");
    return {id: row.id, balance: row.balance, dueDate: row.due_date, status: getCustomerStatus(row.balance, row.due_date), lastPayment: row.last_payment};
  });
  if (!("totals" in body) || !body.totals || typeof body.totals !== "object") throw new Error("Dashboard jami olinmadi.");
  const totals = body.totals as ShopDashboardTotals;
  for (const value of [totals.outstanding, totals.active, totals.overdue, totals.collectedThisMonth]) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error("Dashboard jami noto‘g‘ri.");
  }
  if (totals.customers !== summary.length || !Number.isSafeInteger(totals.active)) throw new Error("Dashboard ro‘yxati to‘liq emas.");
  return {
    summary,
    totalOutstanding: totals.outstanding,
    activeCustomers: totals.active,
    overdueAmount: totals.overdue,
    collectedThisMonth: totals.collectedThisMonth,
  };
}
