import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuthenticatedClient } from "@/lib/api/auth";
import { readJsonBody } from "@/lib/api/json-body";
import { getPersonalAccess, personalAccessResponse } from "@/lib/api/personal-access";

export const dynamic = "force-dynamic";

const privateHeaders = { "Cache-Control": "private, no-store" };
const clientKeyPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const allowedQueryParameters = new Set(["status", "offset"]);

function response(body: object, status: number) {
  return NextResponse.json(body, { status, headers: privateHeaders });
}

function unauthorized() {
  return response({ error: "Kirish talab qilinadi." }, 401);
}

function forbidden() {
  return response({ error: "Bu amal uchun ruxsat yo'q." }, 403);
}

function badRequest(message = "So‘rov noto‘g‘ri.") {
  return response({ error: message }, 400);
}

function serverError() {
  return response({ error: "Server xatosi." }, 500);
}

function validateListQuery(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  const seen = new Set<string>();

  for (const [key] of searchParams) {
    if (!allowedQueryParameters.has(key) || seen.has(key)) return null;
    seen.add(key);
  }

  const status = searchParams.get("status") ?? "active";
  const rawOffset = searchParams.get("offset") ?? "0";
  if (!new Set(["active", "archived", "all"]).has(status)
    || !/^\d{1,6}$/.test(rawOffset)
    || Number(rawOffset) > 100000) return null;

  return { status, offset: Number(rawOffset) };
}

async function getAllowedClient(request: Request): Promise<
  { ok: false; response: NextResponse } | { ok: true; supabase: SupabaseClient }
> {
  const { supabase, user } = await getAuthenticatedClient(request);
  if (!supabase || !user) return { ok: false, response: unauthorized() };

  const access = await getPersonalAccess(supabase, user);
  if (access !== "allowed") return { ok: false, response: personalAccessResponse(access) };

  return { ok: true, supabase };
}

export async function GET(request: Request) {
  try {
    const client = await getAllowedClient(request);
    if (!client.ok) return client.response;

    const query = validateListQuery(request);
    if (!query) return badRequest("Sahifa noto‘g‘ri.");

    let categoryQuery = client.supabase
      .from("personal_categories")
      .select("id,name,status,version")
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(query.offset, query.offset + 100);
    if (query.status !== "all") categoryQuery = categoryQuery.eq("status", query.status);

    const { data, error } = await categoryQuery;
    if (error) return error.code === "42501" ? forbidden() : serverError();
    if (!data) return serverError();
    const paginationLimitReached = data.length > 100 && query.offset + 100 > 100000;

    return response({
      categories: data.slice(0, 100),
      nextOffset: data.length > 100 && !paginationLimitReached ? query.offset + 100 : null,
      ...(paginationLimitReached ? { paginationLimitReached: true } : {}),
    }, 200);
  } catch {
    return serverError();
  }
}

export async function POST(request: Request) {
  try {
    const client = await getAllowedClient(request);
    if (!client.ok) return client.response;

    let body: unknown;
    try {
      body = await readJsonBody(request);
    } catch {
      return badRequest("So‘rov noto‘g‘ri yoki juda katta.");
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) return badRequest();
    const input = body as Record<string, unknown>;
    if (Object.keys(input).some(key => key !== "command" && key !== "clientKey")
      || typeof input.clientKey !== "string"
      || !clientKeyPattern.test(input.clientKey)
      || !input.command
      || typeof input.command !== "object"
      || Array.isArray(input.command)) return badRequest();

    const { data, error } = await client.supabase.rpc("manage_personal_category", {
      p_command: input.command,
      p_client_key: input.clientKey,
    });
    if (error) {
      if (error.code === "22023") return badRequest("Kategoriya ma’lumotlarini tekshiring.");
      if (error.code === "42501") return forbidden();
      if (error.code === "23505") return response({ code: "CONFLICT", error: "So‘rov ma’lumoti mos emas." }, 409);
      return serverError();
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) return serverError();

    const result = data as { replayed?: unknown };
    const operation = (input.command as { operation?: unknown }).operation;
    return response({ ...data, clientKey: input.clientKey }, result.replayed === true || operation !== "create" ? 200 : 201);
  } catch {
    return serverError();
  }
}
