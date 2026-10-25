import { parsePendingBook, type PendingBook } from "./book";

export type BookAuth = {
  getSession(): Promise<{ data: { session: { access_token: string } | null }; error: unknown }>;
  getUser(token: string): Promise<{ data: { user: { id: string } | null }; error: unknown }>;
};

export class BookOwnerChangedError extends Error {
  constructor() { super("Kirish holati o‘zgardi. Sahifani yangilang."); }
}

/** Both reads and writes use the SAME remotely verified token, never cookies.
 * OwnerId is a local intent boundary, not server authorization. A session switch
 * after verification cannot retarget the request to the new cookie owner.
 */
export async function requestOwnedBook(options: {
  ownerId: string; auth: BookAuth; pending?: PendingBook;
  signal: AbortSignal; request?: typeof fetch;
}): Promise<Response> {
  const { ownerId, auth, signal } = options;
  // Snapshot the exact retry key/amount/date before awaiting mutable Auth state.
  const payload = options.pending ? JSON.stringify(parsePendingBook(JSON.stringify(options.pending))) : undefined;
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  const deadline = setTimeout(abort, 20000);
  let cancelled: () => void = () => {};
  const cancellation = new Promise<never>((_, reject) => {
    cancelled = () => reject(new Error("So‘rov to‘xtatildi. Natijani tekshirib, qayta urining."));
    controller.signal.addEventListener("abort", cancelled, { once: true });
    if (controller.signal.aborted) cancelled();
  });
  const checkActive = () => { if (controller.signal.aborted) throw new Error("So‘rov to‘xtatildi."); };
  const attempt = async () => {
    checkActive();
    const session = await auth.getSession();
    checkActive();
    const token = session.data.session?.access_token;
    if (session.error || !token) throw new BookOwnerChangedError();
    const verified = await auth.getUser(token);
    checkActive();
    if (verified.error || !verified.data.user || verified.data.user.id !== ownerId) throw new BookOwnerChangedError();
    return (options.request ?? fetch)("/api/personal/book", {
      method: payload === undefined ? "GET" : "POST", cache: "no-store",
      credentials: "omit", redirect: "error", signal: controller.signal,
      headers: { Authorization: `Bearer ${token}`, ...(payload === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(payload === undefined ? {} : { body: payload }),
    });
  };
  try { return await Promise.race([attempt(), cancellation]); }
  finally {
    clearTimeout(deadline);
    signal.removeEventListener("abort", abort);
    controller.signal.removeEventListener("abort", cancelled);
  }
}
