"use client";

import { FormEvent, Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createClient, hasSupabaseEnv } from "@/lib/supabase/browser";

const productionAppUrl = "https://g-p-6a7df7e8f1dc8191816ac81589324a2.vercel.app";

function LoginForm() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const callbackMessage = searchParams.get("error_code") === "otp_expired" ? "Email havolasi eskirgan yoki avval ishlatilgan. Yangi havola so'rang." : "";

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const supabase = createClient();
    if (!supabase) { setMessage("Kirish uchun Supabase sozlamasi kerak."); return; }
    setLoading(true);
    const appUrl = (process.env.NEXT_PUBLIC_APP_URL || productionAppUrl).replace(/\/$/, "");
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: `${appUrl}/auth/callback` } });
    setMessage(error ? "Kirish havolasi yuborilmadi. Qayta urinib ko'ring." : "Kirish havolasi emailingizga yuborildi.");
    setLoading(false);
  }

  return <main className="login-shell"><div className="login-card"><div className="brand" style={{ padding: 0, color: "var(--ink)" }}><div className="brand-mark">C</div><div className="brand-name">CreditBook</div></div><h1>Xush kelibsiz.</h1><p className="muted" style={{ lineHeight: 1.5 }}>Qarz daftaringizga kiring.</p><form onSubmit={handleLogin}><div className="field"><label htmlFor="email">Email</label><input id="email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="siz@example.com" /></div><button className="button button-primary" disabled={loading}>{loading ? "Yuborilmoqda..." : "Kirish havolasini yuborish"}</button></form>{(message || callbackMessage) && <p className="setup-note">{message || callbackMessage}</p>}<p className="muted" style={{ fontSize: 12, marginTop: 22 }}><Link href="/">Bosh sahifaga qaytish</Link></p>{!hasSupabaseEnv() && <p className="muted" style={{ fontSize: 11, marginTop: 20 }}>Supabase hali sozlanmagan.</p>}</div></main>;
}

export default function LoginPage() {
  return <Suspense fallback={<main className="login-shell"><div className="login-card"><strong>Yuklanmoqda...</strong></div></main>}><LoginForm /></Suspense>;
}
