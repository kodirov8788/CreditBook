import { NextResponse } from "next/server";
import { getAuthenticatedClient } from "@/lib/api/auth";
import { getPersonalAccess, personalAccessResponse } from "@/lib/api/personal-access";
import { badRequest, forbidden, serverError, unauthorized } from "@/lib/api/response";
import { readJsonBody } from "@/lib/api/json-body";

export const dynamic = "force-dynamic";
const keyPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const { supabase, user } = await getAuthenticatedClient(request);
  if (!supabase || !user) return unauthorized();
  const access = await getPersonalAccess(supabase, user);
  if (access !== "allowed") return personalAccessResponse(access);
  const raw = new URL(request.url).searchParams.get("offset") ?? "0";
  if (!/^\d{1,6}$/.test(raw) || Number(raw) > 100000) return badRequest("Sahifa noto‘g‘ri.");
  const { data, error } = await supabase.rpc("get_personal_accounts", { p_offset: Number(raw) });
  if (error) return error.code === "42501" ? forbidden() : serverError();
  if (!data) return serverError();
  return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  const { supabase, user } = await getAuthenticatedClient(request);
  if (!supabase || !user) return unauthorized();
  const access = await getPersonalAccess(supabase, user);
  if (access !== "allowed") return personalAccessResponse(access);
  let body;
  try { body = await readJsonBody(request); } catch { return badRequest("So‘rov noto‘g‘ri yoki juda katta."); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return badRequest("So‘rov noto‘g‘ri.");
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some(k => !["command", "clientKey"].includes(k))
    || typeof input.clientKey !== "string" || !keyPattern.test(input.clientKey)
    || !input.command || typeof input.command !== "object" || Array.isArray(input.command)) return badRequest("So‘rov noto‘g‘ri.");
  const { data, error } = await supabase.rpc("create_personal_account", { p_command: input.command, p_client_key: input.clientKey });
  if (error) {
    if (error.code === "42501") return forbidden();
    if (error.code === "PT409") {
      const legacy = error.message === "LEGACY_SETUP_REQUIRED";
      return NextResponse.json({ code: legacy ? "LEGACY_SETUP_REQUIRED" : "BOOK_EXISTS",
        error: legacy ? "Eski hisoblar bor. Alohida sozlash kerak." : "Shaxsiy hisob allaqachon ochilgan." },
      { status: 409, headers: { "Cache-Control": "private, no-store" } });
    }
    if (error.code === "22023") return NextResponse.json({ code: "22023", error: "Nom, summa, valyuta va sanani tekshiring." }, { status: 400 });
    if (error.code === "23505") return NextResponse.json({ error: "Bu so‘rov avval boshqa ma’lumot bilan yuborilgan." }, { status: 409 });
    return serverError();
  }
  if (!data) return serverError();
  return NextResponse.json(data, { status: data.replayed ? 200 : 201, headers: { "Cache-Control": "private, no-store" } });
}
