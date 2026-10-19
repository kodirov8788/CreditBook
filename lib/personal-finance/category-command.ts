// Pure retry/receipt contract. Not a device queue, authentication or storage layer.
export type CategoryCommand =
  | Readonly<{ operation: "create"; name: string }>
  | Readonly<{ operation: "rename"; categoryId: string; categoryVersion: number; name: string }>
  | Readonly<{ operation: "archive"; categoryId: string; categoryVersion: number }>;
export type CategoryIntent = Readonly<{ ownerId: string; clientKey: string; command: CategoryCommand }>;
type CategoryReceipt = Readonly<{ categoryId: string; categoryVersion: number; commandId: string; replayed: boolean }>;
export type CategoryCommandOutcome =
  | Readonly<{ kind: "saved"; receipt: CategoryReceipt; clearIntent: true }>
  | Readonly<{ kind: "blocked" | "conflict" | "invalid" | "retry"; clearIntent: false }>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const keyPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const invalid = () => new Error("INVALID_CATEGORY_INTENT");
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
}
function exactKeys(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) throw invalid();
}
function validUuid(value: unknown): value is string { return typeof value === "string" && uuid.test(value); }
function name(value: unknown): string {
  if (typeof value !== "string") throw invalid();
  const trimmed = value.replace(/^ +| +$/g, ""); // Match DB btrim, but NEVER rewrite a saved payload.
  if ([...trimmed].length < 1 || [...trimmed].length > 80 || [...value].some(char => {
    const code = char.codePointAt(0)!;
    return code < 32 || (code >= 127 && code <= 159) || (code >= 0xd800 && code <= 0xdfff);
  })) throw invalid();
  return value;
}
function command(value: unknown): CategoryCommand {
  const row = object(value);
  if (row.operation === "create") {
    exactKeys(row, ["operation", "name"]);
    return { operation: "create", name: name(row.name) };
  }
  if (row.operation !== "rename" && row.operation !== "archive") throw invalid();
  exactKeys(row, row.operation === "rename" ? ["operation", "categoryId", "categoryVersion", "name"] : ["operation", "categoryId", "categoryVersion"]);
  if (!validUuid(row.categoryId) || typeof row.categoryVersion !== "number" || !Number.isSafeInteger(row.categoryVersion)
    || row.categoryVersion < 1 || row.categoryVersion > 999999999) throw invalid();
  const target = { categoryId: row.categoryId, categoryVersion: row.categoryVersion };
  return row.operation === "rename"
    ? { operation: "rename", ...target, name: name(row.name) }
    : { operation: "archive", ...target };
}

export function createCategoryIntent(ownerId: unknown, clientKey: unknown, value: unknown): CategoryIntent {
  if (!validUuid(ownerId) || typeof clientKey !== "string" || !keyPattern.test(clientKey)) throw invalid();
  const parsed = command(value);
  // PostgreSQL jsonb::text includes separator spaces; key ordering does not
  // affect byte length for these flat primitive-only command objects.
  const databaseJson = "{" + Object.entries(parsed).map(([key, value]) => JSON.stringify(key) + ": " + JSON.stringify(value)).join(", ") + "}";
  if (new TextEncoder().encode(databaseJson).byteLength > 4096) throw invalid();
  return Object.freeze({ ownerId: ownerId.toLowerCase(), clientKey, command: Object.freeze(parsed) });
}

export function restoreCategoryIntent(raw: string, expectedOwnerId: string): CategoryIntent {
  if (typeof raw !== "string" || raw.length > 8192 || new TextEncoder().encode(raw).byteLength > 8192) throw invalid();
  const saved = object(JSON.parse(raw));
  exactKeys(saved, ["ownerId", "clientKey", "command"]);
  if (!validUuid(expectedOwnerId) || !validUuid(saved.ownerId) || saved.ownerId.toLowerCase() !== expectedOwnerId.toLowerCase()) throw invalid();
  return createCategoryIntent(saved.ownerId, saved.clientKey, saved.command);
}

/** Caller must derive activeOwnerId from a verified live session, not storage. */
export function categoryCommandPayload(intent: CategoryIntent, activeOwnerId: string) {
  if (!validUuid(activeOwnerId) || !validUuid(intent.ownerId) || intent.ownerId.toLowerCase() !== activeOwnerId.toLowerCase()) throw invalid();
  const checked = createCategoryIntent(intent.ownerId, intent.clientKey, intent.command);
  return Object.freeze({ clientKey: checked.clientKey, command: checked.command });
}

/** Only a structurally and semantically matching acknowledgement clears intent. */
export function categoryCommandOutcome(intent: CategoryIntent, status: number, value: unknown): CategoryCommandOutcome {
  const retain = (kind: "blocked" | "conflict" | "invalid" | "retry"): CategoryCommandOutcome => ({ kind, clearIntent: false });
  if (status === 401 || status === 403) return retain("blocked");
  const row = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  if (status === 409 && row?.code === "CONFLICT") return retain("conflict");
  if (status === 400 && typeof row?.error === "string") return retain("invalid");
  if ((status !== 200 && status !== 201) || !row || !validUuid(row.categoryId) || !validUuid(row.commandId)
    || typeof row.categoryVersion !== "number" || !Number.isSafeInteger(row.categoryVersion) || row.categoryVersion < 1
    || typeof row.replayed !== "boolean" || typeof row.clientKey !== "string"
    || row.clientKey.toLowerCase() !== intent.clientKey.toLowerCase()) return retain("retry");
  const expectedVersion = intent.command.operation === "create" ? 1 : intent.command.categoryVersion + 1;
  const expectedStatus = intent.command.operation === "create" && !row.replayed ? 201 : 200;
  if (status !== expectedStatus || row.categoryVersion !== expectedVersion ||
    (intent.command.operation !== "create" && row.categoryId.toLowerCase() !== intent.command.categoryId.toLowerCase())) return retain("retry");
  return { kind: "saved", clearIntent: true, receipt: {
    categoryId: row.categoryId, categoryVersion: row.categoryVersion, commandId: row.commandId, replayed: row.replayed,
  } };
}
