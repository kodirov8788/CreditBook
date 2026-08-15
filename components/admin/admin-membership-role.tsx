"use client";

import { useState } from "react";
import { TEAM_ROLE_LABELS, TEAM_ROLES } from "@/lib/team-roles";

const roles = TEAM_ROLES;

export default function AdminMembershipRole({ userId, shopId, initialRole }: { userId: string; shopId: string; initialRole: string }) {
  const [role, setRole] = useState(initialRole);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function updateRole(nextRole: string) {
    setRole(nextRole);
    setSaving(true);
    setMessage("");
    const response = await fetch(`/api/admin/users/${userId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shopId, role: nextRole }) });
    if (!response.ok) {
      setRole(initialRole);
      setMessage("Rolni o‘zgartirib bo‘lmadi.");
    } else {
      setMessage("Saqlandi");
    }
    setSaving(false);
  }

  return <span className="admin-role-control"><select value={role} onChange={(event) => void updateRole(event.target.value)} disabled={saving} aria-label="Shop roli">{roles.map((item) => <option key={item} value={item}>{TEAM_ROLE_LABELS[item]}</option>)}</select>{message && <small>{message}</small>}</span>;
}
