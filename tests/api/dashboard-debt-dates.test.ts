import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/dashboard/route";
import { getDashboardData } from "@/lib/dashboard-data";
import { createClient } from "@/lib/supabase/server";
import { getAuthenticatedClient, requireShopPermission } from "@/lib/api/auth";
import type { CustomerDebt } from "@/lib/customer-debts";
import { summarizeCustomerDebts } from "@/lib/customer-debts";

vi.mock("@/lib/supabase/server", () => ({createClient: vi.fn()}));
vi.mock("@/lib/api/auth", () => ({getAuthenticatedClient: vi.fn(), requireShopPermission: vi.fn()}));
vi.mock("next/navigation", () => ({redirect: (target: string) => { throw new Error("redirect:" + target); }}));

function debt(principal: number, due_date: string | null, paid = 0, status = "active", voided = false) {
  return {principal, due_date, status, payments: paid ? [{amount: paid, paid_at: "2026-10-10T12:00:00Z", voided_at: voided ? "2026-10-11" : null}] : []};
}
function useCustomer(debts: CustomerDebt[]) {
  const {balance, dueDate} = summarizeCustomerDebts(debts);
  const collected = debts.filter(d => d.status !== "cancelled").flatMap(d => d.payments).filter(p => !p.voided_at).reduce((sum, p) => sum + Number(p.amount), 0);
  const customer = {id: "00000000-0000-0000-0000-000000000001", name: "QA", phone: "123", balance, due_date: dueDate, last_payment: collected ? "2026-10-10T12:00:00Z" : null, created_at: "2026-10-01T00:00:00Z"};
  const order = vi.fn(async () => ({data: [customer], error: null}));
  const from = vi.fn((table: string) => {
    if (table === "customers") return {select: () => ({eq: () => ({order})})};
    if (table === "activity_logs") return {select: () => ({eq: () => ({order: () => ({limit: async () => ({data: [], error: null})})})})};
    return {select: () => ({eq: () => ({maybeSingle: async () => ({data: table === "shops" ? {name: "QA shop"} : {}, error: null})})})};
  });
  const client = {auth: {getUser: async () => ({data: {user: {id: "owner"}}})},
    rpc: vi.fn((name: string) => {
      const value = {data: {shopId: "shop-1", summary: [customer], nextCursor: null, totals: {customers: 1, active: balance > 0 ? 1 : 0, outstanding: balance, overdue: dueDate && dueDate < "2026-10-19" ? balance : 0, collectedThisMonth: collected}}, error: null};
      return name === "shop_dashboard_page" ? {abortSignal: async () => value} : Promise.resolve({data: name === "get_current_shop_id" ? "shop-1" : true, error: null});
    }), from};
  vi.mocked(createClient).mockResolvedValue(client as never);
  vi.mocked(getAuthenticatedClient).mockResolvedValue({supabase: client as never, user: {id: "owner"} as never});
  return customer;
}
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-19T12:00:00Z"));
  vi.mocked(requireShopPermission).mockResolvedValue({ok: true, shopId: "shop-1"});
});
afterEach(() => vi.useRealTimers());

describe("SSR and dashboard API unpaid-deadline regression", () => {
  const cases = [
    {name: "paid historical debt + future debt", debts: [debt(100, "2026-09-01", 100, "paid"), debt(200, "2026-12-01")], balance: 200, dueDate: "2026-12-01", status: "on-track", collected: 100},
    {name: "settled debt still marked active", debts: [debt(100, "2026-09-01", 100), debt(200, "2026-12-01")], balance: 200, dueDate: "2026-12-01", status: "on-track", collected: 100},
    {name: "partially paid historical debt", debts: [debt(100, "2026-09-01", 40), debt(200, "2026-12-01")], balance: 260, dueDate: "2026-09-01", status: "overdue", collected: 40},
    {name: "cancelled historical debt", debts: [debt(100, "2026-09-01", 0, "cancelled"), debt(200, "2026-12-01")], balance: 200, dueDate: "2026-12-01", status: "on-track", collected: 0},
    {name: "all debts settled", debts: [debt(100, "2026-09-01", 100, "paid")], balance: 0, dueDate: null, status: "paid", collected: 100},
    {name: "new debt without deadline", debts: [debt(100, "2026-09-01", 100, "paid"), debt(200, null)], balance: 200, dueDate: null, status: "on-track", collected: 100},
    {name: "voided payment restores old deadline", debts: [debt(100, "2026-09-01", 100, "paid", true), debt(200, "2026-12-01")], balance: 300, dueDate: "2026-09-01", status: "overdue", collected: 0},
  ];
  it.each(cases)("$name stays consistent across both read paths", async scenario => {
    useCustomer(scenario.debts);
    const page = await getDashboardData();
    expect(page.initialCustomers[0]).toMatchObject({balance: scenario.balance, dueDate: scenario.dueDate, status: scenario.status});
    expect(page.initialStats).toMatchObject({totalOutstanding: scenario.balance, overdueAmount: scenario.status === "overdue" ? scenario.balance : 0, collectedThisMonth: scenario.collected});
    expect(page.initialCustomers[0].lastPayment).toBe(scenario.collected ? "2026-10-10T12:00:00Z" : null);
    const response = await GET(new Request("http://localhost/api/dashboard"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({summary: [{balance: scenario.balance, due_date: scenario.dueDate}], totals: {outstanding: scenario.balance}});
  });
  it("keeps the dashboard API authentication guard", async () => {
    vi.mocked(getAuthenticatedClient).mockResolvedValue({supabase: null, user: null});
    expect((await GET(new Request("http://localhost/api/dashboard"))).status).toBe(401);
    expect(requireShopPermission).not.toHaveBeenCalled();
  });
});
