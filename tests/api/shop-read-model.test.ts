import { describe, expect, it, vi } from "vitest";
import { readShopDashboard, readShopReport, validReportDate } from "@/lib/shop-read-model";
import { refreshDashboardDebts } from "@/lib/dashboard-debt-refresh";
import type { SupabaseClient } from "@supabase/supabase-js";
import { GET as getDashboard } from "@/app/api/dashboard/route";
import { GET as getReport } from "@/app/api/reports/route";
import { getAuthenticatedClient, requireShopPermission } from "@/lib/api/auth";
import { NextResponse } from "next/server";
vi.mock("@/lib/api/auth", () => ({getAuthenticatedClient: vi.fn(), requireShopPermission: vi.fn()}));

const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const customer = (n: number) => ({id: id(n), name: "QA", phone: null, balance: 0.1, due_date: null, last_payment: null, created_at: "2026-10-01T00:00:00Z"});
const totals = {customers: 1105, active: 1105, outstanding: 110.5, overdue: 0, collectedThisMonth: 999.25};
function client(pages: unknown[]) {
  let index = 0;
  const rpc = vi.fn(() => ({abortSignal: vi.fn(async () => ({data: pages[index++], error: null}))}));
  return {rpc, supabase: {rpc} as unknown as SupabaseClient};
}
const dashboardPage = (summary: unknown[], nextCursor: string | null, count = totals.customers) => ({shopId: "shop-1", summary, nextCursor, totals: {...totals, customers: count}});
const expense = (n: number) => ({id: id(n), category: "QA", amount: 0.1, spent_at: "2026-10-19", vendor: null, note: null, payment_method: "cash", voided_at: null, void_reason: null, created_at: "2026-10-19T00:00:00Z"});
const report = {from: null, to: null, newCredits: 999, collected: 222, expensesTotal: 110.5, netCashflow: 111.5, outstanding: 777, overdueAmount: 4, overdueCount: 1, activeCustomers: 1105, monthly: [{month: "2026-10", credits: 999, collected: 222, expenses: 110.5, netCashflow: 111.5}]};
describe("complete paginated SQL read contracts (mocked RPC transport)", () => {
  it("reads beyond 1000 customers and uses database totals, not JS floating-point page sums", async () => {
    const pages = Array.from({length: 2}, (_, page) => {
      const end = Math.min((page + 1) * 1000, 1105);
      return dashboardPage(Array.from({length: end - page * 1000}, (_, i) => customer(page * 1000 + i + 1)), end < 1105 ? id(end) : null);
    });
    const {rpc, supabase} = client(pages);
    const result = await readShopDashboard(supabase, "shop-1");
    expect(result.summary).toHaveLength(1105);
    expect(new Set(result.summary.map(r => r.id)).size).toBe(1105);
    expect(result.totals).toEqual(totals);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[0]).toEqual(["shop_dashboard_page", {p_after: null, p_limit: 1000}]);
    expect(rpc.mock.calls[1]).toEqual(["shop_dashboard_page", {p_after: id(1000), p_limit: 1000}]);
  });
  it("reads all expense pages while retaining global and monthly aggregates", async () => {
    const pages = Array.from({length: 2}, (_, p) => ({shopId: "shop-1", expenseCount: 1105, nextCursor: p === 0 ? id(1000) : null,
      report: {...report, expenses: Array.from({length: p === 0 ? 1000 : 105}, (_, i) => expense(p * 1000 + i + 1))}}));
    const {rpc, supabase} = client(pages);
    const result = await readShopReport(supabase, "shop-1", null, null);
    expect(result.expenses).toHaveLength(1105);
    expect(result).toMatchObject(report);
    expect(rpc).toHaveBeenCalledTimes(2);
  });
  it("empty tenant returns verified zeros, not missing data", async () => {
    const zero = {customers: 0, active: 0, outstanding: 0, overdue: 0, collectedThisMonth: 0};
    expect(await readShopDashboard(client([{shopId: "shop-1", summary: [], nextCursor: null, totals: zero}]).supabase, "shop-1")).toEqual({summary: [], totals: zero});
  });
  it.each([1000, 2105])("reads %i customers with bounded pages and no unnecessary final call", async total => {
    const pages = Array.from({length: Math.ceil(total / 1000)}, (_, page) => {
      const end = Math.min((page + 1) * 1000, total);
      return dashboardPage(Array.from({length: end - page * 1000}, (_, i) => customer(page * 1000 + i + 1)), end < total ? id(end) : null, total);
    });
    const {rpc, supabase} = client(pages);
    expect((await readShopDashboard(supabase, "shop-1")).summary).toHaveLength(total);
    expect(rpc).toHaveBeenCalledTimes(Math.ceil(total / 1000));
  });
  it("rejects an oversized server page rather than silently accepting it", async () => {
    const page = dashboardPage(Array.from({length: 1001}, (_, i) => customer(i + 1)), null, 1001);
    await expect(readShopDashboard(client([page]).supabase, "shop-1")).rejects.toThrow();
  });
  it.each([
    [dashboardPage([customer(1)], null, 2)],
    [dashboardPage([customer(1), customer(1)], null, 2)],
    [{...dashboardPage([customer(1)], null, 1), shopId: "other-shop"}],
    [{...dashboardPage([customer(1)], null, 1), nextCursor: id(1)}],
    [{...dashboardPage([customer(1)], null, 1), totals: {...totals, customers: 1, outstanding: null}}],
    [dashboardPage([customer(1)], id(1), 2), dashboardPage([customer(2)], null, 3)],
    [dashboardPage([customer(1)], id(1), 2), dashboardPage([customer(1)], null, 2)],
    [dashboardPage([customer(1)], id(1), 2), null],
  ])("fails closed on incomplete, duplicate, stale, wrong-tenant or malformed pages %#", async (...pages) => {
    await expect(readShopDashboard(client(pages).supabase, "shop-1")).rejects.toThrow();
  });
  it("later RPC errors never return the successful first page", async () => {
    const rpc = vi.fn().mockReturnValueOnce({abortSignal: async () => ({data: dashboardPage([customer(1)], id(1), 2), error: null})}).mockReturnValueOnce({abortSignal: async () => ({data: null, error: {message: "offline"}})});
    await expect(readShopDashboard({rpc} as unknown as SupabaseClient, "shop-1")).rejects.toThrow();
  });
  it("changed report totals between pages are rejected, not mixed", async () => {
    const {supabase} = client([
      {shopId: "shop-1", expenseCount: 2, nextCursor: id(1), report: {...report, expenses: [expense(1)]}},
      {shopId: "shop-1", expenseCount: 2, nextCursor: null, report: {...report, collected: 333, expenses: [expense(2)]}},
    ]);
    await expect(readShopReport(supabase, "shop-1", null, null)).rejects.toThrow();
  });
  it("post-write refresh preserves precise DB aggregates", async () => {
    const summary = Array.from({length: 1105}, (_, n) => customer(n + 1));
    const send = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({summary, totals})));
    expect(await refreshDashboardDebts(send)).toMatchObject({totalOutstanding: 110.5, collectedThisMonth: 999.25, activeCustomers: 1105});
  });
  it.each(["2026-02-30", "2026-13-01", "yesterday", "2026-1-01", "2026-10-19T00:00:00Z"])("rejects invalid report date %s", value => expect(validReportDate(value)).toBe(false));
  it.each([null, "2026-10-19", "2024-02-29"])("accepts valid report date %s", value => expect(validReportDate(value)).toBe(true));
  it.each(["from=2026-02-30", "from=2026-10-20&to=2026-10-19", "to=bad"])("report API rejects invalid dates before any data query %s", async params => {
    const {supabase, rpc} = client([]);
    vi.mocked(getAuthenticatedClient).mockResolvedValue({supabase, user: {id: "QA"} as never});
    vi.mocked(requireShopPermission).mockResolvedValue({ok: true, shopId: "shop-1"});
    expect((await getReport(new Request(`http://localhost/api/reports?${params}`))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("dashboard API returns an error, never partial totals, when a later page fails", async () => {
    const {supabase} = client([dashboardPage([customer(1)], id(1), 2), null]);
    vi.mocked(getAuthenticatedClient).mockResolvedValue({supabase, user: {id: "QA"} as never});
    vi.mocked(requireShopPermission).mockResolvedValue({ok: true, shopId: "shop-1"});
    const result = await getDashboard(new Request("http://localhost/api/dashboard"));
    expect(result.status).toBe(500);
    expect(await result.json()).not.toHaveProperty("summary");
  });
  it.each([getDashboard, getReport])("keeps role rejection before querying aggregate RPC", async handler => {
    const {supabase, rpc} = client([]);
    vi.mocked(getAuthenticatedClient).mockResolvedValue({supabase, user: {id: "QA"} as never});
    vi.mocked(requireShopPermission).mockResolvedValue({ok: false, response: NextResponse.json({error: "Denied"}, {status: 403})});
    expect((await handler(new Request("http://localhost/api/QA"))).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });
});
