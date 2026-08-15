"use client";

import { useState } from "react";

export default function AdminUserActions({ userId, banned }: { userId: string; banned: boolean }) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function toggleStatus() {
    setLoading(true);
    setMessage("");
    const response = await fetch(`/api/admin/users/${userId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: banned ? "active" : "suspended" }) });
    setMessage(response.ok ? (banned ? "Account qayta faollashtirildi." : "Account bloklandi.") : "Amal bajarilmadi.");
    setLoading(false);
  }

  return <div className="admin-action-box"><button className={`button ${banned ? "button-primary" : "button-danger"}`} onClick={() => void toggleStatus()} disabled={loading}>{loading ? "Saqlanmoqda..." : banned ? "Accountni faollashtirish" : "Accountni bloklash"}</button>{message && <span className="admin-action-message" role="status">{message}</span>}</div>;
}
