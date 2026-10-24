"use client";

import { useEffect, useRef, useState } from "react";
import { readSession } from "@/lib/auth/client";
import { localDate } from "@/lib/personal-finance/accounts";

/** Test harness, not the personal product UI. Rendered only by the local QA page.
 * Owner is captured once; the stale tab never adopts a newly logged-in account.
 */
export default function NeonPersonalQa() {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("QA toifa");
  const [output, setOutput] = useState("Sessiya tekshirilmoqda…");
  const [busy, setBusy] = useState(false);
  const owner = useRef<string | null>(null);
  const running = useRef(false);
  useEffect(() => {
    let mounted = true;
    const controller = new AbortController();
    void readSession(controller.signal).then(result => {
      if (!mounted) return;
      if (result.ok) { owner.current = result.user.id; setEmail(result.user.email); setOutput("Tayyor. Faqat vaqtinchalik lokal ma’lumot yoziladi."); }
      else setOutput("Avval shu lokal serverdagi login sahifasiga kiring.");
    }).catch(() => { if (mounted) setOutput("Sessiya tekshirilmadi."); });
    return () => { mounted = false; controller.abort(); };
  }, []);

  async function call(path: string, method = "GET", body?: object) {
    if (!owner.current) throw new Error("Kirish kerak.");
    const response = await fetch(path, { method, credentials: "same-origin", cache: "no-store", redirect: "error",
      signal: AbortSignal.timeout(30000), headers: { "X-CreditBook-Owner": owner.current,
        ...(method !== "GET" ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: await response.json() };
  }
  async function run(staleOnly = false) {
    if (running.current) return;
    running.current = true; setBusy(true); setOutput("");
    const lines: string[] = [];
    const pass = (label: string, condition: boolean) => {
      if (!condition) throw new Error(label);
      lines.push("PASS · " + label); setOutput(lines.join("\n"));
    };
    try {
      if (staleOnly) {
        const rejected = await call("/api/personal/categories", "POST", {
          clientKey: crypto.randomUUID(), command: { operation: "create", name: "STALE-TAB-MUST-NOT-SAVE" },
        });
        pass("Eski tab yozuvi rad etildi (409)", rejected.status === 409 && rejected.data.code === "OWNER_CHANGED");
        return;
      }
      const workspace = await call("/api/personal/workspace", "POST", {});
      pass("O‘z workspace’i (200)", workspace.status === 200 && !!workspace.data.workspace?.id);
      const before = await call("/api/personal/book");
      pass("Hisobni o‘qish (200)", before.status === 200);
      if (before.data.state === "empty") {
        const key = crypto.randomUUID(), command = { openingAmountMinor: "0", openingDate: localDate("Asia/Tokyo") };
        const created = await call("/api/personal/book", "POST", { clientKey: key, command });
        const replay = await call("/api/personal/book", "POST", { clientKey: key, command });
        pass("Bitta hisob yaratildi (201)", created.status === 201 && created.data.replayed === false);
        pass("Hisob qayta yuborildi: dublikat yo‘q (200)", replay.status === 200 && replay.data.replayed === true
          && replay.data.accountId === created.data.accountId);
      }
      const book = await call("/api/personal/book"), accounts = await call("/api/personal/accounts");
      pass("Bitta JPY hisob va aniq nol qoldiq", book.status === 200 && book.data.book?.currencyCode === "JPY"
        && book.data.book.balanceMinor === "0" && accounts.status === 200 && accounts.data.accounts?.length === 1);
      const key = crypto.randomUUID(), command = { operation: "create", name: name.trim() };
      const created = await call("/api/personal/categories", "POST", { clientKey: key, command });
      const replay = await call("/api/personal/categories", "POST", { clientKey: key, command });
      pass("Toifa yaratildi (201)", created.status === 201 && typeof created.data.categoryId === "string");
      pass("Toifa qayta yuborildi: dublikat yo‘q (200)", replay.status === 200 && replay.data.replayed === true
        && replay.data.categoryId === created.data.categoryId);
      const conflict = await call("/api/personal/categories", "POST", { clientKey: key,
        command: { operation: "create", name: "Changed payload" } });
      pass("Eski kalit bilan boshqa mazmun rad etildi (409)", conflict.status === 409);
      const categoryId = created.data.categoryId;
      const renamed = await call("/api/personal/categories", "POST", { clientKey: crypto.randomUUID(),
        command: { operation: "rename", categoryId, categoryVersion: 1, name: name.trim() + " · yangi" } });
      pass("Toifa nomi yangilandi (200)", renamed.status === 200 && renamed.data.categoryVersion === 2);
      const archived = await call("/api/personal/categories", "POST", { clientKey: crypto.randomUUID(),
        command: { operation: "archive", categoryId, categoryVersion: 2 } });
      pass("Toifa arxivlandi (200)", archived.status === 200 && archived.data.categoryVersion === 3);
      const all = await call("/api/personal/categories?status=all");
      pass("Saqlangan toifa ro‘yxatda (200)", all.status === 200
        && all.data.categories?.filter((row: { id: string }) => row.id === categoryId).length === 1);
      lines.push("Ko‘rinadigan toifalar: " + all.data.categories.map((row: { name: string }) => row.name).join(", "));
      setOutput(lines.join("\n"));
    } catch (error) { setOutput([...lines, "FAIL · " + (error instanceof Error ? error.message : "Sinov bajarilmadi.")].join("\n")); }
    finally { running.current = false; setBusy(false); }
  }
  async function list() {
    if (running.current) return;
    running.current = true; setBusy(true);
    try { const result = await call("/api/personal/categories?status=all"); setOutput(JSON.stringify(result, null, 2)); }
    catch { setOutput("Ro‘yxat olinmadi."); } finally { running.current = false; setBusy(false); }
  }
  return <main className="login-shell"><section className="login-card">
    <h1>Shaxsiy API · lokal QA</h1><p>Neon Auth + yangi vaqtinchalik PostgreSQL. Production emas.</p>
    <p data-testid="qa-email">{email || "Kirish kerak"}</p><a href="/login">Login sahifasi</a>
    <div className="field"><label htmlFor="qa-name">Sinov toifasi nomi</label>
      <input id="qa-name" value={name} maxLength={60} disabled={busy} onChange={event => setName(event.target.value)} /></div>
    <button className="button button-primary" disabled={busy || !email} onClick={() => void run()}>API sinovini bajarish</button>
    <button className="button" disabled={busy || !email} onClick={() => void list()}>Toifalarni ko‘rish</button>
    <button className="button" disabled={busy || !email} onClick={() => void run(true)}>Eski tabdan yozishni tekshirish</button>
    <pre role="status" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{output}</pre>
  </section></main>;
}
