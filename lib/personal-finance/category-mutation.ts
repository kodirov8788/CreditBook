import {
  categoryCommandOutcome, categoryCommandPayload, createCategoryIntent,
  restoreCategoryIntent, type CategoryCommandOutcome, type CategoryIntent,
} from "./category-command";

// A single unresolved command per owner/tab. This is NOT the durable offline queue.
export type CategoryJournal = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type CategoryAuth = {
  getSession(): Promise<{ data: { session: { access_token: string } | null }; error: unknown }>;
  getUser(token: string): Promise<{ data: { user: { id: string } | null }; error: unknown }>;
};
export type CategoryMutationResult = CategoryCommandOutcome | Readonly<{ kind: "storage" | "busy"; clearIntent: false }>;

export function categoryJournalKey(ownerId: string) {
  // Reuse the UUID validator without trusting this metadata as authentication.
  const checked = createCategoryIntent(ownerId, "00000000-0000-4000-8000-000000000000", { operation: "create", name: "_" });
  return `creditbook:category-command:v1:${checked.ownerId}`;
}
export function readCategoryJournal(storage: CategoryJournal, ownerId: string): CategoryIntent | null {
  const raw = storage.getItem(categoryJournalKey(ownerId));
  return raw === null ? null : restoreCategoryIntent(raw, ownerId);
}
function same(a: CategoryIntent, b: CategoryIntent) { return JSON.stringify(a) === JSON.stringify(b); }
export function stageCategoryJournal(storage: CategoryJournal, intent: CategoryIntent): CategoryIntent {
  const checked = createCategoryIntent(intent.ownerId, intent.clientKey, intent.command);
  const existing = readCategoryJournal(storage, checked.ownerId);
  if (existing && !same(existing, checked)) throw new Error("CATEGORY_INTENT_PENDING");
  if (!existing) storage.setItem(categoryJournalKey(checked.ownerId), JSON.stringify(checked));
  const persisted = readCategoryJournal(storage, checked.ownerId);
  if (!persisted || !same(persisted, checked)) throw new Error("CATEGORY_JOURNAL_UNAVAILABLE");
  return persisted;
}
/** Call only for a validated acknowledgement or explicit user-confirmed discard. */
export function removeCategoryJournal(storage: CategoryJournal, intent: CategoryIntent): boolean {
  const current = readCategoryJournal(storage, intent.ownerId);
  if (!current || !same(current, intent)) return false;
  storage.removeItem(categoryJournalKey(intent.ownerId));
  return storage.getItem(categoryJournalKey(intent.ownerId)) === null;
}

const inFlight = new WeakMap<CategoryJournal, Set<string>>();
const retain = (kind: "retry" | "blocked" | "storage" | "busy"): CategoryMutationResult => ({ kind, clearIntent: false });

/** Capture and remotely verify ONE token, then use exactly that token for POST.
 * No cookie fallback, automatic retries or token persistence. API + DB remain
 * authoritative for current pilot eligibility and ownership.
 */
export async function submitCategoryMutation(options: {
  intent: CategoryIntent; storage: CategoryJournal; auth: CategoryAuth;
  request?: typeof fetch; signal?: AbortSignal; ownerSignal?: AbortSignal;
}): Promise<CategoryMutationResult> {
  const { storage, auth, signal, ownerSignal } = options;
  if (ownerSignal?.aborted) return retain("blocked");
  const request = options.request ?? fetch;
  let intent: CategoryIntent;
  try { intent = stageCategoryJournal(storage, options.intent); }
  catch { return retain("storage"); }
  const owner = intent.ownerId;
  const owners = inFlight.get(storage) ?? new Set<string>();
  if (owners.has(owner)) return retain("busy");
  owners.add(owner); inFlight.set(storage, owners);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  ownerSignal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted || ownerSignal?.aborted) abort();
  const deadline = setTimeout(abort, 20000);
  // Auth methods cannot be aborted. The race bounds UI waiting, while every
  // continuation checks cancellation before sending or clearing anything.
  let onAbort: () => void = () => {};
  const cancelled = new Promise<CategoryMutationResult>(resolve => {
    onAbort = () => resolve(retain("retry"));
    controller.signal.addEventListener("abort", onAbort, { once: true });
    if (controller.signal.aborted) onAbort();
  });
  const attempt = async (): Promise<CategoryMutationResult> => {
    try {
      if (controller.signal.aborted) return retain("retry");
      const session = await auth.getSession();
      if (controller.signal.aborted) return retain("retry");
      const token = session.data.session?.access_token;
      if (session.error || !token) return retain("blocked");
      const verified = await auth.getUser(token);
      if (controller.signal.aborted) return retain("retry");
      if (verified.error || !verified.data.user) return retain("blocked");
      let payload;
      try { payload = categoryCommandPayload(intent, verified.data.user.id); }
      catch { return retain("blocked"); }
      // A different pending command must never be overwritten or dispatched.
      const pending = readCategoryJournal(storage, owner);
      if (!pending || !same(pending, intent)) return retain("storage");
      const response = await request("/api/personal/categories", {
        method: "POST", cache: "no-store", credentials: "omit", redirect: "error",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload), signal: controller.signal,
      });
      if (controller.signal.aborted) return retain("retry");
      const body: unknown = await response.json().catch(() => null);
      if (controller.signal.aborted) return retain("retry");
      const outcome = categoryCommandOutcome(intent, response.status, body);
      if (!outcome.clearIntent) return outcome;
      // If local storage changed/failed after server success, keep reconciliation
      // explicit; replaying the original key is safe, inventing a new key is not.
      return removeCategoryJournal(storage, intent) ? outcome : retain("storage");
    } catch { return retain("retry"); }
  };
  try { return await Promise.race([attempt(), cancelled]); }
  finally {
    clearTimeout(deadline);
    signal?.removeEventListener("abort", abort);
    ownerSignal?.removeEventListener("abort", abort);
    controller.signal.removeEventListener("abort", onAbort);
    owners.delete(owner);
  }
}
