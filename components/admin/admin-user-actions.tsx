"use client";

import { useState } from "react";

export default function AdminUserActions({ userId, banned }: { userId: string; banned: boolean }) {
  const [currentBanned, setCurrentBanned] = useState(banned);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function toggleStatus() {
    setLoading(true);
    setMessage("");
    const response = await fetch(`/api/admin/users/${userId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: currentBanned ? "active" : "suspended" }) });
    if (response.ok) {
      setCurrentBanned((current) => !current);
      setMessage(currentBanned ? "Account qayta faollashtirildi." : "Account bloklandi.");
    } else {
      setMessage("Amal bajarilmadi.");
    }
    setLoading(false);
  }

  return <div className="admin-action-box"><button className={`button ${currentBanned ? "button-primary" : "button-danger"}`} onClick={() => void toggleStatus()} disabled={loading}>{loading ? "Saqlanmoqda..." : currentBanned ? "Accountni faollashtirish" : "Accountni bloklash"}</button>{message && <span className="admin-action-message" role="status">{message}</span>}</div>;
}
