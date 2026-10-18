"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AccountCard from "./account-card";
import { createClient } from "@/lib/supabase/browser";
import { parseDecimalAmount, formatMinorAmount } from "@/lib/personal-finance/money";
import { CURRENCY_SCALES, type CurrencyCode } from "@/lib/personal-finance/types";
import { displayMoney, localDate, type AccountsView, type AccountView } from "@/lib/personal-finance/accounts";

type Pending = { endpoint?: string; clientKey: string; command: Record<string, unknown> };
const empty: AccountsView = { accounts: [], totals: [], preferences: null, nextOffset: null };

export default function PersonalAccounts({ hasShop, userId }: { hasShop: boolean; userId: string }) {
  const router = useRouter();
  const storageKey = `creditbook:account-command:v1:${userId}`;
  const [data, setData] = useState<AccountsView>(empty);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState("Naqd");
  const [currency, setCurrency] = useState<CurrencyCode>("UZS");
  const [amount, setAmount] = useState("0");
  const [date, setDate] = useState("");
  const [icon, setIcon] = useState("wallet");
  const [color, setColor] = useState("#18794E");
  const [include, setInclude] = useState(true);
  const [pending, setPending] = useState<Pending | null>(null);
  const [journalBlocked, setJournalBlocked] = useState(false);
  const [journalReady, setJournalReady] = useState(false);
  const inFlight = useRef(false);
  const listRequest = useRef(0);
  const listLoading = useRef(false);
  const [listBusy, setListBusy] = useState(false);
  const zone = data.preferences?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

  const load = useCallback(async (offset = 0) => {
    if (offset && listLoading.current) return;
    const sequence = ++listRequest.current; listLoading.current = true; setListBusy(true);
    try {
    const response = await fetch(`/api/personal/accounts?offset=${offset}`, { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Hisoblar olinmadi.");
    if (sequence !== listRequest.current) return;
    setData(old => offset ? { ...body, accounts: Array.from(new Map([...old.accounts, ...body.accounts].map(account => [account.id, account])).values()) } : body);
    } finally { if (sequence === listRequest.current) { listLoading.current = false; setListBusy(false); } }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw) {
        const saved = JSON.parse(raw) as Pending;
        if (!saved.clientKey || !saved.command || typeof saved.command !== "object" || (saved.endpoint && !/^\/api\/personal\/accounts\/[0-9a-f-]{36}$/.test(saved.endpoint))) throw new Error("Invalid journal");
        setPending(saved); setFormOpen(!saved.endpoint);
        if (!saved.endpoint) {
          const savedCurrency = saved.command.currencyCode as CurrencyCode;
          if (!(savedCurrency in CURRENCY_SCALES) || typeof saved.command.openingAmountMinor !== "string") throw new Error("Invalid money journal");
          setName(String(saved.command.name));
          setAmount(formatMinorAmount(BigInt(saved.command.openingAmountMinor), CURRENCY_SCALES[savedCurrency]));
          setDate(String(saved.command.openingDate)); setCurrency(savedCurrency);
          setIcon(String(saved.command.icon || "wallet")); setColor(String(saved.command.color || "#18794E"));
          setInclude(saved.command.includeInTotal !== false);
        }
      }
    } catch { setJournalBlocked(true); setError("Oldingi so‘rovni tiklab bo‘lmadi. Yangi hisob ochishdan oldin tarixni tekshiring."); }
    setJournalReady(true);
    return fetch("/api/personal/workspace", { cache: "no-store" });
    }).then(async response => {
      if (response.status === 401) { router.replace("/login"); return; }
      if (response.status === 404) { setReady(false); return; }
      if (!response.ok) throw new Error("Shaxsiy hisob ochilmadi.");
      await load(); setReady(true);
    }).catch(e => setError(e instanceof Error ? e.message : "Ulanish xatosi."));
  }, [load, router, storageKey]);

  async function start() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const response = await fetch("/api/personal/workspace", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!response.ok) throw new Error("Shaxsiy hisob uchun ruxsat yo‘q.");
      await load(); setReady(true);
    } catch (e) { setError(e instanceof Error ? e.message : "Ulanish xatosi."); }
    finally { inFlight.current = false; setBusy(false); }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || journalBlocked || !journalReady) return;
    const firstAttempt = !pending;
    let submission = pending;
    if (!submission) {
      try {
        const scale = CURRENCY_SCALES[currency];
        const minor = parseDecimalAmount(amount, { scale, maxAbsMinor: BigInt("1000000000000") * BigInt(10) ** BigInt(scale) });
        submission = { clientKey: crypto.randomUUID(), command: { name, currencyCode: currency,
          openingAmountMinor: minor.toString(), openingDate: date, timeZone: zone, icon, color, includeInTotal: include } };
      } catch { setError("Summani tekshiring. Kasr uchun nuqta ishlating; chegara 1 trillion."); return; }
      try { sessionStorage.setItem(storageKey, JSON.stringify(submission)); }
      catch { setError("So‘rovni xavfsiz saqlab bo‘lmadi. Brauzer xotirasini yoqing."); return; }
      setPending(submission);
    }
    await send(submission, firstAttempt);
  }

  async function send(submission: Pending, firstAttempt: boolean) {
    if (inFlight.current || journalBlocked || !journalReady) return;
    inFlight.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(submission.endpoint || "/api/personal/accounts", { method: submission.endpoint ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({clientKey:submission.clientKey,command:submission.command}) });
      const body = await response.json();
      if (!response.ok) {
        // A definite 4xx rejection permits editing. Unknown/5xx outcomes retain
        // the identical key and payload, including the original local date.
        if ((firstAttempt && response.status >= 400 && response.status < 500) || (response.status === 400 && body.code === "22023")) { sessionStorage.removeItem(storageKey); setPending(null); }
        throw new Error(body.error || "Saqlanmadi. Shu so‘rovni qayta yuboring.");
      }
      sessionStorage.removeItem(storageKey); setPending(null); setFormOpen(false); setNotice(submission.endpoint ? "Hisob yangilandi." : "Hisob ochildi.");
      try { await load(); } catch { setError("Saqlandi, ro‘yxat yangilanmadi. Yangilashni bosing."); }
    } catch (e) { setError(e instanceof Error ? e.message : "Natija noma’lum. Shu so‘rovni qayta yuboring."); }
    finally { inFlight.current = false; setBusy(false); }
  }

  async function manage(account: AccountView, operation: string, fields: Record<string,unknown> = {}) {
    if(pending || inFlight.current || journalBlocked || !journalReady || !data.preferences)return;
    const submission: Pending={endpoint:`/api/personal/accounts/${account.id}`,clientKey:crypto.randomUUID(),command:{operation,accountVersion:account.version,preferencesVersion:data.preferences.version,...fields}};
    try{sessionStorage.setItem(storageKey,JSON.stringify(submission));}catch{setError("So‘rov saqlanmadi. Brauzer xotirasini yoqing.");return;}
    setPending(submission);await send(submission,true);
  }

  return <main className="personal-shell">
    <header className="personal-header"><Link href="/personal" className="brand-name">CreditBook</Link><nav aria-label="Hisob turi"><strong>Shaxsiy</strong>{hasShop && <Link href="/dashboard">Do‘kon</Link>}<button className="button" onClick={async () => { const result = await createClient()?.auth.signOut(); if (result?.error) { setError("Chiqilmadi. Qayta urinib ko‘ring."); return; } router.replace("/login"); router.refresh(); }}>Chiqish</button></nav></header>
    <h1>Hisoblar</h1><p className="muted">Pulingiz qayerda? Naqd va kartani alohida yuriting.</p>
    {error && <p role="alert" className="personal-alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {!ready ? <section className="personal-card"><h2>Shaxsiy hisob</h2><p>Do‘kon ochish shart emas.</p><button className="button button-primary" disabled={busy || !journalReady} onClick={() => void start()}>Boshlash</button></section> : <>
      <section className="personal-totals" aria-label="Jami qoldiq">{data.totals.map(total => <div className="personal-card" key={total.currencyCode}><p className="muted">Jami · {total.currencyCode}</p><strong className="personal-balance">{displayMoney(total.includedMinor, total.scale)}</strong>{total.archivedMinor !== "0" && <p>Arxiv: {displayMoney(total.archivedMinor, total.scale)}</p>}</div>)}</section>
      <div className="personal-actions"><button className="button button-primary" disabled={busy || Boolean(pending) || journalBlocked || !journalReady} onClick={() => { setDate(localDate(zone)); setFormOpen(true); }}>+ Hisob</button><button className="button" disabled={busy || listBusy} onClick={() => void load().catch(() => setError("Yangilanmadi. Qayta urinib ko‘ring."))}>Yangilash</button></div>
      {!data.accounts.length && <section className="personal-card"><h2>Birinchi hisobni oching</h2><p>Masalan: Naqd yoki Karta. Boshlang‘ich qoldiq daromad hisoblanmaydi.</p></section>}
      <section className="personal-grid" aria-label="Hisoblar">{data.accounts.map(account=><AccountCard key={account.id} account={account} isDefault={data.preferences?.defaultAccountId===account.id} disabled={busy||Boolean(pending)||journalBlocked} onManage={(a,op,fields)=>void manage(a,op,fields)}/>)}</section>
      {data.paginationLimitReached && <p role="status">Ro‘yxat chegarasiga yetildi. Jami barcha hisoblarni o‘z ichiga oladi.</p>}
      {data.nextOffset !== null && <button className="button" disabled={listBusy} onClick={() => void load(data.nextOffset!).catch(() => setError("Keyingi sahifa olinmadi."))}>Yana</button>}
    </>}
    {pending?.endpoint && <section className="personal-card"><p role="status">Oldingi boshqaruv so‘rovi natijasi noma’lum. Aynan shu so‘rov qayta yuboriladi.</p><button className="button" disabled={busy} onClick={()=>void send(pending,false)}>Qayta urinish</button></section>}
    {formOpen && <section className="personal-card" aria-label="Yangi hisob"><h2>Yangi hisob</h2><form onSubmit={save}><fieldset disabled={busy || Boolean(pending)}>
      <div className="field"><label htmlFor="account-name">Nom</label><input id="account-name" required minLength={2} maxLength={80} value={name} onChange={e => setName(e.target.value)} /></div>
      <div className="field"><label htmlFor="account-currency">Valyuta</label><select id="account-currency" value={currency} onChange={e => setCurrency(e.target.value as CurrencyCode)}>{Object.keys(CURRENCY_SCALES).map(c => <option key={c}>{c}</option>)}</select></div>
      <div className="field"><label htmlFor="account-icon">Belgi</label><select id="account-icon" value={icon} onChange={e=>setIcon(e.target.value)}><option value="cash">Naqd</option><option value="card">Karta</option><option value="bank">Bank</option><option value="wallet">Hamyon</option></select></div>
      <div className="field"><label htmlFor="account-color">Rang</label><input id="account-color" type="color" value={color} onChange={e=>setColor(e.target.value)}/></div>
      <label className="personal-check"><input type="checkbox" checked={include} onChange={e=>setInclude(e.target.checked)}/> Jamiga qo‘shish</label>
      <div className="field"><label htmlFor="opening-amount">Boshlang‘ich qoldiq</label><input id="opening-amount" required inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} /><small>Minus ham mumkin. Masalan: -50000 yoki 1250.50</small></div>
      <div className="field"><label htmlFor="opening-date">Sana</label><input id="opening-date" type="date" required max={localDate(zone)} value={date} onChange={e => setDate(e.target.value)} /><small>{zone}</small></div>
    </fieldset>{pending && <p role="status">Natija aniqlanmaguncha ma’lumot o‘zgarmaydi. Qayta urinish dublikat yaratmaydi.</p>}<div className="personal-actions"><button className="button button-primary" disabled={busy || journalBlocked}>{busy ? "Saqlanmoqda…" : pending ? "Qayta urinish" : "Saqlash"}</button><button type="button" className="button" disabled={busy || Boolean(pending)} onClick={() => setFormOpen(false)}>Bekor</button></div></form></section>}
  </main>;
}
