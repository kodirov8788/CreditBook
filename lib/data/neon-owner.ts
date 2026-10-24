/** Server-only SQL boundary rehearsal. Not enabled by any application route. */
export type NeonSqlValue = string | number | boolean | null;
export type NeonStatement = Readonly<{ text: string; values: readonly NeonSqlValue[] }>;
export type NeonRows = readonly Readonly<Record<string, unknown>>[];

/** Must execute the entire list atomically, on ONE connection, with rollback on
 * any failure. Never implement this as independent pooled queries. SQL text is
 * trusted server code; only values may originate from a request.
 */
export type NeonAtomicExecutor = (
  statements: readonly NeonStatement[], signal?: AbortSignal,
) => Promise<readonly NeonRows[]>;

export type ExistingAuthVerifier = {
  getUser(token: string): Promise<{
    data: { user: { id: string; is_anonymous?: boolean } | null };
    error: unknown;
  }>;
};

export class NeonOwnerAuthorizationError extends Error {
  constructor() { super("Verified owner required for data access."); }
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Preserve the existing Supabase Auth UUID, never an email or decoded JWT.
 * expectedOwnerId binds a stale UI intent, not authority. Auth and the database's
 * active identity registry independently gate every operation. No identity is
 * auto-enrolled here. A SQL login carrying this role is a trusted server secret,
 * not a client credential: custom session settings are NOT JWT verification.
 */
export async function runNeonOwnerBatch(options: {
  auth: ExistingAuthVerifier;
  token: string;
  expectedOwnerId: string;
  statements: readonly NeonStatement[];
  execute: NeonAtomicExecutor;
  signal?: AbortSignal;
}): Promise<readonly NeonRows[]> {
  const { auth, token, expectedOwnerId, execute, signal } = options;
  signal?.throwIfAborted();
  if (!token || !uuid.test(expectedOwnerId) || options.statements.length === 0
    || options.statements.length > 50) throw new NeonOwnerAuthorizationError();
  // Snapshot the caller's intent before waiting on mutable authentication state.
  const statements = options.statements.map(statement => ({
    text: statement.text, values: [...statement.values],
  }));
  let result: Awaited<ReturnType<ExistingAuthVerifier["getUser"]>>;
  try { result = await auth.getUser(token); }
  catch { throw new NeonOwnerAuthorizationError(); }
  signal?.throwIfAborted();
  const user = result.data.user;
  if (result.error || !user || user.is_anonymous || !uuid.test(user.id)
    || user.id.toLowerCase() !== expectedOwnerId.toLowerCase()) {
    throw new NeonOwnerAuthorizationError();
  }
  const owner = user.id.toLowerCase();
  const batch: NeonStatement[] = [
    { text: "set local role creditbook_neon_app", values: [] },
    { text: "select set_config('creditbook.owner_id', $1, true)", values: [owner] },
    { text: "select creditbook_neon_private.require_owner($1::uuid)", values: [owner] },
    ...statements,
  ];
  signal?.throwIfAborted();
  const rows = await execute(batch, signal);
  if (rows.length !== batch.length) throw new Error("Atomic SQL result contract mismatch.");
  return rows.slice(3);
}

function qaResponse(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

/** Local QA only. No app route imports this handler. Fixed operations, never
 * client SQL, ambient cookies or a client-supplied authoritative owner. */
export async function handleNeonCategoryQa(request: Request, dependencies: {
  auth: ExistingAuthVerifier; execute: NeonAtomicExecutor;
}): Promise<Response> {
  if (request.method !== "GET" && request.method !== "POST") {
    const response = qaResponse(405, { error: "METHOD_NOT_ALLOWED" });
    response.headers.set("Allow", "GET, POST");
    return response;
  }
  const token = request.headers.get("authorization")?.match(/^Bearer ([^\s]+)$/i)?.[1];
  const expectedOwnerId = request.headers.get("X-CreditBook-Owner") ?? "";
  if (!token || !uuid.test(expectedOwnerId)) return qaResponse(401, { error: "UNAUTHORIZED" });
  let statement: NeonStatement;
  if (request.method === "GET") {
    const params = new URL(request.url).searchParams;
    const offset = params.get("offset") ?? "0";
    if ([...params.keys()].some(key => key !== "offset") || params.getAll("offset").length > 1
      || !/^(0|[1-9]\d{0,5})$/.test(offset)) return qaResponse(400, { error: "INVALID_INPUT" });
    statement = { text: "select id,name,version from creditbook_neon_data.qa_categories order by id limit 101 offset $1::integer", values: [Number(offset)] };
  } else {
    if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
      return qaResponse(415, { error: "JSON_REQUIRED" });
    }
    // Count actual streamed bytes rather than trusting Content-Length.
    const reader = request.body?.getReader();
    if (!reader) return qaResponse(400, { error: "INVALID_INPUT" });
    let body: unknown;
    try {
      const decoder = new TextDecoder("utf-8", { fatal: true });
      let size = 0, text = "";
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 8192) { await reader.cancel(); return qaResponse(413, { error: "BODY_TOO_LARGE" }); }
        text += decoder.decode(chunk.value, { stream: true });
      }
      body = JSON.parse(text + decoder.decode());
    } catch { return qaResponse(400, { error: "INVALID_INPUT" }); }
    finally { reader.releaseLock(); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return qaResponse(400, { error: "INVALID_INPUT" });
    const input = body as Record<string, unknown>;
    if (Object.keys(input).some(key => key !== "name" && key !== "clientKey")
      || typeof input.name !== "string" || typeof input.clientKey !== "string"
      || !uuid.test(input.clientKey) || input.name.includes("\u0000")
      || [...input.name.trim()].length < 1 || [...input.name.trim()].length > 80) {
      return qaResponse(400, { error: "INVALID_INPUT" });
    }
    statement = { text: "select creditbook_neon_private.create_category_once($1::text,$2::uuid) as result",
      values: [input.name.trim(), input.clientKey.toLowerCase()] };
  }
  try {
    const [rows] = await runNeonOwnerBatch({ ...dependencies, token, expectedOwnerId,
      statements: [statement], signal: request.signal });
    if (request.method === "GET") {
      return qaResponse(200, { categories: rows.slice(0, 100), hasMore: rows.length > 100 });
    }
    const result = rows[0]?.result;
    if (rows.length !== 1 || !result || typeof result !== "object" || Array.isArray(result)) {
      throw new Error("Invalid command receipt");
    }
    const receipt = result as Record<string, unknown>;
    if (typeof receipt.id !== "string" || !uuid.test(receipt.id)
      || receipt.clientKey !== statement.values[1] || receipt.name !== statement.values[0]
      || typeof receipt.replayed !== "boolean") throw new Error("Invalid command receipt");
    return qaResponse(receipt.replayed ? 200 : 201, {
      id: receipt.id, name: receipt.name, clientKey: receipt.clientKey, replayed: receipt.replayed,
    });
  } catch (error) {
    if (error instanceof NeonOwnerAuthorizationError) return qaResponse(401, { error: "UNAUTHORIZED" });
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code === "42501") return qaResponse(403, { error: "FORBIDDEN" });
    if (code === "23505") return qaResponse(409, { error: "COMMAND_CONFLICT" });
    return qaResponse(500, { error: "DATA_OPERATION_FAILED" });
  }
}
