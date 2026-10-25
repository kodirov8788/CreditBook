"use client";

import { FormEvent, Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createClient, hasSupabaseEnv } from "@/lib/supabase/browser";
import { loginDestination } from "@/lib/login-destination";
import styles from "./page.module.css";
import NeonLogin from "@/components/auth/neon-login";

function LoginForm() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [method, setMethod] = useState<"password" | "link">("password");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const callbackError = searchParams.get("error_code");
  const callbackMessage = callbackError === "otp_expired" ? "Email havolasi eskirgan yoki avval ishlatilgan. Yangi havola so'rang." : callbackError === "invite_activation_failed" ? "Taklifni faollashtirib bo'lmadi. Do'kon egasidan yangi taklif so'rang." : callbackError === "auth_failed" ? "Kirish havolasi tasdiqlanmadi. Yangi havola so‘rang." : "";

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    setMessage("");
    const supabase = createClient();
    if (!supabase) { setMessage("Kirish uchun Supabase sozlamasi kerak."); return; }
    setLoading(true);
    try {
      if (method === "password") {
        const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error || !data.session) {
          setMessage("Email yoki parol noto‘g‘ri. Qayta urinib ko‘ring.");
          return;
        }
        setPassword("");
        // A full navigation drops the previous account's client/router state.
        window.location.replace(loginDestination(searchParams.get("next")));
      } else {
        const appUrl = (process.env.NEXT_PUBLIC_APP_URL || window.location.origin).replace(/\/$/, "");
        const callback = new URL(`${appUrl}/auth/callback`);
        callback.searchParams.set("next", loginDestination(searchParams.get("next")));
        const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: callback.href } });
        setMessage(error ? "Kirish havolasi yuborilmadi. Qayta urinib ko'ring." : "Kirish havolasi emailingizga yuborildi.");
      }
    } catch {
      setMessage("Kirish amalga oshmadi. Ulanishni tekshirib, qayta urining.");
    } finally {
      setLoading(false);
    }
  }

  return <main className="login-shell"><div className="login-card">
    <div className="brand" style={{ padding: 0, color: "var(--ink)" }}><div className="brand-mark">C</div><div className="brand-name">CreditBook</div></div>
    <h1>Xush kelibsiz.</h1><p className="muted" style={{ lineHeight: 1.5 }}>Hisobingizga kiring.</p>
    <div className={styles.methods} role="group" aria-label="Kirish usuli">
      <button type="button" className={styles.method} aria-pressed={method === "password"} disabled={loading} onClick={() => { setMethod("password"); setMessage(""); }}><span className={styles.check} aria-hidden="true">✓</span><span>Parol</span></button>
      <button type="button" className={styles.method} aria-pressed={method === "link"} disabled={loading} onClick={() => { setMethod("link"); setPassword(""); setMessage(""); }}><span className={styles.check} aria-hidden="true">✓</span><span>Email havolasi</span></button>
    </div>
    <form onSubmit={handleLogin} aria-busy={loading}>
      <div className="field"><label htmlFor="email">Email</label><input id="email" type="email" autoComplete="username" required disabled={loading} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="siz@example.com" /></div>
      {method === "password" && <div className="field"><label htmlFor="password">Parol</label><input id="password" type="password" autoComplete="current-password" required disabled={loading} value={password} onChange={(event) => setPassword(event.target.value)} /></div>}
      <button className="button button-primary" disabled={loading}>{loading ? "Kutilmoqda..." : method === "password" ? "Kirish" : "Kirish havolasini yuborish"}</button>
    </form>
    {(message || callbackMessage) && <p role={callbackMessage ? "alert" : "status"} className="setup-note">{message || callbackMessage}</p>}
    <p className="muted" style={{ fontSize: 12, marginTop: 22 }}><Link href="/">Bosh sahifaga qaytish</Link></p>
    {!hasSupabaseEnv() && <p className="muted" style={{ fontSize: 11, marginTop: 20 }}>Supabase hali sozlanmagan.</p>}
  </div></main>;
}

export default function LoginPage() {
  // Explicit local opt-in only; the server independently rejects hosted use.
  // Do not mount legacy Auth or navigate to Supabase-backed business routes.
  if (process.env.NEXT_PUBLIC_CREDITBOOK_NEON_ENABLED === "1" || process.env.NEXT_PUBLIC_CREDITBOOK_NEON_AUTH_LOCAL === "1") return <NeonLogin />;
  return <Suspense fallback={<main className="login-shell"><div className="login-card"><strong>Yuklanmoqda...</strong></div></main>}><LoginForm /></Suspense>;
}
