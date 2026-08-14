export type CustomerStatus = "overdue" | "due-soon" | "on-track" | "paid";

export type DashboardCustomer = {
  id: string;
  name: string;
  phone: string;
  balance: number;
  dueDate: string | null;
  status: CustomerStatus;
  lastPayment: string | null;
};

export type DashboardStats = {
  totalOutstanding: number;
  collectedThisMonth: number;
  overdueAmount: number;
  activeCustomers: number;
};
