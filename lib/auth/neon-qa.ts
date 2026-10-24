/** Isolated local QA protocol. Never imported by the CreditBook application. */
export type QaAuthResult = { data: unknown; error: unknown };
export type QaAuth = {
  login(input: { email: string; password: string }): Promise<QaAuthResult>;
  session(): Promise<QaAuthResult>;
  logout(): Promise<QaAuthResult>;
};
export type QaRecord = { id: string; name: string };
export type QaReceipt = QaRecord & { clientKey: string; replayed: boolean };
export type QaRecords = {
  list(owner: string, id?: string, signal?: AbortSignal): Promise<QaRecord[]>;
  create(owner: string, name: string, clientKey: string, signal?: AbortSignal): Promise<QaReceipt>;
};
export type QaAuthFactory = (request: Request, appendCookie: (cookie: string) => void) => QaAuth;

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isQaUuid = (value: unknown): value is string => typeof value === "string" && uuid.test(value);

class QaFailure extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message); this.status = status; this.code = code;
  }
}

function subject(result: QaAuthResult): string {
  if (result.error) {
    const error = result.error as { code?: unknown; status?: unknown };
    if (error.status === 401 || error.code === "UNAUTHORIZED" || error.code === "SESSION_EXPIRED") {
      throw new QaFailure(401, "UNAUTHORIZED", "Qayta kiring.");
    }
    throw new QaFailure(503, "AUTH_UNAVAILABLE", "Kirish xizmatini tekshirib bo‘lmadi.");
  }
  const data = result.data as { user?: { id?: unknown; is_anonymous?: unknown } } | null;
  if (!data?.user || !isQaUuid(data.user.id) || data.user.is_anonymous === true) {
    throw new QaFailure(401, "UNAUTHORIZED", "Qayta kiring.");
  }
  return data.user.id.toLowerCase();
}

export async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new QaFailure(415, "JSON_REQUIRED", "JSON kerak.");
  }
  const reader = request.body?.getReader();
  if (!reader) throw new QaFailure(400, "INVALID_INPUT", "Ma’lumot kiriting.");
  let body = "", bytes = 0;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 8192) {
        await reader.cancel();
        throw new QaFailure(413, "BODY_TOO_LARGE", "Ma’lumot hajmi juda katta.");
      }
      body += decoder.decode(chunk.value, { stream: true });
    }
    const parsed: unknown = JSON.parse(body + decoder.decode());
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid object");
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof QaFailure) throw error;
    throw new QaFailure(400, "INVALID_INPUT", "Ma’lumot noto‘g‘ri.");
  } finally { reader.releaseLock(); }
}

export function qaSecurityHeaders(): Headers {
  return new Headers({
    "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY",
    "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  });
}

export function createNeonQaHandler(config: {
  origin: string; owners: readonly string[]; auth: QaAuthFactory; records: QaRecords;
  assets: ReadonlyMap<string, { text: string; type: string }>;
}) {
  const origin = new URL(config.origin);
  if (origin.protocol !== "http:" || origin.hostname !== "localhost" || !origin.port || origin.origin !== config.origin) {
    throw new Error("Only a fixed loopback HTTP origin is permitted.");
  }
  if (config.owners.length !== 2 || !config.owners.every(isQaUuid)
    || new Set(config.owners.map(id => id.toLowerCase())).size !== 2) {
    throw new Error("Exactly two explicit QA UUIDs are required.");
  }
  const owners = new Set(config.owners.map(id => id.toLowerCase()));
  const { auth: authFactory, records, assets } = config;
  return async (request: Request): Promise<Response> => {
    const cookieHeaders: string[] = [];
    const headers = qaSecurityHeaders();
    const reply = (status: number, body: unknown) => {
      for (const cookie of cookieHeaders) headers.append("Set-Cookie", cookie);
      headers.set("Content-Type", "application/json; charset=utf-8");
      return new Response(JSON.stringify(body), { status, headers });
    };
    try {
      request.signal.throwIfAborted();
      const url = new URL(request.url);
      if (url.origin !== origin.origin || request.headers.get("host") !== origin.host) {
        throw new QaFailure(403, "INVALID_HOST", "Lokal manzil mos emas.");
      }
      if (request.headers.has("authorization")) throw new QaFailure(401, "UNAUTHORIZED", "Faqat QA cookie sessiyasi qabul qilinadi.");
      if (request.method !== "GET" && request.method !== "POST") {
        headers.set("Allow", "GET, POST");
        throw new QaFailure(405, "METHOD_NOT_ALLOWED", "Amal qo‘llanmaydi.");
      }
      if (request.method === "POST" && request.headers.get("origin") !== origin.origin) {
        throw new QaFailure(403, "INVALID_ORIGIN", "So‘rov manzili mos emas.");
      }
      const asset = assets.get(url.pathname);
      if (asset && request.method === "GET" && !url.search) {
        headers.set("Content-Type", asset.type);
        return new Response(asset.text, { headers });
      }
      const isRecords = url.pathname === "/qa/records";
      const isLogin = url.pathname === "/qa/auth/login" && request.method === "POST";
      const isLogout = url.pathname === "/qa/auth/logout" && request.method === "POST";
      const isSession = url.pathname === "/qa/auth/session" && request.method === "GET";
      if (!isRecords && !isLogin && !isLogout && !isSession) throw new QaFailure(404, "NOT_FOUND", "Topilmadi.");
      if ((!isRecords || request.method === "POST") && url.search) throw new QaFailure(400, "INVALID_INPUT", "So‘rov noto‘g‘ri.");
      const auth = authFactory(request, cookie => cookieHeaders.push(cookie));
      if (isLogin) {
        const body = await jsonBody(request);
        if (Object.keys(body).some(key => key !== "email" && key !== "password")
          || typeof body.email !== "string" || body.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim())
          || typeof body.password !== "string" || !body.password || body.password.length > 1024) {
          throw new QaFailure(400, "INVALID_INPUT", "Email va parolni tekshiring.");
        }
        const result = await auth.login({ email: body.email.trim(), password: body.password });
        body.password = "";
        request.signal.throwIfAborted();
        if (result.error) {
          const code = (result.error as { code?: unknown }).code;
          if (typeof code === "string" && (code.startsWith("NETWORK_") || code === "INTERNAL_ERROR")) {
            throw new QaFailure(503, "AUTH_UNAVAILABLE", "Kirish xizmati ishlamayapti.");
          }
          throw new QaFailure(401, "LOGIN_FAILED", "Email yoki parol noto‘g‘ri.");
        }
        const owner = subject(await auth.session());
        request.signal.throwIfAborted();
        if (!owners.has(owner)) {
          await auth.logout();
          throw new QaFailure(403, "QA_ACCESS_DENIED", "Faqat ikki QA akkauntiga ruxsat bor.");
        }
        return reply(200, { user: { id: owner } });
      }
      if (isLogout) {
        const body = await jsonBody(request);
        if (Object.keys(body).length) throw new QaFailure(400, "INVALID_INPUT", "So‘rov noto‘g‘ri.");
        if ((await auth.logout()).error) throw new QaFailure(503, "AUTH_UNAVAILABLE", "Chiqilmadi. Qayta urining.");
        return reply(200, { ok: true });
      }
      const owner = subject(await auth.session());
      request.signal.throwIfAborted();
      if (!owners.has(owner)) throw new QaFailure(403, "QA_ACCESS_DENIED", "QA ruxsati yo‘q.");
      if (isSession) return reply(200, { user: { id: owner } });
      const intended = request.headers.get("X-CreditBook-Owner");
      if (!isQaUuid(intended)) throw new QaFailure(400, "OWNER_REQUIRED", "QA akkauntini tanlang.");
      if (intended.toLowerCase() !== owner) throw new QaFailure(409, "OWNER_CHANGED", "Akkaunt o‘zgardi. Qayta kiring.");
      if (request.method === "GET") {
        const id = url.searchParams.get("id");
        if ([...url.searchParams.keys()].some(key => key !== "id") || url.searchParams.getAll("id").length > 1
          || (id !== null && !isQaUuid(id))) throw new QaFailure(400, "INVALID_INPUT", "So‘rov noto‘g‘ri.");
        const rows = await records.list(owner, id?.toLowerCase(), request.signal);
        if (id && rows.length === 0) throw new QaFailure(404, "NOT_FOUND", "Yozuv topilmadi.");
        return reply(200, { records: rows.slice(0, 100), hasMore: rows.length > 100 });
      }
      const body = await jsonBody(request);
      if (Object.keys(body).some(key => key !== "name" && key !== "clientKey")
        || typeof body.name !== "string" || body.name.includes("\u0000")
        || [...body.name.trim()].length < 1 || [...body.name.trim()].length > 80 || !isQaUuid(body.clientKey)) {
        throw new QaFailure(400, "INVALID_INPUT", "Izoh va takrorlanmas kalit kerak.");
      }
      request.signal.throwIfAborted();
      const receipt = await records.create(owner, body.name.trim(), body.clientKey.toLowerCase(), request.signal);
      return reply(receipt.replayed ? 200 : 201, receipt);
    } catch (error) {
      if (error instanceof QaFailure) return reply(error.status, { code: error.code, error: error.message });
      const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
      if (code === "42501") return reply(403, { code: "FORBIDDEN", error: "Ruxsat yo‘q." });
      if (code === "23505") return reply(409, { code: "COMMAND_CONFLICT", error: "Kalit boshqa yozuv uchun ishlatilgan." });
      return reply(503, { code: "QA_UNAVAILABLE", error: "QA xizmati ishlamayapti. Qayta tekshiring." });
    }
  };
}
