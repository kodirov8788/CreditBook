"use client";

import { isAuthIdentity, type AuthIdentity, type SessionReply } from "./identity";

const channelName = "creditbook-neon-local-session";

export function notifySessionChanged() {
  if (typeof BroadcastChannel === "undefined") return;
  try {
    const channel = new BroadcastChannel(channelName);
    channel.postMessage("changed"); channel.close();
  } catch { /* Restricted browsers still revalidate on focus and manual refresh. */ }
}

export function watchSessionChanged(refresh: (reason: "session" | "focus" | "blur") => void,
  options: { observeBlur?: boolean } = {}) {
  let channel: BroadcastChannel | null = null;
  try { if (typeof BroadcastChannel !== "undefined") channel = new BroadcastChannel(channelName); }
  catch { /* Focus/manual revalidation remains available without cross-tab messages. */ }
  if (channel) channel.onmessage = () => refresh("session");
  const focus = () => refresh("focus");
  const blur = () => refresh("blur");
  window.addEventListener("focus", focus);
  if (options.observeBlur) window.addEventListener("blur", blur);
  return () => { channel?.close(); window.removeEventListener("focus", focus); window.removeEventListener("blur", blur); };
}

/** The SDK browser client expects the full provider surface/token payload.
 * This narrow local app intentionally exposes neither. No retries or storage.
 */
async function post(path: "sign-in/email" | "sign-out", body: object, ownerId?: string): Promise<unknown> {
  const response = await fetch(`/api/auth/${path}`, { method: "POST", credentials: "same-origin",
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(20000),
    headers: { "Content-Type": "application/json", ...(ownerId ? { "X-CreditBook-Owner": ownerId } : {}) },
    body: JSON.stringify(body) });
  if (!response.ok) throw new Error("Kirish holati tekshirilmadi. Qayta urinib ko‘ring.");
  return response.json();
}

export async function signIn(email: string, password: string): Promise<AuthIdentity> {
  const result = await post("sign-in/email", { email, password });
  if (!result || typeof result !== "object" || !("user" in result) || !isAuthIdentity(result.user)) {
    throw new Error("Kirish javobi tekshirilmadi.");
  }
  notifySessionChanged();
  return { id: result.user.id, email: result.user.email };
}

export async function signOut(ownerId: string) {
  await post("sign-out", {}, ownerId);
  notifySessionChanged();
}

export async function readSession(signal: AbortSignal, ownerId?: string): Promise<SessionReply> {
  const response = await fetch("/api/session", { cache: "no-store", credentials: "same-origin",
    redirect: "error", signal, ...(ownerId ? { headers: { "X-CreditBook-Owner": ownerId } } : {}) });
  const body: unknown = await response.json();
  if (response.ok && body && typeof body === "object" && "ok" in body && body.ok === true && "user" in body && isAuthIdentity(body.user)) {
    return { ok: true, user: { id: body.user.id, email: body.user.email } };
  }
  if ([401, 403, 409, 503].includes(response.status)) return { ok: false, code:
    response.status === 409 ? "OWNER_CHANGED" : response.status === 401 ? "UNAUTHORIZED"
      : response.status === 403 ? "QA_ACCESS_DENIED" : "AUTH_UNAVAILABLE" };
  throw new Error("Sessiya javobi tekshirilmadi.");
}
