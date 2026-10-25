import { describe, expect, it } from "vitest";
import { summarizeCustomerDebts, type CustomerDebt } from "@/lib/customer-debts";

function debt(overrides: Partial<CustomerDebt> = {}): CustomerDebt {
  return {principal: 100, due_date: "2026-09-01", status: "active", payments: [], ...overrides};
}
describe("outstanding customer debt projection", () => {
  it("ignores a fully paid historic due date when a future debt remains", () => {
    expect(summarizeCustomerDebts([
      debt({status: "paid", payments: [{amount: 100, voided_at: null}]}),
      debt({principal: 200, due_date: "2026-12-01"}),
    ])).toEqual({balance: 200, dueDate: "2026-12-01"});
  });
  it("ignores settled debt even when its cached status still says active", () => {
    expect(summarizeCustomerDebts([debt({payments: [{amount: 100, voided_at: null}]})])).toEqual({balance: 0, dueDate: null});
  });
  it("keeps the old due date while a partial balance remains", () => {
    expect(summarizeCustomerDebts([debt({payments: [{amount: 40, voided_at: null}]}), debt({due_date: "2026-12-01"})])).toEqual({balance: 160, dueDate: "2026-09-01"});
  });
  it("restores a debt after its payment is voided, regardless of cached status", () => {
    expect(summarizeCustomerDebts([debt({status: "paid", payments: [{amount: 100, voided_at: "2026-10-01"}]})])).toEqual({balance: 100, dueDate: "2026-09-01"});
  });
  it("ignores cancelled debts and overpaid settled debts", () => {
    expect(summarizeCustomerDebts([debt({status: "cancelled"}), debt({payments: [{amount: 120, voided_at: null}]}), debt({due_date: "2026-12-01"})])).toEqual({balance: 100, dueDate: "2026-12-01"});
  });
  it("does not inherit a paid debt's deadline for a new undated debt", () => {
    expect(summarizeCustomerDebts([debt({payments: [{amount: 100, voided_at: null}]}), debt({due_date: null})])).toEqual({balance: 100, dueDate: null});
  });
  it("selects earliest unpaid deadline independently of row order", () => {
    const input = [debt({due_date: "2026-12-20"}), debt({due_date: null}), debt({due_date: "2026-12-01"})];
    const original = structuredClone(input);
    expect(summarizeCustomerDebts(input)).toEqual({balance: 300, dueDate: "2026-12-01"});
    expect(input).toEqual(original);
  });
  it("supports existing numeric-string transport and multiple live payments", () => {
    expect(summarizeCustomerDebts([debt({principal: "100", payments: [{amount: "60", voided_at: null}, {amount: "40", voided_at: null}]})])).toEqual({balance: 0, dueDate: null});
    expect(summarizeCustomerDebts([])).toEqual({balance: 0, dueDate: null});
  });
});
