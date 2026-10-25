import { handleLocalNeonPersonal, usesLocalNeonPersonal } from "@/lib/api/neon-personal";
import { NextResponse } from "next/server";
import { getAuthenticatedClient } from "@/lib/api/auth";
import { getPersonalAccess, personalAccessResponse } from "@/lib/api/personal-access";
import { badRequest, forbidden, serverError, unauthorized } from "@/lib/api/response";
import { readJsonBody } from "@/lib/api/json-body";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  if (usesLocalNeonPersonal()) return handleLocalNeonPersonal(request, "book");
  const { supabase, user } = await getAuthenticatedClient(request);
  if (!supabase || !user) return unauthorized();
  const access = await getPersonalAccess(supabase, user);
  if (access !== "allowed") return personalAccessResponse(access);
  const { data, error } = await supabase.rpc("get_personal_book");
  if (error) return error.code === "42501" ? forbidden() : serverError();
  return data ? NextResponse.json(data, { headers }) : serverError();
}

export async function POST(request: Request) {
  if (usesLocalNeonPersonal()) return handleLocalNeonPersonal(request, "book");
  const { supabase, user } = await getAuthenticatedClient(request);
  if (!supabase || !user) return unauthorized();
  const access = await getPersonalAccess(supabase, user);
  if (access !== "allowed") return personalAccessResponse(access);
  let body;
  try { body = await readJsonBody(request); } catch { return badRequest("So‘rov noto‘g‘ri."); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return badRequest("So‘rov noto‘g‘ri.");
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some(key => !["clientKey", "command"].includes(key))
    || typeof input.clientKey !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.clientKey)
    || !input.command || typeof input.command !== "object" || Array.isArray(input.command)) return badRequest("So‘rov noto‘g‘ri.");
  const { data, error } = await supabase.rpc("initialize_personal_book", { p_command: input.command, p_client_key: input.clientKey });
  if (error) {
    if (error.code === "42501") return forbidden();
    if (error.code === "22023") return badRequest("Qoldiq va sanani tekshiring.");
    if (error.code === "23505") return NextResponse.json({ code: "CONFLICT", error: "So‘rov ma’lumoti mos emas." }, { status: 409, headers });
    if (error.code === "PT409") {
      const legacy = error.message === "LEGACY_SETUP_REQUIRED";
      return NextResponse.json({ code: legacy ? "LEGACY_SETUP_REQUIRED" : "BOOK_EXISTS",
        error: legacy ? "Eski hisoblar bor. Alohida sozlash kerak." : "Shaxsiy hisob allaqachon ochilgan." }, { status: 409, headers });
    }
    return serverError();
  }
  return data ? NextResponse.json(data, { status: data.replayed ? 200 : 201, headers }) : serverError();
}
