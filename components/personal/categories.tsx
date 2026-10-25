"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import {
  mergeCategoryList,
  parseCategoryList,
  type CategoryListItem,
} from "@/lib/personal-finance/category-list";
import styles from "./categories.module.css";
import CategoryEditor, { type CategoryEditorTarget } from "./category-editor";

type CategoryStatus = "active" | "archived";

function responseMessage(value: unknown, fallback: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const error = (value as Record<string, unknown>).error;
  return typeof error === "string" && error.trim() ? error : fallback;
}

export default function PersonalCategories({ userId }: { userId: string }) {
  const router = useRouter();
  // Parent is keyed by the verified server user. Abort synchronously on a known
  // identity/permission change, before React's deferred editor unmount.
  const [ownerCancellation] = useState(() => new AbortController());
  const [status, setStatus] = useState<CategoryStatus>("active");
  const [categories, setCategories] = useState<CategoryListItem[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [limitReached, setLimitReached] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [listBusy, setListBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [failedOffset, setFailedOffset] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [editorTarget, setEditorTarget] = useState<CategoryEditorTarget | null>(null);
  const [pendingMutation, setPendingMutation] = useState(true);
  const [savedMessage, setSavedMessage] = useState("");
  const [reconcileRequired, setReconcileRequired] = useState(false);
  const reconciliation = useRef(false);
  const requestSequence = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const loading = useRef(false);
  const identityBlocked = useRef(false);
  const loadedUserId = useRef(userId);

  const invalidate = useCallback(() => {
    requestSequence.current += 1;
    controller.current?.abort();
    controller.current = null;
    loading.current = false;
  }, []);

  const load = useCallback(async (offset: number, replace: boolean) => {
    if (loading.current || identityBlocked.current) return;

    const currentController = new AbortController();
    const sequence = ++requestSequence.current;
    controller.current?.abort();
    controller.current = currentController;
    let timedOut = false;
    const deadline = setTimeout(() => { timedOut = true; currentController.abort(); }, 20000);
    loading.current = true;
    setListBusy(true);
    if (replace) {
      setInitialLoading(true);
      setCategories([]);
      setNextOffset(null);
      setLimitReached(false);
      setFailedOffset(null);
      setError("");
    }

    try {
      const response = await fetch(`/api/personal/categories?status=${status}&offset=${offset}`, {
        cache: "no-store",
        signal: currentController.signal,
      });
      if (sequence !== requestSequence.current || identityBlocked.current) return;
      if (response.status === 401) {
        setCategories([]);
        setNextOffset(null);
        setLimitReached(false);
        setBlocked(true);
        identityBlocked.current = true;
        ownerCancellation.abort();
        router.replace("/login");
        return;
      }
      if (response.status === 403) {
        setCategories([]);
        setNextOffset(null);
        setLimitReached(false);
        setBlocked(true);
        identityBlocked.current = true;
        ownerCancellation.abort();
        setError("Bu toifalarni ko‘rish uchun ruxsat yo‘q.");
        return;
      }

      let value: unknown;
      try {
        value = await response.json();
      } catch {
        throw new Error("Toifalar javobi noto‘g‘ri. Qayta urinib ko‘ring.");
      }
      if (!response.ok) throw new Error(responseMessage(value, "Toifalar olinmadi. Qayta urinib ko‘ring."));

      let page;
      try {
        page = parseCategoryList(value, offset);
      } catch {
        throw new Error("Toifalar javobi noto‘g‘ri. Qayta urinib ko‘ring.");
      }
      if (sequence !== requestSequence.current || identityBlocked.current) return;

      setCategories(current => replace ? page.categories : mergeCategoryList(current, page.categories));
      setNextOffset(page.nextOffset);
      setLimitReached(page.paginationLimitReached === true);
      if (replace) {
        reconciliation.current = false;
        setReconcileRequired(false);
      }
      setFailedOffset(null);
      setError("");
    } catch (cause) {
      if (sequence !== requestSequence.current || identityBlocked.current || (currentController.signal.aborted && !timedOut)) return;
      setError(timedOut ? "So‘rov cho‘zildi. Qayta urining." : cause instanceof Error ? cause.message : "Toifalar olinmadi. Qayta urinib ko‘ring.");
      setFailedOffset(offset);
    } finally {
      clearTimeout(deadline);
      if (sequence === requestSequence.current) {
        controller.current = null;
        loading.current = false;
        setListBusy(false);
        setInitialLoading(false);
      }
    }
  }, [ownerCancellation, router, status]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      if (loadedUserId.current !== userId) {
        loadedUserId.current = userId;
        identityBlocked.current = false;
        setBlocked(false);
      }
      void load(0, true);
    });
    return () => {
      active = false;
      invalidate();
    };
  }, [invalidate, load, userId]);

  useEffect(() => {
    let active = true;
    const client = createClient();
    if (!client) return;
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      if (session?.user.id === userId) return;
      identityBlocked.current = true;
      ownerCancellation.abort();
      invalidate();
      void Promise.resolve().then(() => {
        if (!active) return;
        setCategories([]);
        setNextOffset(null);
        setLimitReached(false);
        setBlocked(true);
        setInitialLoading(false);
        setListBusy(false);
        setFailedOffset(null);
        setError("Kirish holati o‘zgardi. Sahifa yangilanmoqda.");
        router.refresh();
      });
    });
    return () => { active = false; subscription.unsubscribe(); };
  }, [invalidate, ownerCancellation, router, userId]);

  function changeStatus(checked: boolean) {
    if (listBusy || blocked) return;
    setLimitReached(false);
    setCategories([]);
    setNextOffset(null);
    setFailedOffset(null);
    setError("");
    setInitialLoading(true);
    setStatus(checked ? "archived" : "active");
  }

  function retry() {
    if (blocked || listBusy) return;
    const offset = failedOffset ?? 0;
    void load(offset, offset === 0);
  }

  function openEditor(target: CategoryEditorTarget) {
    if (blocked || identityBlocked.current || pendingMutation || reconciliation.current) return;
    setSavedMessage("");
    setEditorTarget(target);
  }

  function mutationSaved() {
    if (identityBlocked.current) return;
    setEditorTarget(null);
    setSavedMessage("Toifa saqlandi.");
    invalidate();
    void load(0, true);
  }

  function mutationDiscarded() {
    if (identityBlocked.current) return;
    reconciliation.current = true;
    setReconcileRequired(true);
    setEditorTarget(null);
    setSavedMessage("Mahalliy qayta urinish bekor qilindi. Serverdagi holat tekshirilmoqda.");
    invalidate();
    void load(0, true);
  }

  const isPaginationRetry = failedOffset !== null && failedOffset > 0;
  const isEmpty = !blocked && !initialLoading && !listBusy && !error && categories.length === 0;

  return <main className={`personal-shell ${styles.page}`}>
    <Link href="/personal" prefetch={false} className={styles.backLink}>Hisobga qaytish</Link>
    <header className={styles.heading}>
      <h1>Toifalar</h1>
      <p>Shaxsiy kirim va chiqimlarni tartiblash uchun toifalar.</p>
    </header>

    {!blocked && <>
      <button type="button" className="button button-primary" disabled={pendingMutation || listBusy || reconcileRequired}
        onClick={() => openEditor({ operation: "create" })}>Toifa qo‘shish</button>
      <CategoryEditor key={userId} userId={userId} ownerSignal={ownerCancellation.signal} target={editorTarget}
        onClose={() => setEditorTarget(null)} onSaved={mutationSaved} onDiscarded={mutationDiscarded} onPendingChange={setPendingMutation} />
      {savedMessage && <p role="status" className={styles.loading}>{savedMessage}</p>}
    </>}

    <div className={styles.listControls}>
    <label className={styles.filter}>
      <input
        type="checkbox"
        checked={status === "archived"}
        disabled={listBusy || blocked}
        onChange={event => changeStatus(event.target.checked)}
      />
      Arxivdagilar
    </label>
    {!blocked && <button type="button" className="button button-secondary" disabled={listBusy}
      onClick={() => { invalidate(); void load(0, true); }}>Ro‘yxatni yangilash</button>}
    </div>

    <section className={styles.listCard} aria-label={status === "archived" ? "Arxivdagi toifalar" : "Faol toifalar"}>
      {initialLoading && <p role="status" aria-busy="true" className={styles.loading}>Toifalar yuklanmoqda…</p>}

      {error && <div className={styles.error} role="alert">
        <p>{error}</p>
        {!blocked && <button type="button" className="button button-secondary" disabled={listBusy} onClick={retry}>
          {isPaginationRetry ? "Yana" : "Qayta urinish"}
        </button>}
      </div>}

      {!initialLoading && categories.length > 0 && <ul className={styles.list}>
        {categories.map(category => <li key={category.id} className={styles.row}>
          <span className={styles.name}>{category.name}</span>
          <span className={styles.status}>{category.status === "archived" ? "Arxiv" : "Faol"}</span>
          {category.status === "active" && !blocked && <div className={styles.rowActions}>
            <button type="button" className="button button-secondary" disabled={pendingMutation || listBusy || reconcileRequired}
              aria-label={`${category.name}: nomlash`} onClick={() => openEditor({ operation: "rename", category })}>Nomlash</button>
            <button type="button" className="button button-secondary" disabled={pendingMutation || listBusy || reconcileRequired}
              aria-label={`${category.name}: arxivlash`} onClick={() => openEditor({ operation: "archive", category })}>Arxiv</button>
          </div>}
        </li>)}
      </ul>}
      {limitReached && !blocked && <p role="status" className={styles.loading}>Ro‘yxat chegarasiga yetildi. Barcha toifalar yuklanmadi.</p>}

      {isEmpty && <div className={styles.empty}>
        <h2>{status === "archived" ? "Arxivda toifa yo‘q" : "Hali toifa yo‘q"}</h2>
        <p>{status === "archived" ? "Arxivlangan toifalar bu yerda ko‘rinadi." : "Hozir ko‘rsatish uchun faol toifa yo‘q."}</p>
        {status === "archived" && <Link href="/personal" prefetch={false} className="button button-secondary">Hisobga qaytish</Link>}
      </div>}

      {nextOffset !== null && !isPaginationRetry && !blocked && <button
        type="button"
        className="button button-secondary"
        disabled={listBusy}
        onClick={() => void load(nextOffset, false)}
      >Yana</button>}
    </section>
  </main>;
}
