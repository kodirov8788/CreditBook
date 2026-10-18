const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const timestamp = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|\+00:00)$/;
export type HistoryCursor = { accountId: string; id: string; recordedAt: string };

/** Cursor is an untrusted position, never an authorization token. */
export function decodeHistoryCursor(raw: string, accountId: string): HistoryCursor {
  if (!/^[A-Za-z0-9_-]{1,512}$/.test(raw)) throw new Error("Invalid cursor");
  const value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as HistoryCursor;
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some(key => !["accountId", "id", "recordedAt"].includes(key))
    || value.accountId !== accountId || typeof value.id !== "string" || !uuid.test(value.id)
    || typeof value.recordedAt !== "string" || !timestamp.test(value.recordedAt)
    || value.recordedAt.startsWith("0000-")
    || !Number.isFinite(Date.parse(value.recordedAt))
    || new Date(value.recordedAt).toISOString().slice(0,10) !== value.recordedAt.slice(0,10)) throw new Error("Invalid cursor");
  return value;
}

export function encodeHistoryCursor(value: HistoryCursor): string {
  const raw = Buffer.from(JSON.stringify(value)).toString("base64url");
  decodeHistoryCursor(raw, value.accountId);
  return raw;
}
