"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import {
  readCategoryJournal,
  removeCategoryJournal,
  stageCategoryJournal,
  submitCategoryMutation,
} from "@/lib/personal-finance/category-mutation";
import { createCategoryIntent, type CategoryIntent } from "@/lib/personal-finance/category-command";
import type { CategoryListItem } from "@/lib/personal-finance/category-list";
import styles from "./category-editor.module.css";

export type CategoryEditorTarget =
  | { operation: "create" }
  | { operation: "rename" | "archive"; category: CategoryListItem }
  | null;
type ArchiveTarget = { operation: "archive"; category: CategoryListItem };

export type CategoryEditorProps = {
  userId: string;
  ownerSignal: AbortSignal;
  target: CategoryEditorTarget;
  onClose(): void;
  onSaved(): void;
  onDiscarded(): void;
  onPendingChange(pending: boolean): void;
};

function pendingDescription(intent: CategoryIntent) {
  const command = intent.command;
  if (command.operation === "create") return `Yaratish: “${command.name}”`;
  if (command.operation === "rename") return `Nomini o‘zgartirish: “${command.name}” (versiya ${command.categoryVersion})`;
  return `Arxivlash: ${command.categoryId} (versiya ${command.categoryVersion})`;
}

function resultMessage(kind: "blocked" | "busy" | "conflict" | "invalid" | "retry" | "storage") {
  switch (kind) {
    case "blocked": return "Kirishni tekshirib, qayta urinib ko‘ring.";
    case "busy": return "Amal allaqachon yuborilmoqda.";
    case "conflict": return "Toifa o‘zgargan. Avval ro‘yxatni yangilang.";
    case "invalid": return "Toifa ma’lumoti qabul qilinmadi.";
    case "storage": return "Saqlangan amal tekshirilmadi.";
    default: return "Amal yakunlanmadi. Qayta urinib ko‘ring.";
  }
}

export default function CategoryEditor(props: CategoryEditorProps) {
  return <CategoryEditorForOwner key={props.userId} {...props} />;
}

function CategoryEditorForOwner({ userId, ownerSignal, target, onClose, onSaved, onDiscarded, onPendingChange }: CategoryEditorProps) {
  const [pending, setPending] = useState<CategoryIntent | null>(null);
  const [journalLoading, setJournalLoading] = useState(true);
  const [journalBlocked, setJournalBlocked] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<ArchiveTarget | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const archiveDialog = useRef<HTMLDialogElement>(null);
  const discardDialog = useRef<HTMLDialogElement>(null);
  const controller = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const submittingRef = useRef(false);
  const targetKey = target?.operation === "create"
    ? "create"
    : target ? `${target.operation}:${target.category.id}:${target.category.version}` : "none";

  useEffect(() => {
    let active = true;
    alive.current = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      try {
        setPending(readCategoryJournal(window.sessionStorage, userId));
        setJournalBlocked(false);
      } catch {
        setJournalBlocked(true);
        setError("Saqlangan amal o‘qilmadi. Uni hozir yuborib bo‘lmaydi.");
      } finally {
        setJournalLoading(false);
      }
    });
    return () => {
      active = false;
      alive.current = false;
      controller.current?.abort();
      controller.current = null;
    };
  }, [userId]);

  useEffect(() => {
    onPendingChange(journalLoading || journalBlocked || pending !== null);
  }, [journalBlocked, journalLoading, onPendingChange, pending]);

  useEffect(() => {
    const dialog = archiveDialog.current;
    if (!dialog) return;
    if (archiveTarget && !dialog.open) dialog.showModal();
    if (!archiveTarget && dialog.open) dialog.close();
  }, [archiveTarget]);

  useEffect(() => {
    const dialog = discardDialog.current;
    if (!dialog) return;
    if (discardOpen && !dialog.open) dialog.showModal();
    if (!discardOpen && dialog.open) dialog.close();
  }, [discardOpen]);

  function updatePending(next: CategoryIntent | null) {
    if (!alive.current) return;
    setPending(next);
  }

  function retryJournalRead() {
    setJournalLoading(true);
    try {
      setPending(readCategoryJournal(window.sessionStorage, userId));
      setJournalBlocked(false);
      setError("");
    } catch {
      setJournalBlocked(true);
      setError("Saqlangan amal o‘qilmadi. Uni hozir yuborib bo‘lmaydi.");
    } finally {
      setJournalLoading(false);
    }
  }

  async function submit(intent: CategoryIntent) {
    if (submittingRef.current || ownerSignal.aborted) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError("");
    const nextController = new AbortController();
    controller.current?.abort();
    controller.current = nextController;

    try {
      const client = createClient();
      if (!client) {
        if (alive.current) setError("Kirish sozlamasi topilmadi.");
        return;
      }
      const result = await submitCategoryMutation({
        intent,
        storage: window.sessionStorage,
        auth: { getSession: () => client.auth.getSession(), getUser: token => client.auth.getUser(token) },
        signal: nextController.signal,
        ownerSignal,
      });
      if (!alive.current || nextController.signal.aborted || ownerSignal.aborted) return;
      if (result.clearIntent) {
        updatePending(null);
        onSaved();
        return;
      }
      setError(resultMessage(result.kind));
    } catch {
      if (alive.current && !nextController.signal.aborted) setError("Amal yuborilmadi. Qayta urinib ko‘ring.");
    } finally {
      if (alive.current && controller.current === nextController) {
        controller.current = null;
        setSubmitting(false);
      }
      submittingRef.current = false;
    }
  }

  function stageAndSubmit(command: CategoryIntent["command"]) {
    if (journalBlocked || submittingRef.current || ownerSignal.aborted) return;
    let intent: CategoryIntent;
    try {
      intent = createCategoryIntent(userId, crypto.randomUUID(), command);
      const persisted = stageCategoryJournal(window.sessionStorage, intent);
      updatePending(persisted);
    } catch {
      setError("Nomni tekshiring yoki avval saqlangan amalni hal qiling.");
      return;
    }
    void submit(intent);
  }

  function submitForm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!target || journalBlocked || pending || submittingRef.current) return;
    const name = String(new FormData(event.currentTarget).get("categoryName") ?? "");
    if (target.operation === "create") {
      stageAndSubmit({ operation: "create", name });
      return;
    }
    if (target.operation === "rename") {
      stageAndSubmit({ operation: "rename", categoryId: target.category.id, categoryVersion: target.category.version, name });
    }
  }

  function retryPending() {
    if (pending) void submit(pending);
  }

  function discardPending() {
    if (!pending || submittingRef.current || ownerSignal.aborted) return;
    try {
      if (!removeCategoryJournal(window.sessionStorage, pending)) {
        setError("Saqlangan amal o‘chirilmadi.");
        return;
      }
      setDiscardOpen(false);
      updatePending(null);
      setError("");
      onDiscarded();
    } catch {
      setError("Saqlangan amal o‘chirilmadi.");
    }
  }

  function confirmArchive() {
    if (!archiveTarget || journalBlocked || pending || submittingRef.current) return;
    const selected = archiveTarget;
    setArchiveTarget(null);
    stageAndSubmit({
      operation: "archive",
      categoryId: selected.category.id,
      categoryVersion: selected.category.version,
    });
  }

  if (journalLoading) {
    return <p className={styles.loading} role="status" aria-busy="true">Saqlangan amal tekshirilmoqda…</p>;
  }

  if (journalBlocked) {
    return <section className={styles.panel} aria-label="Saqlangan amalni tiklash">
      <div className={styles.heading}>
        <div><h2>Saqlangan amal o‘qilmadi</h2><p>Yangi amal boshlanmadi. Saqlangan ma’lumot o‘zgartirilmaydi.</p></div>
      </div>
      <p className={styles.error} role="alert">{error || "Saqlangan amal o‘qilmadi."}</p>
      <div className={styles.actions}>
        <button type="button" className="button button-secondary" onClick={retryJournalRead}>Qayta o‘qish</button>
      </div>
    </section>;
  }

  if (pending) {
    return <section className={styles.panel} aria-label="Saqlangan toifa amali">
      <div className={styles.heading}>
        <div>
          <h2>Yakunlanmagan amal</h2>
          <p>{pendingDescription(pending)}</p>
        </div>
      </div>
      <p className={styles.pending} role="status">Amal holati noma’lum. U serverda bajarilgan yoki hali yuborilmagan bo‘lishi mumkin.</p>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.actions}>
        <button type="button" className="button button-primary" disabled={submitting} onClick={retryPending}>
          {submitting ? "Yuborilmoqda…" : "Qayta urinish"}
        </button>
        <button type="button" className="button button-secondary" disabled={submitting} onClick={() => setDiscardOpen(true)}>Bekor qilish</button>
      </div>
      <dialog ref={discardDialog} className={styles.dialog} role="alertdialog" aria-labelledby="discard-category-title" aria-describedby="discard-category-description" onCancel={event => { event.preventDefault(); setDiscardOpen(false); }}>
        <h2 id="discard-category-title">Saqlangan amal bekor qilinsinmi?</h2>
        <p id="discard-category-description">Bu faqat mahalliy qayta urinishni o‘chiradi. Amal serverda allaqachon qo‘llangan bo‘lishi mumkin; bu uni ortga qaytarmaydi.</p>
        <div className={styles.actions}>
          <button type="button" className="button button-secondary" onClick={() => setDiscardOpen(false)}>Ortga</button>
          <button type="button" className="button button-primary" onClick={discardPending}>Mahalliy amalni o‘chirish</button>
        </div>
      </dialog>
    </section>;
  }

  if (!target) return error ? <p className={styles.error} role="alert">{error}</p> : null;

  if (target.operation === "archive") {
    return <section className={styles.panel} aria-label="Toifani arxivlash">
      <div className={styles.heading}>
        <div><h2>Toifani arxivlash</h2><p>“{target.category.name}” endi yangi yozuvlarda tanlanmaydi.</p></div>
        <button type="button" className={styles.close} onClick={onClose} aria-label="Panelni yopish">Yopish</button>
      </div>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.actions}>
        <button type="button" className="button button-secondary" onClick={onClose}>Yopish</button>
        <button type="button" className="button button-primary" disabled={submitting || journalBlocked} onClick={() => setArchiveTarget({ operation: "archive", category: target.category })}>Arxivlash</button>
      </div>
      <dialog ref={archiveDialog} className={styles.dialog} role="alertdialog" aria-labelledby="archive-category-title" aria-describedby="archive-category-description" onCancel={event => { event.preventDefault(); setArchiveTarget(null); }}>
        <h2 id="archive-category-title">Toifani arxivlaysizmi?</h2>
        <p id="archive-category-description">“{archiveTarget?.category.name}” yangi yozuvlarda tanlanmaydi.</p>
        <div className={styles.actions}>
          <button type="button" className="button button-secondary" onClick={() => setArchiveTarget(null)}>Ortga</button>
          <button type="button" className="button button-primary" onClick={confirmArchive}>Arxivlash</button>
        </div>
      </dialog>
    </section>;
  }

  const creating = target.operation === "create";
  return <section className={styles.panel} aria-label={creating ? "Yangi toifa" : "Toifa nomini o‘zgartirish"}>
    <div className={styles.heading}>
      <div><h2>{creating ? "Yangi toifa" : "Toifa nomi"}</h2><p>{creating ? "Qisqa va tushunarli nom yozing." : `Hozirgi nom: “${target.category.name}”`}</p></div>
      <button type="button" className={styles.close} onClick={onClose} aria-label="Panelni yopish">Yopish</button>
    </div>
    <form key={targetKey} className={styles.form} onSubmit={submitForm}>
      <label htmlFor="category-name">Toifa nomi</label>
      <input id="category-name" name="categoryName" defaultValue={creating ? "" : target.category.name} onChange={() => setError("")} required disabled={submitting || journalBlocked} autoComplete="off" />
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.actions}>
        <button type="button" className="button button-secondary" disabled={submitting} onClick={onClose}>Yopish</button>
        <button type="submit" className="button button-primary" disabled={submitting || journalBlocked}>{submitting ? "Yuborilmoqda…" : "Saqlash"}</button>
      </div>
    </form>
  </section>;
}
