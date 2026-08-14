"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { createClient, hasSupabaseEnv } from "@/lib/supabase/browser";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const supabase = createClient();
    if (!supabase) { setMessage("Add Supabase environment variables before signing in."); return; }
    setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: `${window.location.origin}/auth/callback` } });
    setMessage(error ? error.message : "Check your email for the sign-in link.");
    setLoading(false);
  }

  return <main className="login-shell"><div className="login-card"><div className="brand" style={{ padding: 0, color: "var(--ink)" }}><div className="brand-mark">C</div><div className="brand-name">CreditBook</div></div><h1>Welcome back.</h1><p className="muted" style={{ lineHeight: 1.5 }}>Sign in to keep every customer balance clear.</p><form onSubmit={handleLogin}><div className="field"><label htmlFor="email">Email address</label><input id="email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></div><button className="button button-primary" disabled={loading}>{loading ? "Sending link..." : "Send sign-in link"}</button></form>{message && <p className="setup-note">{message}</p>}<p className="muted" style={{ fontSize: 12, marginTop: 22 }}><Link href="/">Back to dashboard preview</Link></p>{!hasSupabaseEnv() && <p className="muted" style={{ fontSize: 11, marginTop: 20 }}>Supabase is not configured in this environment yet.</p>}</div></main>;
}
