import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refreshDashboardDebts } from "@/lib/dashboard-debt-refresh";

const row = {id: "customer-1", balance: 200, due_date: "2026-12-01", last_payment: null};
const response = (body: unknown, status = 200) => vi.fn<typeof fetch>(async () => {
  // Mock DB aggregate envelope; real calculation is covered by the SQL suite.
  if (body && typeof body === "object" && "summary" in body && Array.isArray(body.summary) && !("totals" in body)) {
    const summary = body.summary as typeof row[];
    body = {...body, totals: {customers: summary.length, active: summary.filter(r => r.balance > 0).length, outstanding: summary.reduce((sum, r) => sum + r.balance, 0), overdue: summary.filter(r => r.due_date && r.due_date < "2026-10-19").reduce((sum, r) => sum + r.balance, 0), collectedThisMonth: 0}};
  }
  return new Response(JSON.stringify(body), {status});
});
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-19T12:00:00Z")); });
afterEach(() => vi.useRealTimers());
describe("post-mutation dashboard refresh (mocked network)", () => {
  it("uses one GET and updates the paid-old/future-new projection and overdue totals", async () => {
    const send = response({summary: [row]});
    expect(await refreshDashboardDebts(send)).toEqual({summary: [{id: row.id, balance: 200, dueDate: row.due_date, status: "on-track", lastPayment: null}], totalOutstanding: 200, activeCustomers: 1, overdueAmount: 0, collectedThisMonth: 0});
    expect(send).toHaveBeenCalledExactlyOnceWith("/api/dashboard", expect.objectContaining({method: "GET", cache: "no-store"}));
  });
  it("still includes genuinely overdue and partially paid customers", async () => {
    const result = await refreshDashboardDebts(response({summary: [row, {...row, id: "overdue", balance: 60, due_date: "2026-09-01"}, {...row, id: "paid", balance: 0, due_date: null}]}));
    expect(result).toMatchObject({totalOutstanding: 260, overdueAmount: 60, activeCustomers: 2});
    expect(result.summary[2].status).toBe("paid");
  });
  it("a failed refresh never retries or resubmits the already-saved payment", async () => {
    const send = response({error: "unavailable"}, 503);
    await expect(refreshDashboardDebts(send)).rejects.toThrow();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][1]?.method).toBe("GET");
  });
  it("network failure is surfaced without another request", async () => {
    const send = vi.fn<typeof fetch>(async () => { throw new Error("offline"); });
    await expect(refreshDashboardDebts(send)).rejects.toThrow("offline");
    expect(send).toHaveBeenCalledTimes(1);
  });
  it.each([null, {}, {summary: null}, {summary: [{...row, balance: "200"}]}, {summary: [{...row, balance: -1}]}, {summary: [row, row]}, {summary: [{...row, due_date: "bad"}]}])("rejects invalid projection rather than displaying false totals %j", async body => {
    await expect(refreshDashboardDebts(response(body))).rejects.toThrow();
  });
  it("accepts an empty customer list", async () => {
    expect(await refreshDashboardDebts(response({summary: []}))).toEqual({summary: [], totalOutstanding: 0, overdueAmount: 0, activeCustomers: 0, collectedThisMonth: 0});
  });
  it("refreshing after latest-payment void replaces the last-payment timestamp, including null", async () => {
    const previous = "2026-10-01T10:00:00Z";
    expect((await refreshDashboardDebts(response({summary: [{...row, last_payment: previous}]}))).summary[0].lastPayment).toBe(previous);
    expect((await refreshDashboardDebts(response({summary: [row]}))).summary[0].lastPayment).toBeNull();
  });
});
