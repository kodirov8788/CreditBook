"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { readSession, signIn, signOut, watchSessionChanged } from "@/lib/auth/client";
import type { AuthIdentity } from "@/lib/auth/identity";

/** Main /login local Neon slice. No links/fetches to unmigrated business pages. */
export default function NeonLogin() {
  const product = process.env.NEXT_PUBLIC_CREDITBOOK_NEON_ENABLED === "1";
  const [user, setUser] = useState<AuthIdentity | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);
  const generation = useRef(0);
  const owner = useRef<string | undefined>(undefined);
  const actionBusy = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const pendingRefresh = useRef(false);

  const refresh = useCallback(async () => {
    if (actionBusy.current) { pendingRefresh.current = true; return; }
    const current = ++generation.current;
    controller.current?.abort();
    const active = new AbortController(); controller.current = active;
    const deadline = setTimeout(() => active.abort(), 15000);
    setChecking(true);
    // Hide previously rendered account data immediately during revalidation.
    setUser(null); setPassword("");
    try {
      const result = await readSession(active.signal, owner.current);
      if (current !== generation.current || active.signal.aborted) return;
      if (result.ok) { owner.current = result.user.id; setUser(result.user); setMessage(""); }
      else { setMessage(result.code === "OWNER_CHANGED" ? "Kirish holati o‘zgardi. Sahifani yangilang."
        : result.code === "UNAUTHORIZED" ? "Kirish kutilmoqda."
          : "Sessiya tekshirilmadi. Qayta urinib ko‘ring."); }
    } catch { if (current === generation.current) setMessage("Sessiya tekshirilmadi. Qayta urinib ko‘ring."); }
    finally { clearTimeout(deadline); if (current === generation.current) setChecking(false); }
  }, []);

  useEffect(() => {
    const stop = watchSessionChanged(() => void refresh());
    const currentGeneration = generation;
    void refresh();
    return () => { stop(); currentGeneration.current++; controller.current?.abort(); };
  }, [refresh]);

  async function login(event: FormEvent) {
    event.preventDefault();
    if (actionBusy.current) return;
    actionBusy.current = true; generation.current++; controller.current?.abort();
    setBusy(true); setMessage("");
    const submitted = password; setPassword("");
    try { const signedIn = await signIn(email.trim(), submitted); owner.current = signedIn.id; }
    catch (error) { setMessage(error instanceof Error ? error.message : "Kirish bajarilmadi."); return; }
    finally {
      actionBusy.current = false; setBusy(false);
      if (pendingRefresh.current) { pendingRefresh.current = false; void refresh(); }
    }
    await refresh();
    // Drop the previous account's client/router state after authentication.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    if (product) window.location.assign("/personal");
  }

  async function logout() {
    if (actionBusy.current || !user) return;
    const intended = user.id;
    actionBusy.current = true; generation.current++; controller.current?.abort();
    setBusy(true); setUser(null); setPassword("");
    try { await signOut(intended); owner.current = undefined; setEmail(""); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Chiqish bajarilmadi."); }
    finally { actionBusy.current = false; setBusy(false); pendingRefresh.current = false; }
    await refresh();
  }

  return <main className="login-shell"><section className="login-card" aria-busy={busy || checking}>
    <div className="brand" style={{ padding: 0, color: "var(--ink)" }}><div className="brand-mark">C</div><div className="brand-name">CreditBook</div></div>
    <h1>{user ? "Xush kelibsiz." : "Hisobingizga kiring."}</h1>
    <p className="muted">{product ? "Pul hisobingiz — sodda va alohida." : "Neon · faqat lokal QA"}</p>
    {user ? <div>
      <p role="status">Akkauntga kirildi.</p><p data-testid="session-email">{user.email}</p>
      {product && <p><a className="button button-primary" href="/personal">Hisobni ochish</a></p>}
      <button className="button button-primary" disabled={busy || checking} onClick={() => void logout()}>Chiqish</button>
    </div> : <form onSubmit={login}>
      <div className="field"><label htmlFor="neon-email">Email</label><input id="neon-email" type="email" autoComplete="username" required disabled={busy || checking} value={email} onChange={event => setEmail(event.target.value)} /></div>
      <div className="field"><label htmlFor="neon-password">Parol</label><input id="neon-password" type="password" autoComplete="current-password" required disabled={busy || checking} value={password} onChange={event => setPassword(event.target.value)} /></div>
      <button className="button button-primary" disabled={busy || checking}>{busy ? "Kutilmoqda…" : "Kirish"}</button>
    </form>}
    <button className="button" disabled={busy || checking} onClick={() => void refresh()}>Sessiyani qayta tekshirish</button>
    {checking && <p role="status">Sessiya tekshirilmoqda…</p>}
    {message && <p role="status">{message}</p>}
    {product ? <p className="muted">Yopiq sinov · faqat ruxsat berilgan akkauntlar.</p> : process.env.NEXT_PUBLIC_CREDITBOOK_NEON_PERSONAL_LOCAL === "1"
      ? <p className="muted" style={{ fontSize: 12 }}><a href="/qa/personal-api">Shaxsiy API sinovi</a> · Faqat yangi vaqtinchalik lokal baza.</p>
      : <p className="muted" style={{ fontSize: 12 }}>Biznes API’lari bu paketga ulanmagan. Bu oynada moliyaviy ma’lumot yozilmaydi.</p>}
  </section></main>;
}
