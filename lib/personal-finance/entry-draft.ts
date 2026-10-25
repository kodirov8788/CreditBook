import { createPersonalEntryCommand, createPersonalEntryIntent, restorePersonalEntryIntent, type PersonalEntryCommand, type PersonalEntryIntent } from "./entry-contract";
import { localDate } from "./accounts";
import { BOOK_TIME_ZONE } from "./book";

export type PersonalEntryJournal = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type PersonalEntryDraft = Readonly<{ command: PersonalEntryCommand }>;

/** New manual rows start from the book's calendar day, never the browser's UTC day. */
export function initialPersonalEntryDate(): string {
  return localDate(BOOK_TIME_ZONE);
}

/** A draft stays editable until this conversion freezes a pending command. */
export function editPersonalEntryDraft(value: unknown): PersonalEntryDraft {
  return Object.freeze({ command: createPersonalEntryCommand(value) });
}

export function confirmPersonalEntryDraft(ownerId: unknown, bookId: unknown, clientKey: unknown, draft: PersonalEntryDraft): PersonalEntryIntent {
  return createPersonalEntryIntent(ownerId, bookId, clientKey, draft.command);
}

export function personalEntryJournalKey(ownerId: string, bookId: string): string {
  const intent = createPersonalEntryIntent(ownerId, bookId, "00000000-0000-4000-8000-000000000000", {
    entries: [{ kind: "income", amountMinor: "1", currencyCode: "JPY", categoryId: bookId, effectiveDate: "2000-01-01" }],
  });
  return `creditbook:personal-entry-command:v1:${intent.ownerId}:${intent.bookId}`;
}

function same(a: PersonalEntryIntent, b: PersonalEntryIntent): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function readPersonalEntryJournal(storage: PersonalEntryJournal, ownerId: string, bookId: string): PersonalEntryIntent | null {
  const raw = storage.getItem(personalEntryJournalKey(ownerId, bookId));
  return raw === null ? null : restorePersonalEntryIntent(raw, ownerId, bookId);
}

/** One unresolved batch per owner and active book; this is not an offline queue. */
export function stagePersonalEntryJournal(storage: PersonalEntryJournal, intent: PersonalEntryIntent): PersonalEntryIntent {
  const checked = createPersonalEntryIntent(intent.ownerId, intent.bookId, intent.clientKey, intent.command);
  const existing = readPersonalEntryJournal(storage, checked.ownerId, checked.bookId);
  if (existing && !same(existing, checked)) throw new Error("PERSONAL_ENTRY_INTENT_PENDING");
  if (!existing) storage.setItem(personalEntryJournalKey(checked.ownerId, checked.bookId), JSON.stringify(checked));
  const persisted = readPersonalEntryJournal(storage, checked.ownerId, checked.bookId);
  if (!persisted || !same(persisted, checked)) throw new Error("PERSONAL_ENTRY_JOURNAL_UNAVAILABLE");
  return persisted;
}

/**
 * This unmounted storage primitive has no response provenance. Call it only
 * after a matching PersonalEntryRequestContext outcome, or an explicit user
 * discard decision; it does not validate either condition itself.
 */
export function removePersonalEntryJournal(storage: PersonalEntryJournal, intent: PersonalEntryIntent): boolean {
  const current = readPersonalEntryJournal(storage, intent.ownerId, intent.bookId);
  if (!current || !same(current, intent)) return false;
  storage.removeItem(personalEntryJournalKey(intent.ownerId, intent.bookId));
  return storage.getItem(personalEntryJournalKey(intent.ownerId, intent.bookId)) === null;
}
