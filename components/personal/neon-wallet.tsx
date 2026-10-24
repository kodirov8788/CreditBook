"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Mic, Image as ImageIcon, Settings, Plus, ArrowDownLeft, ArrowUpRight, LogOut, X, Tags, Wallet, ChevronRight, LoaderCircle } from "lucide-react";
import { readSession, signOut, watchSessionChanged } from "@/lib/auth/client";
import type { AuthIdentity } from "@/lib/auth/identity";
import type { PersonalLedger, PersonalSnapshot } from "@/lib/data/neon-personal-ledger";
import { createWalletRefresh, readRemainingCategories, type CategoryPage } from "@/lib/personal-finance/wallet-refresh";
import { VoiceEntry, type ConfirmedVoiceEntry } from "./voice-entry";
import { categoryNameProblem, DEFAULT_INPUT_PREFERENCES, parseInputPreferences, type InputPreferences } from "@/lib/personal-finance/input-preferences";
import styles from "./neon-wallet.module.css";

type Category = { id: string; name: string; status: "active" | "archived"; version: number };
type Intent = { owner: string; path: string; clientKey: string; command: Record<string, unknown> };
const today = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const money = (value: string) => `¥${BigInt(value).toLocaleString("en-US")}`;
class ApiError extends Error { constructor(public status: number, public code: string) { super(code); } }
const isAuthError = (error: unknown) => error instanceof ApiError && (error.status === 401 || error.status === 403 || error.code === "OWNER_CHANGED" || error.code === "AUTH_UNAVAILABLE" || error.code === "AUTH_NOT_CONFIGURED");

async function api<T>(path: string, owner: string, signal: AbortSignal, intent?: Intent): Promise<T> {
  const response = await fetch(path, { method: intent ? "POST" : "GET", credentials: "same-origin", cache: "no-store", redirect: "error", signal,
    headers: { "X-CreditBook-Owner": owner, ...(intent ? { "Content-Type": "application/json" } : {}) },
    ...(intent ? { body: JSON.stringify({ clientKey: intent.clientKey, command: intent.command }) } : {}) });
  const body = await response.json();
  if (!response.ok) throw new ApiError(response.status, typeof body.code === "string" ? body.code : "UNAVAILABLE");
  return body as T;
}

export default function NeonWallet({ initialView = "home" }: { initialView?: "home" | "categories" }) {
  const [user, setUser] = useState<AuthIdentity | null>(null);
  const [book, setBook] = useState(false);
  const [ledger, setLedger] = useState<PersonalLedger | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false), [categoriesError, setCategoriesError] = useState(false);
  const [month, setMonth] = useState(() => today().slice(0, 7));
  const selectedMonth = useRef(today().slice(0, 7));
  const [view, setView] = useState<"home" | "categories">(initialView);
  const [checking, setChecking] = useState(true), [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState("");
  const [dialog, setDialog] = useState(false), [kind, setKind] = useState<"expense" | "income">("expense");
  const [entryMode, setEntryMode] = useState<"manual" | "voice" | "receipt">("voice");
  const [preferences, setPreferences] = useState<InputPreferences>(DEFAULT_INPUT_PREFERENCES);
  const preferenceOwner = useRef<string | null>(null);
  const [categoryMode, setCategoryMode] = useState<"voice" | "text">("voice");
  const [categoryReview, setCategoryReview] = useState(false);
  const [voiceRevision, setVoiceRevision] = useState(0);
  const [amount, setAmount] = useState(""), [note, setNote] = useState(""), [date, setDate] = useState(today);
  const [categoryId, setCategoryId] = useState(""), [name, setName] = useState("");
  const [editing, setEditing] = useState<Category | null>(null), [opening, setOpening] = useState("0");
  const [archiving, setArchiving] = useState<Category | null>(null);
  const [pending, setPending] = useState<Intent | null>(null);
  const owner = useRef<string | undefined>(undefined), generation = useRef(0);
  const controller = useRef<AbortController | null>(null), mutating = useRef(false);
  const pageController = useRef<AbortController | null>(null);
  const categoryController = useRef<AbortController | null>(null);
  const invalidated = useRef(false);
  const sessionPaused = useRef(true);
  const mounted = useRef(false);
  const refresh = useRef<ReturnType<typeof createWalletRefresh> | null>(null);
  if (refresh.current === null) refresh.current = createWalletRefresh();

  const clearPrivate = useCallback(() => {
    sessionPaused.current = true;
    categoryController.current?.abort();
    categoryController.current = null;
    setUser(null); setLedger(null); setCategories([]); setCategoriesLoading(false); setCategoriesError(false);
    setDialog(false); setAmount(""); setNote(""); setCategoryId(""); setName(""); setEditing(null); setArchiving(null); setOpening("0"); setCategoryReview(false);
  }, []);

  const completeCategories = useCallback(async (id: string, first?: CategoryPage<Category>) => {
    categoryController.current?.abort();
    const active = new AbortController(); categoryController.current = active;
    const deadline = setTimeout(() => active.abort(), 20000);
    setCategoriesLoading(true); setCategoriesError(false);
    try {
      const page = first ?? await api<CategoryPage<Category>>("/api/personal/categories?status=all&offset=0", id, active.signal);
      const list = await readRemainingCategories(page, offset => api<CategoryPage<Category>>(`/api/personal/categories?status=all&offset=${offset}`, id, active.signal), active.signal);
      if (categoryController.current === active && !active.signal.aborted && mounted.current) setCategories(list);
    } catch (error) {
      if (categoryController.current !== active || !mounted.current) return;
      if (isAuthError(error)) {
        generation.current++; refresh.current?.cancel(); controller.current?.abort(); pageController.current?.abort(); clearPrivate();
        setChecking(false); setRefreshing(false); setMessage("Hisobga qayta kiring.");
      } else setCategoriesError(true);
    } finally {
      clearTimeout(deadline);
      if (categoryController.current === active && mounted.current) setCategoriesLoading(false);
    }
  }, [clearPrivate]);

  const load = useCallback((reason: "replace" | "focus" | "session" | "saved" | "month" = "replace", savedUser?: AuthIdentity) => refresh.current!.run(async signal => {
    const turn = ++generation.current;
    pageController.current?.abort();
    controller.current?.abort();
    const active = new AbortController(); controller.current = active;
    const abort = () => active.abort();
    signal.addEventListener("abort", abort, { once: true });
    const deadline = setTimeout(() => active.abort(), 20000);
    const monthOnly = reason === "month";
    const requestedMonth = selectedMonth.current;
    if (!monthOnly) { sessionPaused.current = true; categoryController.current?.abort(); setChecking(true); }
    setRefreshing(true);
    if (reason !== "focus" && !monthOnly) clearPrivate();
    try {
      // A completed write already verified its owner. Subsequent GETs each
      // verify the current cookie again; an intervening account switch fails closed.
      const session = (reason === "saved" || monthOnly) && savedUser && !invalidated.current
        ? { ok: true as const, user: savedUser }
        : await readSession(active.signal, owner.current);
      if (turn !== generation.current || active.signal.aborted) return;
      if (!session.ok || (owner.current !== undefined && owner.current !== session.user.id)) {
        clearPrivate();
        setMessage(session.ok || session.code === "OWNER_CHANGED" ? "Akkaunt boshqa tabda almashdi. Qoralama saqlanmadi. Qayta kiring." : "Hisobga qayta kiring.");
        return;
      }
      if (preferenceOwner.current !== session.user.id) {
        let stored: string | null = null;
        try { stored = localStorage.getItem(`creditbook:input:${session.user.id}`); } catch { /* Storage unavailable: voice defaults still work. */ }
        const next = parseInputPreferences(stored);
        preferenceOwner.current = session.user.id; setPreferences(next); setEntryMode(next.entry); setCategoryMode(next.category);
      }
      owner.current = session.user.id;
      const id = session.user.id;
      if (monthOnly) {
        const totals = await api<PersonalLedger>(`/api/personal/ledger?month=${requestedMonth}`,id,active.signal);
        if (turn === generation.current && !active.signal.aborted) {setLedger(totals); setMessage("");}
        return;
      }
      if (reason === "focus") setChecking(false);
      const {book:state,ledger:totals,categories:first} = await api<PersonalSnapshot>(`/api/personal/snapshot?month=${requestedMonth}`,id,active.signal);
      if (turn !== generation.current || active.signal.aborted) return;
      if (state.state !== "ready" && state.state !== "empty") throw new Error("Book requires review");
      setUser(session.user); setBook(state.state === "ready"); setLedger(totals); setCategories(first.categories);
      setCategoriesError(false); setCategoriesLoading(first.nextOffset !== null);
      if (first.nextOffset !== null) void completeCategories(id, first);
      sessionPaused.current = false;
      setMessage("");
    } catch { if (turn === generation.current && !signal.aborted) {
      clearPrivate();
      setMessage("Ma’lumotlar yuklanmadi. Qayta urinib ko‘ring.");
    } }
    finally { clearTimeout(deadline); signal.removeEventListener("abort", abort); active.abort();
      if (turn === generation.current && !signal.aborted) { setChecking(false); setRefreshing(false); }
    }
  }, reason !== "focus"), [clearPrivate, completeCategories]);

  useEffect(() => {
    const generationRef = generation;
    const refreshQueue = refresh.current!;
    mounted.current = true;
    // This effect synchronizes an external cookie session and its remote data.
    // Clearing private state before the asynchronous refresh is intentional.
    void load();
    const stop = watchSessionChanged(reason => {
      // Focus is the fallback when cross-tab messaging is unavailable. Any
      // loss of focus invalidates earlier responses before the next login can run.
      // An OS file chooser also blurs the window: hide/lock the owner-bound
      // draft without unmounting its file input. Focus must verify the same owner.
      if (reason === "blur") {
        sessionPaused.current = true;
        pageController.current?.abort();
        categoryController.current?.abort();
        refreshQueue.cancel(); generation.current++;
        setChecking(true); setRefreshing(false);
        if (mutating.current) invalidated.current = true;
        return;
      }
      sessionPaused.current = true;
      if (reason === "session") clearPrivate();
      // Freeze the original owner. Never rebind a pending write to a new login.
      if (mutating.current) { invalidated.current = true; refreshQueue.cancel(); generation.current++; clearPrivate(); return; }
      void load(reason);
    }, { observeBlur: true });
    return () => { mounted.current = false; stop(); generationRef.current++; refreshQueue.cancel(); controller.current?.abort(); pageController.current?.abort(); categoryController.current?.abort(); };
  }, [load, clearPrivate]);
  useEffect(() => { if (!dialog) return; const key = (event: KeyboardEvent) => { if (event.key === "Escape" && !mutating.current && !pending) setDialog(false); }; window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key); }, [dialog, pending]);
  useEffect(() => {
    if (!pending) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pending]);

  async function save(path: string, command: Record<string, unknown>) {
    if (!user || sessionPaused.current || checking || refreshing || mutating.current || (path !== "/api/personal/book" && (categoriesLoading || categoriesError))) return;
    const intent = pending ?? { path, command, owner: user.id, clientKey: crypto.randomUUID() };
    if (intent.owner !== user.id) { setMessage("Akkaunt o‘zgardi. Bu yozuv saqlanmadi."); return; }
    mutating.current = true; setBusy(true); setPending(intent); setMessage("");
    try {
      await api(intent.path, intent.owner, AbortSignal.timeout(20000), intent);
      if (!mounted.current) return;
      setPending(null); setDialog(false); setAmount(""); setNote(""); setName(""); setEditing(null); setArchiving(null); setCategoryReview(false); setVoiceRevision(revision => revision + 1);
      if (!invalidated.current) await load("saved", user);
    } catch (error) {
      if (!mounted.current) return;
      if (isAuthError(error)) {
        setPending(null); clearPrivate(); setMessage("Ruxsat tekshirilmadi. Qayta kiring.");
      } else if (error instanceof ApiError && error.status < 500) {
        setPending(null);
        setMessage(error.code === "OWNER_CHANGED" ? "Akkaunt almashdi. Yozuv saqlanmadi. Qayta kiring."
          : error.status === 409 ? "Ma’lumot yangilangan. Sahifani yangilab qayta tekshiring."
          : error.status === 400 ? "Summa, sana va toifani tekshiring." : "Ruxsat tekshirilmadi. Qayta kiring.");
      } else setMessage("Saqlash natijasi noma’lum. Shu yozuvni qayta yuboring — dublikat yaratilmaydi. Sahifani yopmang.");
    } finally {
      mutating.current = false;
      if (mounted.current) setBusy(false);
      if (mounted.current && invalidated.current) { invalidated.current = false; void load(); }
    }
  }
  async function more() {
    if (!user || !ledger?.nextCursor || busy || checking || refreshing) return;
    const turn = generation.current, id = user.id;
    pageController.current?.abort();
    const active = new AbortController(); pageController.current = active;
    const deadline = setTimeout(() => active.abort(), 20000);
    setBusy(true);
    try {
      const page = await api<PersonalLedger>(`/api/personal/ledger?month=${month}&cursor=${encodeURIComponent(ledger.nextCursor)}`, id, active.signal);
      if (turn === generation.current && pageController.current === active && !active.signal.aborted) setLedger(current => current ? { ...page, entries: [...current.entries, ...page.entries] } : current);
    } catch (error) { if (turn === generation.current && pageController.current === active && !active.signal.aborted) {
      if (isAuthError(error)) clearPrivate();
      setMessage("Keyingi yozuvlar yuklanmadi.");
    } }
    finally { clearTimeout(deadline); if (pageController.current === active) { pageController.current = null; if (mounted.current) setBusy(false); } }
  }
  async function logout() {
    if (!user || busy || refreshing) return;
    if (pending) { setMessage("Avval natijasi noma’lum yozuvni qayta yuborib tekshiring."); return; }
    const id = user.id; mutating.current = true; setBusy(true); generation.current++; controller.current?.abort();
    clearPrivate();
    // A full navigation intentionally drops all prior owner's in-memory state.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    try { await signOut(id); window.location.assign("/login"); }
    catch { setMessage("Chiqish tasdiqlanmadi. Qayta tekshiring."); }
    finally { mutating.current = false; setBusy(false); }
  }
  function submitEntry(event: FormEvent) {
    event.preventDefault();
    if (!/^[1-9]\d{0,12}$/.test(amount) || BigInt(amount) > BigInt("1000000000000") || !categoryId) { setMessage("Musbat butun JPY summa va toifani kiriting."); return; }
    void save("/api/personal/entries", { entries: [{kind, amountMinor: amount, currencyCode: "JPY", categoryId, effectiveDate: date, note: note.trim()}] });
  }
  function submitVoiceEntries(entries: readonly ConfirmedVoiceEntry[]) {
    void save("/api/personal/entries", { entries });
  }
  function updatePreferences(next: InputPreferences) {
    if (!user || locked) return;
    setPreferences(next);
    try { localStorage.setItem(`creditbook:input:${user.id}`, JSON.stringify(next)); }
    catch { setMessage("Sozlama shu sessiya uchun saqlandi. Brauzer doimiy saqlashga ruxsat bermadi."); }
  }
  function showCategories() {
    setView("categories"); setCategoryMode(preferences.category); setName(""); setEditing(null); setCategoryReview(false); setMessage("");
  }
  function authFailure() {
    generation.current++; controller.current?.abort(); pageController.current?.abort(); clearPrivate(); setMessage("Hisobga qayta kiring.");
  }
  const activeCategories = categories.filter(category => category.status === "active");
  const locked = busy || checking || refreshing || !!pending;
  const categoryLocked = locked || categoriesLoading || categoriesError;
  return <main className={styles.shell}>
    <header className={styles.header}><a href="/personal" className={styles.brand}><span>C</span> CreditBook</a>
      <div className={styles.headerActions}>{user && book && ledger && !checking && <> <details className={styles.headerPreferences}><summary aria-label="Kiritish sozlamalari" title="Kiritish sozlamalari"><Settings size={20}/></summary><div className={styles.preferencesPanel}>
        <label>Asosiy kiritish usuli<select value={preferences.entry} disabled={locked} onChange={event => { const entry = event.target.value === "manual" ? "manual" : event.target.value === "receipt" ? "receipt" : "voice"; updatePreferences({...preferences,entry}); setEntryMode(entry); }}><option value="voice">Ovoz</option><option value="manual">Qo‘lda</option><option value="receipt">Chek rasmi</option></select></label>
        <label>Toifa qo‘shish usuli<select value={preferences.category} disabled={locked} onChange={event => { const category = event.target.value === "text" ? "text" : "voice"; updatePreferences({...preferences,category}); setCategoryMode(category); }}><option value="voice">Ovoz</option><option value="text">Matn</option></select></label>
        <p className={styles.hint}>Shu brauzer va akkaunt uchun saqlanadi. Bir martalik usul tanlash defaultni o‘zgartirmaydi.</p>
      </div></details> </>}{user && <button type="button" aria-label="Chiqish" title="Chiqish" disabled={locked} onClick={() => void logout()}><LogOut size={20}/></button>}</div></header>
    <div className={styles.topline}><p>SHAXSIY HISOB</p><span>JPY · Yaponiya vaqti</span></div>
    {checking && <section className={styles.loading} aria-label="Hisob yuklanmoqda">
      <div className={styles.loadingStatus} role="status" aria-live="polite" aria-atomic="true"><span className={styles.loadingIcon}><LoaderCircle size={21} aria-hidden="true"/></span><div><strong>Hisobingiz tayyorlanmoqda</strong><p>Qoldiq va oxirgi yozuvlar yuklanmoqda.</p></div></div>
      <div aria-hidden="true">
        <div className={styles.skeletonTabs}><span/><span/></div>
        <div className={styles.skeletonBalance}><span className={styles.skeletonLabel}/><span className={styles.skeletonAmount}/><div className={styles.skeletonTotals}><span/><span/></div></div>
        <div className={styles.skeletonHistory}><span className={styles.skeletonHeading}/>{[0, 1, 2].map(row => <div className={styles.skeletonRow} key={row}><i/><div><span/><span/></div><b/></div>)}</div>
      </div>
    </section>}
    <div hidden={checking} inert={checking}>
    {!checking && (busy || refreshing || categoriesLoading) && <div className={styles.refreshStatus} role="status" aria-live="polite" aria-atomic="true"><LoaderCircle size={16} aria-hidden="true"/>{busy ? "Yozuv saqlanmoqda…" : refreshing ? "Hisob yangilanmoqda…" : "Toifalar yuklanmoqda… Qoldiq va tarix tayyor."}</div>}
    {user && categoriesError && <div className={styles.notice} role="status">Toifalar to‘liq yuklanmadi. Toifa amallari vaqtincha yopiq. <button disabled={busy || refreshing} onClick={() => void completeCategories(user.id)}>Toifalarni qayta yuklash</button></div>}
    {message && <div className={styles.notice} role="status">{message} {!dialog && <button disabled={busy || checking} onClick={() => void load()}>Qayta tekshirish</button>}</div>}
    {!checking && !user && <section className={styles.empty}><h1>Hisobingiz xavfsiz.</h1><p>Davom etish uchun akkauntingizga kiring.</p><a className={styles.primary} href="/login">Kirish</a></section>}
    {pending && !busy && <div className={styles.notice}><p>Tasdiqlanmagan so‘rov bor. Boshqa yozuv kiritishdan oldin natijasini tekshiring.</p><button disabled={!user || checking} onClick={() => void save(pending.path, pending.command)}>Xuddi shu yozuvni qayta yuborish</button></div>}
    {user && !checking && !book && <section className={styles.empty}><Wallet size={32}/><h1>Hisobingizni boshlang.</h1><p>Naqd va kartadagi pulingiz bitta JPY hisobda.</p>
      <form onSubmit={event => { event.preventDefault(); if (!/^-?(0|[1-9]\d{0,12})$/.test(opening) || BigInt(opening) > BigInt("1000000000000") || BigInt(opening) < BigInt("-1000000000000")) { setMessage("Boshlang‘ich qoldiqni tekshiring."); return; } void save("/api/personal/book", {openingAmountMinor: opening, openingDate: today()}); }}>
        <label>Boshlang‘ich qoldiq (JPY)<input inputMode="numeric" value={opening} onChange={event => setOpening(event.target.value)} disabled={locked}/></label>
        <p className={styles.hint}>Kirim yoki xarajatga qo‘shilmaydi. Manfiy bo‘lishi mumkin.</p>
        <button className={styles.primary} disabled={locked}>Hisobni ochish</button>
      </form></section>}
    {user && book && ledger && <>

      {view !== "home" && <button disabled={locked} onClick={() => { setView("home"); setEntryMode(preferences.entry); }}>← Hisobga qaytish</button>}
      {view === "home" ? <>
        <section className={styles.balance}><p>Jami qoldiq</p><h1>{money(ledger.balanceMinor)}</h1>{BigInt(ledger.balanceMinor) < BigInt(0) && <p className={styles.negativeHint}>Qoldiq manfiy. Xarajat kiritish mumkin.</p>}
          <div className={styles.totals}><div><span><ArrowDownLeft size={16}/> Kirim</span><strong>{money(ledger.incomeMinor)}</strong></div><div><span><ArrowUpRight size={16}/> Chiqim</span><strong>{money(ledger.expenseMinor)}</strong></div></div>
        </section>
        <section className={styles.quickEntry} aria-label="Yozuv qo‘shish"><h2>Yozuv qo‘shish</h2>
          <div className={styles.shortcuts} role="group" aria-label="Kiritish va boshqaruv">
            <button type="button" aria-pressed={entryMode === "voice"} disabled={locked} onClick={() => setEntryMode("voice")}><Mic size={18}/> Ovoz</button>
            <button type="button" aria-pressed={entryMode === "manual"} disabled={locked} onClick={() => setEntryMode("manual")}><Plus size={18}/> Qo‘lda</button>
            <button type="button" aria-pressed={entryMode === "receipt"} disabled={locked} onClick={() => setEntryMode("receipt")}><ImageIcon size={18}/> Chek rasmi</button>
            <button type="button" disabled={locked} onClick={showCategories}><Tags size={18}/> Toifalar</button>
          </div>
          {entryMode === "manual" ? <button className={styles.primary} disabled={categoryLocked} onClick={() => { setDialog(true); setCategoryId(activeCategories[0]?.id ?? ""); setDate(today()); setMessage(""); }}>Qo‘lda kiritish</button>
            : <VoiceEntry key={`${user.id}-${entryMode}-${voiceRevision}`} ownerId={user.id} disabled={categoryLocked} defaultKind={kind} hideSources initialSource={entryMode === "receipt" ? "receipt" : "audio"} categories={activeCategories} onConfirm={submitVoiceEntries} onMessage={setMessage} onAuthFailure={authFailure}/>}
        </section>
        <section className={styles.history}><div className={styles.sectionTitle}><h2>Tarix</h2><input aria-label="Hisobot oyi" type="month" min="0001-01" max="9999-12" value={month} disabled={busy || !!pending} onChange={event => { if (/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(event.target.value)) {selectedMonth.current = event.target.value; setMonth(event.target.value); void load("month",user);} }}/></div>
          <p className={styles.hint}>Kirim va chiqim tanlangan oy uchun. Qoldiq barcha yozuvlarni qamraydi.</p>
          {!ledger.entries.length ? <div className={styles.empty}><p>Bu oyda hali yozuv yo‘q.</p><span>Birinchi kirim yoki xarajatni qo‘shing.</span></div> : <ul className={styles.entries}>{ledger.entries.map(entry => <li key={entry.id}><span className={entry.kind === "income" ? styles.incomeIcon : styles.expenseIcon}>{entry.kind === "income" ? <ArrowDownLeft size={20}/> : <ArrowUpRight size={20}/>}</span><div><strong>{entry.note || entry.categoryName}</strong><small>{entry.categoryName} · {entry.effectiveDate}</small></div><b className={entry.kind === "income" ? styles.positive : ""}>{entry.kind === "income" ? "+" : "−"}{money(entry.amountMinor)}</b></li>)}</ul>}
          {ledger.nextCursor && <button className={styles.more} disabled={busy} onClick={() => void more()}>Yana ko‘rsatish <ChevronRight size={16}/></button>}
        </section>

      </> : <section className={styles.categories}><div className={styles.sectionTitle}><h1>Toifalar</h1><span>{activeCategories.length} faol</span></div>
        {!editing && <div className={styles.tabs} role="group" aria-label="Toifa kiritish usuli"><button type="button" aria-pressed={categoryMode === "voice"} disabled={categoryLocked} onClick={() => {setCategoryMode("voice");setCategoryReview(false);setName("");}}>Ovoz</button><button type="button" aria-pressed={categoryMode === "text"} disabled={categoryLocked} onClick={() => {setCategoryMode("text");setCategoryReview(false);setName("");}}>Matn</button></div>}
        {!editing && categoryMode === "voice" ? <VoiceEntry key={`${user.id}-category-${voiceRevision}`} purpose="category" ownerId={user.id} disabled={categoryLocked} defaultKind="expense" categories={activeCategories} existingCategoryNames={categories.map(category => category.name)} onCategoryConfirm={value => void save("/api/personal/categories",{operation:"create",name:value})} onConfirm={() => {}} onMessage={setMessage} onAuthFailure={authFailure}/>
          : <form onSubmit={event => { event.preventDefault(); const problem = categoryNameProblem(name,categories.filter(category => category.id !== editing?.id).map(category => category.name)); if (problem) {setMessage(problem);return;} if (!editing && !categoryReview) {setCategoryReview(true);return;} void save("/api/personal/categories", editing ? {operation:"rename",categoryId:editing.id,categoryVersion:editing.version,name:name.trim().replace(/\s+/g," ")} : {operation:"create",name:name.trim().replace(/\s+/g," ")}); }}>
          <label htmlFor="category-name">{editing ? "Yangi nom" : categoryReview ? "Toifani tekshiring" : "Yangi toifa"}</label><div className={styles.inline}><input id="category-name" value={name} required maxLength={80} disabled={categoryLocked} placeholder="Masalan, Oziq-ovqat" onChange={event => setName(event.target.value)}/><button className={styles.primary} disabled={categoryLocked || !!categoryNameProblem(name,categories.filter(category => category.id !== editing?.id).map(category => category.name))}>{editing ? "Saqlash" : categoryReview ? "Toifani tasdiqlash" : "Tekshirish"}</button></div>
          {name && categoryNameProblem(name,categories.filter(category => category.id !== editing?.id).map(category => category.name)) && <p role="alert">{categoryNameProblem(name,categories.filter(category => category.id !== editing?.id).map(category => category.name))}</p>}
          {(editing || categoryReview) && <button type="button" disabled={locked} onClick={() => {setEditing(null);setName("");setCategoryReview(false);}}>Bekor qilish</button>}
        </form>}

        {archiving && <div className={styles.notice}><p>“{archiving.name}” arxivlansinmi? Eski yozuvlar o‘chmaydi.</p><button disabled={categoryLocked} onClick={() => void save("/api/personal/categories",{operation:"archive",categoryId:archiving.id,categoryVersion:archiving.version})}>Arxivlashni tasdiqlash</button><button disabled={locked} onClick={() => setArchiving(null)}>Bekor qilish</button></div>}
        <ul className={styles.categoryList}>{categories.map(category => <li key={category.id}><div><strong>{category.name}</strong><small>{category.status === "active" ? "Faol" : "Arxivlangan · eski yozuvlar saqlangan"}</small></div>{category.status === "active" && <div className={styles.categoryActions}><button disabled={categoryLocked} aria-label={`${category.name}: nomlash`} onClick={() => {setEditing(category);setName(category.name);}}>Nomlash</button><button disabled={categoryLocked} aria-label={`${category.name}: arxivlash`} onClick={() => setArchiving(category)}>Arxivlash</button></div>}</li>)}</ul>
        {!categories.length && <p className={styles.hint}>Birinchi toifangizni qo‘shing: masalan, Oziq-ovqat yoki Boshqa.</p>}
      </section>}
      <footer className={styles.footer}>{user.email}<br/>Yopiq sinov · ma’lumotlar faqat sizning hisobingizda</footer>
    </>}
    {dialog && user && <div className={styles.backdrop}><section role="dialog" aria-modal="true" aria-labelledby="entry-title" className={styles.dialog}><div className={styles.sectionTitle}><h2 id="entry-title">Yangi yozuv</h2><button aria-label="Yopish" disabled={busy || !!pending} onClick={() => setDialog(false)}><X size={22}/></button></div>
      {entryMode === "manual" ? <form onSubmit={submitEntry}>
        <fieldset disabled={categoryLocked}><legend className={styles.hint}>Amal turi</legend><div className={styles.tabs}><button type="button" aria-pressed={kind === "expense"} onClick={() => setKind("expense")}>Chiqim</button><button type="button" aria-pressed={kind === "income"} onClick={() => setKind("income")}>Kirim</button></div>
          <label htmlFor="entry-amount">Summa · JPY</label><input id="entry-amount" autoFocus inputMode="numeric" pattern="[1-9][0-9]*" required value={amount} onChange={event => setAmount(event.target.value)} placeholder="0" className={styles.amount}/>
          <label htmlFor="entry-category">Toifa</label><select id="entry-category" required value={categoryId} onChange={event => setCategoryId(event.target.value)}><option value="">Toifani tanlang</option>{activeCategories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select>
          {!activeCategories.length && <p className={styles.hint}>Avval Toifalar bo‘limida bitta toifa qo‘shing.</p>}
          <label htmlFor="entry-date">Sana · Yaponiya vaqti</label><input id="entry-date" type="date" required value={date} onChange={event => setDate(event.target.value)}/>
          <label htmlFor="entry-note">Izoh <span className={styles.hint}>(ixtiyoriy)</span></label><input id="entry-note" maxLength={2000} value={note} onChange={event => setNote(event.target.value)} placeholder="Nimaga sarfladingiz?"/>
        </fieldset>
        {message && <p role="status">{message}</p>}
        <button className={styles.primary} disabled={categoryLocked || !categoryId}>{busy ? "Saqlanmoqda…" : "Tasdiqlash va saqlash"}</button>
        {pending && !busy && <button type="button" className={styles.primary} onClick={() => void save(pending.path,pending.command)}>Xuddi shu yozuvni qayta yuborish</button>}
      </form> : <VoiceEntry key={user.id} ownerId={user.id} disabled={categoryLocked} defaultKind={kind} categories={activeCategories} onConfirm={submitVoiceEntries} onMessage={setMessage} onAuthFailure={() => { generation.current++; controller.current?.abort(); pageController.current?.abort(); clearPrivate(); setMessage("Hisobga qayta kiring."); }}/>} 
    </section></div>}
    </div>
  </main>;
}
