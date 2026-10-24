/** Public identity only. Session tokens, cookies and provider metadata stay server-side. */
export type AuthIdentity = Readonly<{ id: string; email: string }>;

export type SessionReply =
  | Readonly<{ ok: true; user: AuthIdentity }>
  | Readonly<{ ok: false; code: string }>;

export function isAuthIdentity(value: unknown): value is AuthIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const user = value as Record<string, unknown>;
  return typeof user.id === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(user.id)
    && typeof user.email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.email);
}
