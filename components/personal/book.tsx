"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { displayMoney, localDate } from "@/lib/personal-finance/accounts";
import { BOOK_TIME_ZONE, initialBookCommand, parsePendingBook, shouldClearPendingBook, type BookView, type PendingBook } from "@/lib/personal-finance/book";
import { parseDecimalAmount } from "@/lib/personal-finance/money";
import { BookOwnerChangedError, requestOwnedBook } from "@/lib/personal-finance/book-request";

export default function PersonalBook({ userId, hasShop }: { userId: string; hasShop: boolean }) {
  return <PersonalBookForOwner key={userId} userId={userId} hasShop={hasShop} />;
}

function PersonalBookForOwner({ userId, hasShop }: { userId: string; hasShop: boolean }) {
  const router = useRouter();
  const storageKey = `creditbook:book-initialize:v1:${userId}`;
  const [view, setView] = useState<BookView | null>(null);
  const [amount, setAmount] = useState("0");
  const [date, setDate] = useState("");
  const [pending, setPending] = useState<PendingBook | null>(null);
  const [busy, setBusy] = useState(false);
  const [journalReady, setJournalReady] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const loadSequence = useRef(0);
  const ownerBlocked = useRef(false);
  const ownerController = useRef<AbortController | null>(null);
  const [identityChanged, setIdentityChanged] = useState(false);

  const blockOwner = useCallback(() => {
    ownerBlocked.current = true;
    loadSequence.current += 1;
    ownerController.current?.abort();
    setIdentityChanged(true);
    setView(null);
  }, []);

  const load = useCallback(async () => {
    if (ownerBlocked.current || !ownerController.current) return;
    const sequence = ++loadSequence.current;
    const client = createClient();
    if (!client) throw new Error("Kirish sozlamasi topilmadi.");
    let response;
    try { response = await requestOwnedBook({ ownerId: userId, auth: client.auth, signal: ownerController.current.signal }); }
    catch (cause) { if (cause instanceof BookOwnerChangedError) blockOwner(); throw cause; }
    if (ownerBlocked.current || sequence !== loadSequence.current) return;
    if (response.status === 401) { router.replace("/login"); return; }
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Hisob olinmadi.");
    if (!ownerBlocked.current && sequence === loadSequence.current) setView(body);
  }, [blockOwner, router, userId]);

  useEffect(() => {
    let active = true;
    const cancellation = new AbortController();
    ownerController.current = cancellation;
    const client = createClient();
    // Keep callbacks synchronous: no Auth method inside its session lock.
    const subscription = client?.auth.onAuthStateChange((_event, session) => {
      if (!active || session?.user.id === userId) return;
      ownerBlocked.current = true;
      loadSequence.current += 1;
      cancellation.abort();
      void Promise.resolve().then(() => { if (active) blockOwner(); });
    }).data.subscription;
    void Promise.resolve().then(async () => {
      if (!active) return;
      try {
        // Never discard or auto-replay an older account-management command.
        if (sessionStorage.getItem(`creditbook:account-command:v1:${userId}`)) {
          setBlocked(true); setError("Oldingi hisob so‘rovi bor. Avval uning natijasini tekshirish kerak.");
        }
        const raw = sessionStorage.getItem(storageKey);
        const restored = raw ? parsePendingBook(raw) : null;
        setPending(restored);
        const command = restored?.command || initialBookCommand();
        setAmount(command.openingAmountMinor); setDate(command.openingDate);
      } catch { setBlocked(true); setError("Saqlangan so‘rov o‘qilmadi. U o‘chirilmadi."); }
      setJournalReady(true);
      await load();
    }).catch(() => { if (active) setError("Hisob olinmadi. Qayta urining."); });
    return () => { active = false; cancellation.abort(); loadSequence.current += 1; subscription?.unsubscribe(); };
  }, [blockOwner, load, storageKey, userId]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || blocked || ownerBlocked.current || !ownerController.current || !journalReady) return;
    inFlight.current = true; setBusy(true); setError("");
    let command = pending;
    try {
      if (!command) {
        let openingAmountMinor;
        try { openingAmountMinor = parseDecimalAmount(amount, { scale: 0, maxAbsMinor: BigInt("1000000000000") }).toString(); }
        catch { throw new Error("JPY uchun butun summa kiriting. Chegara: ±1 trillion."); }
        command = parsePendingBook(JSON.stringify({ clientKey: crypto.randomUUID(), command: { openingAmountMinor, openingDate: date } }));
        sessionStorage.setItem(storageKey, JSON.stringify(command));
        setPending(command);
      }
      const client = createClient();
      if (!client) throw new Error("Kirish sozlamasi topilmadi.");
      const response = await requestOwnedBook({ ownerId: userId, auth: client.auth, pending: command, signal: ownerController.current.signal });
      const body = await response.json();
      if (ownerBlocked.current || ownerController.current.signal.aborted) return;
      if (!response.ok) {
        // A previous unknown outcome must retain its original key/payload.
        if (shouldClearPendingBook(Boolean(pending), response.status, body.code)) {
          sessionStorage.removeItem(storageKey); setPending(null);
        }
        if (response.status === 409 && ["BOOK_EXISTS", "LEGACY_SETUP_REQUIRED"].includes(body.code)) await load();
        throw new Error(body.error || "Saqlanmadi. Qayta urining.");
      }
      sessionStorage.removeItem(storageKey); setPending(null);
      await load();
    } catch (cause) {
      if (cause instanceof BookOwnerChangedError) blockOwner();
      setError(cause instanceof Error ? cause.message : "Natija noma’lum. Qayta urining.");
    }
    finally { inFlight.current = false; setBusy(false); }
  }

  async function signOut() {
    if ((pending || blocked) && !window.confirm("Yuborilmagan so‘rov bor. U faqat shu akkaunt uchun saqlanadi. Chiqasizmi?")) return;
    const client = createClient();
    if (!client || (await client.auth.signOut()).error) { setError("Chiqilmadi. Qayta urining."); return; }
    router.replace("/login"); router.refresh();
  }

  if (identityChanged) return <main className="personal-shell"><h1>Kirish holati o‘zgardi</h1>
    <p role="alert">Bu tabdagi amal to‘xtatildi. Saqlangan so‘rov faqat asl akkauntingiz uchun qoldirildi.</p>
    <button className="button button-primary" onClick={() => window.location.reload()}>Sahifani yangilash</button>
  </main>;

  return <main className="personal-shell">
    <header className="personal-header"><Link href="/personal" className="brand-name">CreditBook</Link><nav aria-label="Hisob turi"><strong>Shaxsiy</strong>{hasShop && <Link href="/dashboard">Do‘kon</Link>}<button className="button" disabled={busy} onClick={() => void signOut()}>Chiqish</button></nav></header>
    <h1>Shaxsiy hisob</h1><p className="muted">Bitta hisob · JPY · Yaponiya vaqti</p>
    {error && <p role="alert" className="personal-alert">{error}</p>}
    {!view && <section className="personal-card" role="status" aria-busy="true">Hisob yuklanmoqda…</section>}
    <button className="button" disabled={busy} onClick={() => void load().catch(() => setError("Hisob olinmadi."))}>Yangilash</button>
    {view?.state === "legacy_setup_required" && <section className="personal-card"><h2>Alohida sozlash kerak</h2><p>Eski hisoblar va tarix saqlangan. Ularni avtomatik birlashtirmaymiz yoki JPY’ga aylantirmaymiz.</p></section>}
    {view?.state === "ready" && view.book && <section className="personal-card" aria-label="Hisob qoldig‘i"><p>Qoldiq · JPY</p><strong className="personal-balance">{displayMoney(view.book.balanceMinor, 0)}</strong><p>Naqd · Chiqim</p>{view.book.status === "archived" && <p>Hisob arxivda. Tarix saqlangan.</p>}<p className="muted">Hozir boshlang‘ich qoldiq ko‘rsatiladi. Kirim-chiqim kiritish keyingi bosqichda.</p></section>}
    {(view?.state === "empty" || pending) && <section className="personal-card"><h2>{pending ? "Yuborilmagan so‘rov" : "Hisobni boshlash"}</h2><form onSubmit={save}><fieldset disabled={busy || Boolean(pending) || blocked || !journalReady}>
      <div className="field"><label htmlFor="book-opening">Boshlang‘ich qoldiq · JPY</label><input id="book-opening" inputMode="decimal" required value={amount} onChange={event => setAmount(event.target.value)} /><small>0 yoki musbat/manfiy butun summa. Kirim-chiqimga qo‘shilmaydi.</small></div>
      <div className="field"><label htmlFor="book-date">Sana</label><input id="book-date" type="date" required max={localDate(BOOK_TIME_ZONE)} value={date} onChange={event => setDate(event.target.value)} /></div>
    </fieldset><button className="button button-primary" disabled={busy || blocked || !journalReady}>{busy ? "Saqlanmoqda…" : pending ? "Qayta urinish" : "Tasdiqlash"}</button></form></section>}
  </main>;
}
