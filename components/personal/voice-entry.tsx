"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Mic, Square, WandSparkles, LoaderCircle } from "lucide-react";
import { VOICE_CONSENT_VERSION, VOICE_MAX_ENTRIES, VOICE_MAX_TEXT, type ReceiptSummary, type VoiceDraftResponse, type VoiceEntry as SuggestedVoiceEntry } from "@/lib/personal-finance/voice-contract";
import { allocateReceiptTax, isReceiptSummary, receiptProblem, validReceiptTax } from "@/lib/personal-finance/receipt-contract";
import { normalizeReceiptImage } from "@/lib/personal-finance/receipt-image";
import { startVoiceRecorder, wavBase64, type VoiceRecorder } from "@/lib/personal-finance/voice-recorder";
import { categoryNameProblem } from "@/lib/personal-finance/input-preferences";
import styles from "./voice-entry.module.css";

export type VoiceCategoryOption = Readonly<{ id: string; name: string }>;
export type ConfirmedVoiceEntry = Readonly<{ kind: "income" | "expense"; amountMinor: string; currencyCode: "JPY"; categoryId: string; effectiveDate: string; note: string }>;
export type VoiceEntryProps = Readonly<{
  ownerId: string;
  disabled: boolean;
  defaultKind: "income" | "expense";
  categories: readonly VoiceCategoryOption[];
  onConfirm(entries: readonly ConfirmedVoiceEntry[]): void;
  onMessage(message: string): void;
  onAuthFailure(): void;
  purpose?: "category";
  hideSources?: boolean;
  initialSource?: "audio" | "receipt";
  existingCategoryNames?: readonly string[];
  onCategoryConfirm?(name: string): void;
}>;
type EditableEntry = SuggestedVoiceEntry & { id: string };
type Source = "text" | "audio" | "receipt";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const date = /^\d{4}-\d{2}-\d{2}$/;
const minor = /^[1-9]\d{0,12}$/;
const validCurrency = (value: unknown): value is SuggestedVoiceEntry["currencyCode"] => value === "JPY" || value === "USD" || value === "UZS" || value === null;
const validDate = (value: string) => {
  if (!date.test(value)) return false;
  const year = Number(value.slice(0, 4)), month = Number(value.slice(5, 7)), day = Number(value.slice(8, 10));
  return year >= 1 && year <= 9999 && month >= 1 && month <= 12 && day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
};

function validSuggestion(value: unknown): value is SuggestedVoiceEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return validReceiptTax(row as unknown as SuggestedVoiceEntry) && (row.kind === "income" || row.kind === "expense") && (typeof row.amountMinor === "string" || row.amountMinor === null)
    && validCurrency(row.currencyCode) && (typeof row.categoryId === "string" || row.categoryId === null)
    && typeof row.effectiveDate === "string" && validDate(row.effectiveDate) && typeof row.note === "string" && [...row.note].length <= 400;
}

/** Rejects unexpected or stale replies before they can become editable finance data. */
export function parseVoiceDraftResponse(value: unknown, ownerId: string, requestId: string): VoiceDraftResponse | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.ok !== true || row.ownerId !== ownerId || row.requestId !== requestId || !UUID.test(requestId) || !row.draft || typeof row.draft !== "object" || !row.budget || typeof row.budget !== "object") return null;
  const draft = row.draft as Record<string, unknown>, budget = row.budget as Record<string, unknown>;
  if (typeof draft.transcript !== "string" || [...draft.transcript].length > VOICE_MAX_TEXT || !Array.isArray(draft.entries) || draft.entries.length > VOICE_MAX_ENTRIES
    || !(typeof draft.clarification === "string" || draft.clarification === null) || typeof budget.remainingMicros !== "string" || !draft.entries.every(validSuggestion)) return null;
  if (row.categoryContextLimited !== undefined && typeof row.categoryContextLimited !== "boolean") return null;
  if (draft.categoryName !== undefined && !(draft.categoryName === null || typeof draft.categoryName === "string" && !categoryNameProblem(draft.categoryName, []))) return null;
  if (draft.categoryName !== undefined && draft.entries.length !== 0) return null;
  if (draft.receipt !== undefined && !isReceiptSummary(draft.receipt)) return null;
  return value as VoiceDraftResponse;
}

export function voiceRequestIsCurrent(active: Readonly<{ id: string; ownerId: string; controller: AbortController }> | null, requestId: string, ownerId: string, hasConsent: boolean): boolean {
  return hasConsent && active?.id === requestId && active.ownerId === ownerId && !active.controller.signal.aborted;
}

export function confirmedVoiceEntries(entries: readonly EditableEntry[], transcript: string, source: Source, categories: readonly VoiceCategoryOption[], receipt?: ReceiptSummary | null): readonly ConfirmedVoiceEntry[] | null {
  if (source === "receipt" && receiptProblem(entries, receipt)) return null;
  const cleanTranscript = transcript.trim();
  if (!cleanTranscript || [...cleanTranscript].length > VOICE_MAX_TEXT || entries.length < 1 || entries.length > VOICE_MAX_ENTRIES) return null;
  const label = source === "audio" ? "Ovoz matni" : source === "receipt" ? "Chek" : "Matn";
  const ownedCategoryIds = new Set(categories.map(category => category.id));
  const result: ConfirmedVoiceEntry[] = [];
  for (const entry of entries) {
    if (entry.currencyCode !== "JPY" || !entry.amountMinor || !minor.test(entry.amountMinor) || BigInt(entry.amountMinor) > BigInt("1000000000000") || !entry.categoryId || !ownedCategoryIds.has(entry.categoryId) || !validDate(entry.effectiveDate)) return null;
    // Receipt summaries are displayed for review, not duplicated into every saved product.
    if (!validReceiptTax(entry)) return null;
    const taxNote = entry.receiptTax ? `\nSoliqsiz ${entry.receiptTax.baseMinor} JPY; soliq ulushi ${entry.receiptTax.taxMinor} JPY.` : "";
    const note = source === "receipt" ? `${entry.note.trim()}${taxNote}\nChek orqali`.trim() : `${entry.note.trim()}\n${label}: ${cleanTranscript}`.trim();
    if ([...note].length > 2000) return null;
    result.push({ kind: entry.kind, amountMinor: entry.amountMinor, currencyCode: "JPY", categoryId: entry.categoryId, effectiveDate: entry.effectiveDate, note });
  }
  return result.length ? result : null;
}

export function VoiceEntry({ ownerId, disabled, defaultKind, categories, onConfirm, onMessage, onAuthFailure, purpose, hideSources = false, initialSource = "audio", existingCategoryNames = [], onCategoryConfirm }: VoiceEntryProps) {
  const [consent, setConsent] = useState(true), [source, setSource] = useState<Source>(initialSource), [text, setText] = useState("");
  const [recording, setRecording] = useState(false), [startingRecording, setStartingRecording] = useState(false), [audio, setAudio] = useState<string | null>(null), [analysing, setAnalysing] = useState(false);
  const [image, setImage] = useState<string | null>(null), [preparingImage, setPreparingImage] = useState(false), [receipt, setReceipt] = useState<ReceiptSummary | null>(null);
  const imageJob = useRef<symbol | null>(null);
  const imageInput = useRef<HTMLInputElement | null>(null);
  const [categoryName, setCategoryName] = useState<string | null>(null);
  const [transcript, setTranscript] = useState(""), [entries, setEntries] = useState<EditableEntry[]>([]), [clarification, setClarification] = useState<string | null>(null), [draftSource, setDraftSource] = useState<Source | null>(null), [categoryContextLimited, setCategoryContextLimited] = useState(false);
  const recorder = useRef<VoiceRecorder | null>(null), request = useRef<{ id: string; ownerId: string; controller: AbortController } | null>(null), starting = useRef<AbortController | null>(null), mounted = useRef(false), consentRef = useRef(true);
  const stopActive = useCallback(() => { starting.current?.abort(); recorder.current?.cancel(); request.current?.controller.abort(); }, []);
  const releasePrivate = useCallback(() => { imageJob.current = null; stopActive(); starting.current = null; recorder.current = null; request.current = null; }, [stopActive]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; releasePrivate(); }; }, [releasePrivate]);
  useEffect(() => releasePrivate, [ownerId, releasePrivate]);
  useEffect(() => {
    if (!disabled) return;
    // Suspend external work during session revalidation, but retain the local
    // file chooser result. Owner changes/unmount still erase it via cleanup.
    stopActive();
  }, [disabled, stopActive]);
  const changeConsent = (next: boolean) => {
    consentRef.current = next; setConsent(next);
    if (next) return;
    releasePrivate(); setText(""); setAudio(null); setTranscript(""); setEntries([]); setClarification(null); setDraftSource(null); setCategoryName(null); setCategoryContextLimited(false); setRecording(false); setStartingRecording(false); setAnalysing(false); onMessage("");
    setImage(null); setReceipt(null); setPreparingImage(false);
  };
  const selectImage = async (file: File | undefined) => {
    // The OS may return the selection before focus revalidation finishes.
    // Decode locally only; analysis and confirmation remain disabled.
    if (!file || !consentRef.current || request.current) return;
    const job = Symbol(); imageJob.current = job;
    setPreparingImage(true); setImage(null); setReceipt(null); setEntries([]); setTranscript(""); setClarification(null); setDraftSource(null); setCategoryName(null); onMessage("");
    try {
      const normalized = await normalizeReceiptImage(file);
      if (mounted.current && consentRef.current && imageJob.current === job) setImage(normalized);
    } catch { if (mounted.current && imageJob.current === job) onMessage("Rasm tayyorlanmadi. JPEG yoki PNG, 10 MBgacha bo‘lgan aniq chek rasmini tanlang."); }
    finally { if (imageJob.current === job) { imageJob.current = null; setPreparingImage(false); } }
  };
  const switchSource = (next: Source) => {
    imageJob.current = null; setPreparingImage(false); setImage(null); setReceipt(null); setEntries([]); setTranscript(""); setClarification(null); setDraftSource(null); setCategoryName(null); setAudio(null); setSource(next); onMessage("");
  };
  const changeEntry = (id: string, field: keyof SuggestedVoiceEntry, value: string) => setEntries(current => current.map(entry => {
    if (draftSource === "receipt" && ["amountMinor", "currencyCode", "kind"].includes(field)) entry = { ...entry, receiptTax: undefined };
    if (entry.id !== id) return entry;
    if (field === "currencyCode") return { ...entry, currencyCode: value === "JPY" || value === "USD" || value === "UZS" ? value : null, amountMinor: "" };
    if (field === "kind") return { ...entry, kind: value === "income" ? "income" : "expense" };
    return { ...entry, [field]: value, ...(field === "amountMinor" ? { receiptTax: undefined } : {}) };
  }));
  const record = async () => {
    if (!consentRef.current || disabled || recorder.current || starting.current || request.current || recording || startingRecording || analysing) return;
    const controller = new AbortController(); starting.current = controller;
    setStartingRecording(true); setAudio(null); setEntries([]); setTranscript(""); setClarification(null); setDraftSource(null); setCategoryName(null); setCategoryContextLimited(false);
    try {
      const active = await startVoiceRecorder(undefined, controller.signal);
      if (controller.signal.aborted || !mounted.current || !consentRef.current) { active.cancel(); return; }
      recorder.current = active; setRecording(true); onMessage("");
      void active.finished.then(result => {
        if (!mounted.current || !consentRef.current || recorder.current !== active) return;
        const capturedAudio = wavBase64(result);
        recorder.current = null; setRecording(false); setAudio(capturedAudio);
        void analyse(capturedAudio);
      }).catch(error => { if (mounted.current && recorder.current === active) { recorder.current = null; setRecording(false); if (!(error instanceof DOMException && error.name === "AbortError")) onMessage("Ovoz yozuvi tayyorlanmadi. Qayta urinib ko‘ring."); } });
    } catch (error) { if (!controller.signal.aborted && mounted.current) onMessage(error instanceof Error && error.message === "VOICE_RECORDING_UNSUPPORTED" ? "Bu brauzer ovoz yozishni qo‘llamaydi." : "Mikrofonga ruxsat berilmadi yoki yozish boshlanmadi."); }
    finally { if (starting.current === controller) starting.current = null; if (mounted.current) setStartingRecording(false); }
  };
  const stop = async () => {
    const active = recorder.current;
    if (!active) return;
    try { await active.stop(); }
    catch { /* finished handles the visible failure when this recorder remains active. */ }
  };
  const analyse = async (capturedAudio?: string) => {
    const requestSource = capturedAudio === undefined ? source : "audio";
    const requestAudio = capturedAudio ?? audio;
    if (!mounted.current || !consentRef.current || disabled || request.current || analysing || preparingImage || (requestSource === "text" ? !text.trim() : requestSource === "receipt" ? !image : !requestAudio)) return;
    const requestId = crypto.randomUUID(), controller = new AbortController();
    request.current = { id: requestId, ownerId, controller };
    setAnalysing(true); setReceipt(null); setEntries([]); setTranscript(""); setClarification(null); setDraftSource(null); setCategoryName(null); setCategoryContextLimited(false); onMessage("");
    const body = requestSource === "text" ? { requestId, consent: VOICE_CONSENT_VERSION, defaultKind, mode: "text" as const, text: text.trim() }
      : requestSource === "receipt" ? { requestId, consent: VOICE_CONSENT_VERSION, defaultKind, mode: "receipt" as const, image: image! }
      : { requestId, consent: VOICE_CONSENT_VERSION, defaultKind, mode: "audio" as const, audio: requestAudio!, ...(purpose === "category" ? { purpose } : {}) };
    try {
      const response = await fetch("/api/personal/voice-draft", { method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error", signal: controller.signal, headers: { "Content-Type": "application/json", "X-CreditBook-Owner": ownerId }, body: JSON.stringify(body) });
      const value: unknown = await response.json();
      if (!voiceRequestIsCurrent(request.current, requestId, ownerId, consentRef.current)) return;
      if (response.status === 401 || response.status === 403 || (value && typeof value === "object" && (value as { code?: unknown }).code === "OWNER_CHANGED")) { onAuthFailure(); return; }
      const parsed = response.ok ? parseVoiceDraftResponse(value, ownerId, requestId) : null;
      const draft = requestSource === "receipt" && !parsed?.draft.receipt ? null : purpose === "category" && (parsed?.draft.entries.length !== 0 || !(parsed?.draft.categoryName === null || typeof parsed?.draft.categoryName === "string" && !categoryNameProblem(parsed.draft.categoryName, []))) ? null : parsed;
      if (!draft) { const code = value && typeof value === "object" ? (value as { code?: unknown }).code : undefined; onMessage(code === "AI_BUDGET_EXHAUSTED" ? "AI limiti tugadi." : code === "AI_BUSY" ? "AI band. Keyinroq urinib ko‘ring." : code === "AI_REQUEST_REPLAY" ? "So‘rov qayta ishlanmoqda. Shu tahlilni qayta yuboring." : "Tahlil natijasi ishonchli emas. Qayta urinib ko‘ring."); return; }
      setCategoryName(draft.draft.categoryName ?? null);
      setAudio(null); setTranscript(draft.draft.transcript); setClarification(draft.draft.clarification); setDraftSource(requestSource); setCategoryContextLimited(Boolean((draft as VoiceDraftResponse & { categoryContextLimited?: boolean }).categoryContextLimited));
      setImage(null); setReceipt(draft.draft.receipt ?? null);
      const other = categories.find(category => category.name.trim().toLocaleLowerCase("uz") === "boshqa")?.id ?? null;
      setEntries(draft.draft.entries.map((entry, index) => ({ ...entry, id: `${requestId}-${index}`, categoryId: categories.some(category => category.id === entry.categoryId) ? entry.categoryId : other })));
    } catch (error) { if (!controller.signal.aborted) onMessage(error instanceof DOMException && error.name === "AbortError" ? "" : "Tahlilga ulanib bo‘lmadi. Qayta urinib ko‘ring."); }
    finally { if (request.current?.id === requestId) { request.current = null; setAnalysing(false); } }
  };
  const confirmCategory = () => {
    if (disabled || !consentRef.current || recording || startingRecording || analysing || request.current || !categoryName || categoryNameProblem(categoryName, existingCategoryNames)) return;
    onCategoryConfirm?.(categoryName.trim().replace(/\s+/g, " "));
  };
  const confirm = () => {
    if (!consentRef.current || disabled || recording || startingRecording || analysing || request.current || recorder.current || starting.current) return;
    if (clarification) { onMessage("Avval aniqlashtirishni tuzating."); return; }
    const result = draftSource ? confirmedVoiceEntries(entries, transcript, draftSource, categories, receipt) : null;
    if (!result) { onMessage("Har bir qatorda JPY summasi, toifa va to‘g‘ri sana kerak. Boshqa valyuta avtomatik o‘tkazilmaydi."); return; }
    onConfirm(result);
  };
  const acknowledgeClarification = () => {
    const corrected = draftSource ? confirmedVoiceEntries(entries, transcript, draftSource, categories, receipt) : null;
    if (!corrected) { onMessage("Aniqlashtirishdan keyin har bir qatorga JPY summa, sizning toifangiz va to‘g‘ri sana kiriting."); return; }
    setClarification(null); onMessage("");
  };
  const taxAllocation = draftSource === "receipt" ? allocateReceiptTax(entries, receipt) : null;
  const applyTax = () => {
    if (disabled || !consentRef.current || analysing || !taxAllocation) return;
    setEntries([...taxAllocation]);
  };
  const receiptError = draftSource === "receipt" ? receiptProblem(entries, receipt) : null;
  const working = preparingImage || analysing || startingRecording;
  const workingTitle = preparingImage ? "Rasm tayyorlanmoqda" : startingRecording ? "Mikrofon ochilmoqda" : source === "receipt" ? "Chek tahlil qilinmoqda" : "Yozuv tahlil qilinmoqda";
  const workingHint = preparingImage ? "Rasm tahlilga moslanmoqda." : startingRecording ? "Ruxsat so‘ralsa, mikrofonga ruxsat bering." : source === "receipt" ? "Mahsulotlar va summalar alohida kartalarga ajratilmoqda." : "Summa, toifa va sana aniqlanmoqda.";
  return <section className={styles.panel} aria-label={purpose === "category" ? "Ovozli toifa" : "Ovozli yozuv"}>
    <div className={styles.privacy}><p>{source === "receipt" ? "Chek rasmi" : source === "text" ? "Matn" : "Ovoz"} → OpenRouter → Google. Google xavfsizlik uchun saqlashi mumkin.</p><details><summary>Maxfiylik tafsilotlari</summary><p>Ovoz, matn yoki chek rasmi OpenRouter orqali Google’ga yuboriladi. CreditBook audio va rasmni saqlamaydi. Rasmda keraksiz shaxsiy ma’lumotlarni yoping. Yozuvlar faqat tekshirib tasdiqlaganingizdan keyin saqlanadi.</p></details></div>
    <label className={styles.consent}><input type="checkbox" checked={consent} disabled={disabled} onChange={event => changeConsent(event.target.checked)}/> <span>Men ushbu yuborishga roziman.</span></label>
    {purpose !== "category" && !hideSources && <div className={styles.source} role="group" aria-label="Manba">{([ ["audio", "Ovoz"], ["receipt", "Chek"] ] as const).map(([mode, label]) => <button key={mode} type="button" aria-pressed={source === mode} disabled={disabled || recording || startingRecording || analysing} onClick={() => switchSource(mode)}>{label}</button>)}</div>}
    {source === "receipt" && <div className={styles.receipt}>
      <p>Har bir mahsulot alohida yozuv bo‘ladi. Bitta chek: 10 tagacha mahsulot, JPEG/PNG, 10 MBgacha. Faqat tasdiqlasangiz barchasi birga saqlanadi.</p>
      <input ref={imageInput} hidden aria-label="Chek rasmini tanlang" type="file" accept="image/jpeg,image/png" disabled={disabled || !consent || analysing || preparingImage} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; void selectImage(file); }}/>
      {image && <figure className={styles.preview}>
        <Image className={styles.thumbnail} src={`data:image/jpeg;base64,${image}`} alt="Tanlangan chek rasmi" width={80} height={112} unoptimized/>
        <figcaption><strong>{analysing ? "Chek o‘qilmoqda…" : "Chek tanlandi"}</strong><p role="status">Rasm tayyor. Kamera metama’lumotlari olib tashlandi.</p></figcaption>
      </figure>}
      <button type="button" className={styles.chooseImage} disabled={disabled || !consent || analysing || preparingImage} onClick={() => imageInput.current?.click()}>{image ? "Rasmni almashtirish" : "Chek rasmini tanlang"}</button>
      <button type="button" className={styles.confirm} disabled={disabled || !consent || analysing || preparingImage || !image} onClick={() => void analyse()}>{preparingImage ? "Rasm tayyorlanmoqda…" : analysing ? "Chek o‘qilmoqda…" : "Chekni tahlil qilish"}</button>
    </div>}
    {source !== "receipt" && (source === "audio" ? <><button type="button" className={styles.record} aria-pressed={recording} disabled={disabled || !consent || startingRecording || analysing} onClick={() => void (recording ? stop() : record())}>{recording ? <><Square size={19}/> To‘xtatish va tahlil qilish</> : <><Mic size={19}/> {startingRecording ? "Mikrofon ochilmoqda…" : purpose === "category" ? "Toifa nomini aytish" : "Ovoz yozish"}</>}</button><p className={styles.status} role="status">{analysing ? "Tahlil qilinmoqda…" : recording ? "Yozish tugagach avtomatik tahlil qilinadi." : "30 soniyagacha. O‘zingiz to‘xtating, tekshirib tasdiqlang. Faqat tasdiqlasangiz saqlanadi."}</p>{audio && !analysing && <button type="button" className={styles.confirm} disabled={disabled || !consent || recording || startingRecording} onClick={() => void analyse()}>Qayta urinish</button>}</> : <><label>Matn<textarea maxLength={VOICE_MAX_TEXT} value={text} disabled={disabled || !consent || analysing} onChange={event => setText(event.target.value)} placeholder="Masalan: bugun oziq-ovqatga 1200 yen sarfladim"/></label><button type="button" className={styles.confirm} disabled={disabled || !consent || analysing || !text.trim()} onClick={() => void analyse()}><WandSparkles size={18}/> {analysing ? "Tahlil qilinmoqda…" : "Tahlil qilish"}</button></>)}
    {working && <div className={styles.working} role="status" aria-live="polite" aria-atomic="true"><span className={styles.workingIcon}><LoaderCircle size={22} aria-hidden="true"/></span><div><strong>{workingTitle}</strong><p>{workingHint}</p>{analysing && <small>Tayyor bo‘lgach, tasdiqlash kartalari chiqadi.</small>}</div></div>}
    {purpose === "category" && (recording || categoryName !== null || clarification) && <button type="button" disabled={disabled || analysing} onClick={() => {releasePrivate();setCategoryName(null);setAudio(null);setTranscript("");setClarification(null);setRecording(false);setStartingRecording(false);}}>Bekor qilish</button>}
    {purpose === "category" && categoryName !== null && <div className={styles.draft}><h3>Toifani tekshiring</h3><label>Toifa nomi<input maxLength={80} value={categoryName} disabled={disabled || analysing} onChange={event => setCategoryName(event.target.value)}/></label>{categoryNameProblem(categoryName, existingCategoryNames) && <p role="alert">{categoryNameProblem(categoryName, existingCategoryNames)}</p>}<button type="button" className={styles.confirm} disabled={disabled || !consent || recording || analysing || !!categoryNameProblem(categoryName, existingCategoryNames)} onClick={confirmCategory}>Toifani tasdiqlash</button></div>}
    {clarification && purpose === "category" && <p role="status">{clarification}</p>}
    {clarification && purpose !== "category" && <div className={styles.clarification}><p>Aniqlashtirish kerak: {clarification}</p><button type="button" disabled={disabled || analysing} onClick={acknowledgeClarification}>Tuzatdim</button></div>}
    {categoryContextLimited && <p className={styles.clarification}>AI toifalarning cheklangan ro‘yxatini ko‘radi. Kerakli toifani qo‘lda tanlashingiz mumkin.</p>}
    {entries.length > 0 && <div className={styles.drafts}><label>Matnni tekshiring<textarea maxLength={VOICE_MAX_TEXT} value={transcript} disabled={disabled} onChange={event => setTranscript(event.target.value)}/></label>{entries.map((entry, index) => <article className={styles.draft} key={entry.id}><h3>{index + 1}-qoralama</h3><div className={styles.fields}><label>Tur<select value={entry.kind} disabled={disabled} onChange={event => changeEntry(entry.id, "kind", event.target.value)}><option value="expense">Chiqim</option><option value="income">Kirim</option></select></label><label>Valyuta<select value={entry.currencyCode ?? ""} disabled={disabled} onChange={event => changeEntry(entry.id, "currencyCode", event.target.value)}><option value="">Noma’lum</option><option value="JPY">JPY</option><option value="USD">USD</option><option value="UZS">UZS</option></select></label></div>{entry.currencyCode && entry.currencyCode !== "JPY" && <p className={styles.warning}>{entry.currencyCode} JPYga avtomatik o‘tkazilmaydi. JPY ni tanlab, summani qo‘lda kiriting.</p>}<label>Summa · JPY<input inputMode="numeric" value={entry.amountMinor ?? ""} disabled={disabled || entry.currencyCode !== "JPY"} onChange={event => changeEntry(entry.id, "amountMinor", event.target.value)}/></label><label>Toifa<select value={entry.categoryId ?? ""} disabled={disabled} onChange={event => changeEntry(entry.id, "categoryId", event.target.value)}><option value="">Toifani tanlang</option>{categories.map(category => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label><label>Sana<input type="date" value={entry.effectiveDate} disabled={disabled} onChange={event => changeEntry(entry.id, "effectiveDate", event.target.value)}/></label><label>Izoh<textarea maxLength={400} value={entry.note} disabled={disabled} onChange={event => changeEntry(entry.id, "note", event.target.value)}/></label>{entry.receiptTax && validReceiptTax(entry) && <p>Soliqsiz {entry.receiptTax.baseMinor} JPY + soliq {entry.receiptTax.taxMinor} JPY = {entry.amountMinor} JPY</p>}</article>)}</div>}
    {draftSource === "receipt" && receipt && <div className={styles.receipt}><label>Chek jami · JPY<input inputMode="numeric" value={receipt.totalMinor ?? ""} disabled={disabled || receipt.currencyCode !== "JPY"} onChange={event => { setReceipt({ ...receipt, totalMinor: event.target.value || null }); setEntries(current => current.map(entry => ({ ...entry, receiptTax: undefined }))); }}/></label>{taxAllocation && <button type="button" className={styles.confirm} disabled={disabled || !consent || analysing} onClick={applyTax}>{receipt.taxMinor} JPY soliqni mahsulotlarga taqsimlash</button>}{receipt.taxMinor && receipt.taxMinor !== "0" && !receiptError && entries.every(entry => entry.receiptTax && validReceiptTax(entry)) && <p role="status">Chekdagi {receipt.taxMinor} JPY soliq mahsulot summalariga kiritildi. Har bir ulush izohda ko‘rsatilgan.</p>}{receiptError ? <p role="alert" className={styles.warning}>{receiptError}</p> : <p role="status">Mahsulotlar yig‘indisi chek jamiga mos. Barcha qatorlarni tekshiring.</p>}</div>}
    {entries.length > 0 && <button type="button" className={styles.confirm} disabled={disabled || !consent || recording || startingRecording || analysing || !!clarification || !!receiptError} onClick={confirm}>Tasdiqlash va saqlash</button>}
  </section>;
}
