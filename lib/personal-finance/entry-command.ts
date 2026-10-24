import type { PersonalEntryIntent } from "./entry-contract";

export type PersonalEntryReceipt = Readonly<{
  commandId: string;
  entries: readonly Readonly<{ entryId: string; revisionId: string; postingId: string; version: 1 }>[];
  balanceMinor: string;
  incomeMinor: string;
  expenseMinor: string;
  negativeBalance: boolean;
  replayed: boolean;
}>;
export type PersonalEntryCommandOutcome =
  | Readonly<{ kind: "saved"; receipt: PersonalEntryReceipt; clearIntent: true }>
  | Readonly<{ kind: "blocked" | "conflict" | "invalid" | "retry"; clearIntent: false }>;

const requestContextBrand: unique symbol = Symbol("personal-entry-request-context");
/**
 * Created when one exact RPC request is dispatched. The database result has no
 * client-key/owner/book echo, so the transport must retain this binding and
 * attach the same object to its eventual response envelope.
 */
export type PersonalEntryRequestContext = Readonly<{
  intent: PersonalEntryIntent;
  readonly [requestContextBrand]: true;
}>;
export type PersonalEntryResponseEnvelope = Readonly<{
  context: PersonalEntryRequestContext;
  status: number;
  value: unknown;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INTEGER = /^-?(?:0|[1-9][0-9]*)$/;
const MAX = BigInt("1000000000000");

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));
}

function receipt(value: unknown, entryCount: number, income: bigint, expense: bigint): PersonalEntryReceipt | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (!exactKeys(row, ["commandId", "entries", "balanceMinor", "incomeMinor", "expenseMinor", "negativeBalance", "replayed"])
    || typeof row.commandId !== "string" || !UUID.test(row.commandId) || !Array.isArray(row.entries)
    || row.entries.length !== entryCount || typeof row.balanceMinor !== "string" || !INTEGER.test(row.balanceMinor)
    || typeof row.incomeMinor !== "string" || !INTEGER.test(row.incomeMinor)
    || typeof row.expenseMinor !== "string" || !INTEGER.test(row.expenseMinor)
    || typeof row.negativeBalance !== "boolean" || typeof row.replayed !== "boolean") return null;
  if (BigInt(row.incomeMinor) !== income || BigInt(row.expenseMinor) !== expense
    || BigInt(row.balanceMinor) < -MAX || BigInt(row.balanceMinor) > MAX
    || row.negativeBalance !== (BigInt(row.balanceMinor) < BigInt(0))) return null;
  const seen = new Set<string>();
  const entries = row.entries.map(value => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const entry = value as Record<string, unknown>;
    if (!exactKeys(entry, ["entryId", "revisionId", "postingId", "version"])
      || typeof entry.entryId !== "string" || typeof entry.revisionId !== "string" || typeof entry.postingId !== "string"
      || !UUID.test(entry.entryId) || !UUID.test(entry.revisionId) || !UUID.test(entry.postingId)
      || entry.version !== 1 || seen.has(entry.entryId) || seen.has(entry.revisionId) || seen.has(entry.postingId)) return null;
    seen.add(entry.entryId); seen.add(entry.revisionId); seen.add(entry.postingId);
    return { entryId: entry.entryId, revisionId: entry.revisionId, postingId: entry.postingId, version: 1 as const };
  });
  if (entries.some(entry => entry === null)) return null;
  return {
    commandId: row.commandId, entries: entries as PersonalEntryReceipt["entries"], balanceMinor: row.balanceMinor,
    incomeMinor: row.incomeMinor, expenseMinor: row.expenseMinor, negativeBalance: row.negativeBalance, replayed: row.replayed,
  };
}

export function beginPersonalEntryRequest(intent: PersonalEntryIntent): PersonalEntryRequestContext {
  return Object.freeze({ intent, [requestContextBrand]: true });
}

/** Validates a database result's shape only; it cannot establish request correlation. */
export function parsePersonalEntryReceipt(intent: PersonalEntryIntent, status: number, value: unknown): PersonalEntryReceipt | null {
  if (status !== 200) return null;
  let income = BigInt(0), expense = BigInt(0);
  for (const entry of intent.command.entries) {
    if (entry.kind === "income") income += BigInt(entry.amountMinor);
    else expense += BigInt(entry.amountMinor);
  }
  return receipt(value, intent.command.entries.length, income, expense);
}

/**
 * Clears only after the caller pairs a response with the same in-flight
 * context it used for dispatch. This module does not send requests or infer
 * correlation from the database receipt, because that receipt has no echo.
 */
export function personalEntryCommandOutcome(expected: PersonalEntryRequestContext, response: PersonalEntryResponseEnvelope): PersonalEntryCommandOutcome {
  const retain = (kind: "blocked" | "conflict" | "invalid" | "retry"): PersonalEntryCommandOutcome => ({ kind, clearIntent: false });
  if (response.context !== expected) return retain("retry");
  if (response.status === 401 || response.status === 403) return retain("blocked");
  if (response.status === 409) return retain("conflict");
  if (response.status === 400) return retain("invalid");
  const checked = parsePersonalEntryReceipt(expected.intent, response.status, response.value);
  return checked ? { kind: "saved", receipt: checked, clearIntent: true } : retain("retry");
}
