"use client";

import { useState } from "react";

export default function AdminShopActions({ shopId, status }: { shopId: string; status: string }) {
  const [current, setCurrent] = useState(status);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const next = current === "active" ? "suspended" : "active";

  async function toggle() {
    if (!window.confirm(current === "active" ? "Bu shop to‘xtatilsinmi?" : "Bu shop qayta faollashtirilsinmi?")) return;
    setSaving(true);
    setMessage("");
    const response = await fetch(`/api/admin/shops/${shopId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: next }) });
    if (response.ok) { setCurrent(next); setMessage("Saqlandi"); } else setMessage("Amal bajarilmadi.");
    setSaving(false);
  }

  return <div className="admin-action-box"><button className={`button ${current === "active" ? "button-danger" : "button-primary"}`} onClick={() => void toggle()} disabled={saving}>{saving ? "Saqlanmoqda..." : current === "active" ? "Shop’ni to‘xtatish" : "Shop’ni faollashtirish"}</button>{message && <span className="admin-action-message" role="status">{message}</span>}</div>;
}
