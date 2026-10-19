import { localDate } from "./accounts";
import { parseMinorAmount } from "./money";

export const BOOK_TIME_ZONE = "Asia/Tokyo";
export type BookCommand = { openingAmountMinor: string; openingDate: string };
export type PendingBook = { clientKey: string; command: BookCommand };
export type BookView = { state: "empty" | "legacy_setup_required" | "ready";
  book?: { id: string; name: string; status: "active" | "archived"; currencyCode: "JPY";
    scale: 0; balanceMinor: string; timeZone: string; defaultPaymentMethod: "cash"; defaultEntryKind: "expense" } };

export function initialBookCommand(): BookCommand {
  return { openingAmountMinor: "0", openingDate: localDate(BOOK_TIME_ZONE) };
}

export function shouldClearPendingBook(hadUnknownOutcome: boolean, status: number, code: unknown): boolean {
  // These conflicts are raised only after checking the original receipt, so
  // they prove this exact request did not initialize a book. Generic conflicts
  // or lost permission do not prove that about an earlier unknown outcome.
  return (status === 409 && (code === "BOOK_EXISTS" || code === "LEGACY_SETUP_REQUIRED"))
    || (!hadUnknownOutcome && status >= 400 && status < 500);
}

export function parsePendingBook(raw: string): PendingBook {
  if (raw.length > 2048) throw new Error("Invalid pending book");
  const pending = JSON.parse(raw) as PendingBook;
  if (!pending || typeof pending !== "object" || Array.isArray(pending)
    || Object.keys(pending).some(key => !["clientKey", "command"].includes(key))
    || typeof pending.clientKey !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(pending.clientKey)
    || !pending.command || typeof pending.command !== "object" || Array.isArray(pending.command)
    || Object.keys(pending.command).some(key => !["openingAmountMinor", "openingDate"].includes(key))
    || typeof pending.command.openingAmountMinor !== "string"
    || typeof pending.command.openingDate !== "string"
    || !/^\d{4}-\d{2}-\d{2}$/.test(pending.command.openingDate)) throw new Error("Invalid pending book");
  parseMinorAmount(pending.command.openingAmountMinor, { scale: 0, maxAbsMinor: BigInt("1000000000000") });
  return pending;
}
