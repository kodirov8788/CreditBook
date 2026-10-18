import type { CurrencyCode } from "./types";

export type AccountView = { id: string; name: string; icon: string; color: string; currencyCode: CurrencyCode;
  scale: number; status: "active" | "archived"; includeInTotal: boolean; version: number; balanceMinor: string };
export type AccountsView = { accounts: AccountView[];
  totals: { currencyCode: CurrencyCode; scale: number; includedMinor: string; archivedMinor: string }[];
  preferences: { defaultAccountId: string | null; timeZone: string; version: number } | null;
  paginationLimitReached?: boolean; nextOffset: number | null };

export function localDate(timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const part = (name: string) => parts.find(p => p.type === name)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function displayMoney(amountMinor: string, scale: number): string {
  const negative = amountMinor.startsWith("-");
  const digits = (negative ? amountMinor.slice(1) : amountMinor).padStart(scale + 1, "0");
  const whole = (scale ? digits.slice(0, -scale) : digits).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const fraction = scale ? digits.slice(-scale) : "";
  return `${negative ? "−" : ""}${whole}${fraction && /[1-9]/.test(fraction) ? "." + fraction : ""}`;
}
