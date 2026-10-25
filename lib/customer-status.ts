import type { CustomerStatus } from "@/lib/types";

export function getCustomerStatus(balance: number, dueDate: string | null, now = Date.now()): CustomerStatus {
  if (balance <= 0) return "paid";
  if (!dueDate) return "on-track";

  // Shop aggregates use the UTC calendar day. Keep browser/SSR row status on
  // that same boundary; personal-book dates retain their separate Tokyo rule.
  const due = new Date(`${dueDate}T23:59:59.999Z`).getTime();
  const days = (due - now) / 86400000;
  if (days < 0) return "overdue";
  if (days <= 7) return "due-soon";
  return "on-track";
}
