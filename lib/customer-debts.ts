export type CustomerDebt = {
  principal: number | string;
  due_date: string | null;
  status: string;
  payments: ReadonlyArray<{ amount: number | string; voided_at: string | null }>;
};

/** Use actual non-voided payments, not a cached debt status, for the balance.
 * Settled and cancelled debts cannot supply the next outstanding due date.
 */
export function summarizeCustomerDebts(debts: ReadonlyArray<CustomerDebt>) {
  let balance = 0;
  let dueDate: string | null = null;
  for (const debt of debts) {
    if (debt.status === "cancelled") continue;
    const paid = debt.payments.reduce((sum, payment) => sum + (payment.voided_at ? 0 : Number(payment.amount)), 0);
    const remaining = Math.max(Number(debt.principal) - paid, 0);
    balance += remaining;
    if (remaining > 0 && debt.due_date && (dueDate === null || debt.due_date < dueDate)) dueDate = debt.due_date;
  }
  return { balance, dueDate };
}
