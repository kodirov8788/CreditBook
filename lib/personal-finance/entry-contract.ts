/**
 * Exact client-side shape for public.create_personal_entries(jsonb, uuid).
 * This is transport validation only; the SECURITY DEFINER function remains
 * authoritative for the active workspace, book, account and categories.
 */
export type PersonalEntryKind = "income" | "expense";
export type PersonalEntryItem = Readonly<{
  kind: PersonalEntryKind;
  amountMinor: string;
  currencyCode: "JPY";
  categoryId: string;
  effectiveDate: string;
  note?: string;
}>;
export type PersonalEntryCommand = Readonly<{ entries: readonly PersonalEntryItem[] }>;
export type PersonalEntryIntent = Readonly<{
  ownerId: string;
  bookId: string;
  clientKey: string;
  command: PersonalEntryCommand;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLIENT_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_AMOUNT = BigInt("1000000000000");
const invalid = () => new Error("INVALID_PERSONAL_ENTRY_INTENT");

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) throw invalid();
}

function validUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function canonicalUuid(value: unknown): string {
  if (!validUuid(value)) throw invalid();
  return value.toLowerCase();
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (year < 1 || year > 9999 || month < 1 || month > 12) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= days[month - 1];
}

function validNote(value: unknown): value is string {
  if (typeof value !== "string" || [...value].length > 2000) return false;
  return [...value].every(char => {
    const code = char.codePointAt(0)!;
    return (code >= 32 || code === 9 || code === 10 || code === 13)
      && (code < 128 || code > 159) && !(code >= 0xd800 && code <= 0xdfff);
  });
}

function item(value: unknown): PersonalEntryItem {
  const row = object(value);
  const keys = row.note === undefined ? ["kind", "amountMinor", "currencyCode", "categoryId", "effectiveDate"]
    : ["kind", "amountMinor", "currencyCode", "categoryId", "effectiveDate", "note"];
  exactKeys(row, keys);
  if ((row.kind !== "income" && row.kind !== "expense") || typeof row.amountMinor !== "string"
    || !/^[1-9][0-9]{0,12}$/.test(row.amountMinor) || BigInt(row.amountMinor) > MAX_AMOUNT
    || row.currencyCode !== "JPY" || !validUuid(row.categoryId) || !validDate(row.effectiveDate)
    || (row.note !== undefined && !validNote(row.note))) throw invalid();
  return Object.freeze({
    kind: row.kind, amountMinor: row.amountMinor, currencyCode: "JPY",
    categoryId: row.categoryId, effectiveDate: row.effectiveDate,
    ...(row.note === undefined ? {} : { note: row.note }),
  });
}

function postgresJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(postgresJson).join(", ")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .map(([key, child]) => `${JSON.stringify(key)}: ${postgresJson(child)}`).join(", ")}}`;
  }
  return JSON.stringify(value);
}

export function createPersonalEntryCommand(value: unknown): PersonalEntryCommand {
  const row = object(value);
  exactKeys(row, ["entries"]);
  if (!Array.isArray(row.entries) || row.entries.length < 1 || row.entries.length > 100) throw invalid();
  const command = Object.freeze({ entries: Object.freeze(row.entries.map(item)) });
  // PostgreSQL checks octet_length(p_command::text), whose jsonb rendering
  // includes one space after separators. Object key order has no byte effect.
  if (new TextEncoder().encode(postgresJson(command)).byteLength > 65536) throw invalid();
  return command;
}

export function createPersonalEntryIntent(ownerId: unknown, bookId: unknown, clientKey: unknown, value: unknown): PersonalEntryIntent {
  const checkedOwner = canonicalUuid(ownerId);
  const checkedBook = canonicalUuid(bookId);
  if (typeof clientKey !== "string" || !CLIENT_KEY.test(clientKey)) throw invalid();
  return Object.freeze({ ownerId: checkedOwner, bookId: checkedBook, clientKey, command: createPersonalEntryCommand(value) });
}

export function restorePersonalEntryIntent(raw: string, expectedOwnerId: string, expectedBookId: string): PersonalEntryIntent {
  if (typeof raw !== "string" || new TextEncoder().encode(raw).byteLength > 131072) throw invalid();
  const saved = object(JSON.parse(raw));
  exactKeys(saved, ["ownerId", "bookId", "clientKey", "command"]);
  if (canonicalUuid(saved.ownerId) !== canonicalUuid(expectedOwnerId)
    || canonicalUuid(saved.bookId) !== canonicalUuid(expectedBookId)) throw invalid();
  return createPersonalEntryIntent(saved.ownerId, saved.bookId, saved.clientKey, saved.command);
}

/** Owner and selected book must come from live authenticated state, never storage. */
export function personalEntryCommandPayload(intent: PersonalEntryIntent, activeOwnerId: string, activeBookId: string) {
  if (canonicalUuid(intent.ownerId) !== canonicalUuid(activeOwnerId)
    || canonicalUuid(intent.bookId) !== canonicalUuid(activeBookId)) throw invalid();
  const checked = createPersonalEntryIntent(intent.ownerId, intent.bookId, intent.clientKey, intent.command);
  return Object.freeze({ clientKey: checked.clientKey, command: checked.command });
}
