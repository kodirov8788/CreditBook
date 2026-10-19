import { NextResponse } from "next/server";
import { getAuthenticatedClient } from "@/lib/api/auth";
import { getPersonalAccess, personalAccessResponse } from "@/lib/api/personal-access";
import { badRequest, forbidden, serverError, unauthorized } from "@/lib/api/response";

const MAX_BODY_BYTES = 1024;
const workspaceSelect = "id, name, status, created_at, updated_at";

type WorkspaceRow = {
  id: string;
  name: string;
  status: string;
  created_at: string;
  updated_at: string;
};

function publicWorkspace(workspace: WorkspaceRow) {
  return {
    id: workspace.id,
    name: workspace.name,
    status: workspace.status,
    created_at: workspace.created_at,
    updated_at: workspace.updated_at,
  };
}

function notFound() {
  return NextResponse.json({ error: "Shaxsiy ish maydoni topilmadi." }, { status: 404 });
}

async function hasEmptyObjectBody(request: Request) {
  const contentLength = request.headers.get("content-length");
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_BODY_BYTES)) {
    return false;
  }

  if (!request.body) return true;

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bodySize = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      bodySize += value.byteLength;
      if (bodySize > MAX_BODY_BYTES) {
        await reader.cancel();
        return false;
      }
      chunks.push(value);
    }
  } catch {
    return false;
  }

  if (bodySize === 0) return true;

  const bytes = new Uint8Array(bodySize);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const body = new TextDecoder().decode(bytes);

  try {
    const parsed: unknown = JSON.parse(body);
    return typeof parsed === "object"
      && parsed !== null
      && !Array.isArray(parsed)
      && Object.keys(parsed).length === 0;
  } catch {
    return false;
  }
}

export async function GET(request: Request) {
  const { supabase, user } = await getAuthenticatedClient(request);
  if (!supabase || !user) return unauthorized();
  const access = await getPersonalAccess(supabase, user);
  if (access !== "allowed") return personalAccessResponse(access);

  const { data, error } = await supabase
    .from("personal_workspaces")
    .select(workspaceSelect)
    .eq("owner_user_id", user.id)
    .eq("status", "active")
    .maybeSingle();

  if (error) return serverError();
  if (!data) return notFound();

  return NextResponse.json({ workspace: publicWorkspace(data as WorkspaceRow) });
}

export async function POST(request: Request) {
  const { supabase, user } = await getAuthenticatedClient(request);
  if (!supabase || !user) return unauthorized();
  const access = await getPersonalAccess(supabase, user);
  if (access !== "allowed") return personalAccessResponse(access);

  if (!await hasEmptyObjectBody(request)) {
    return badRequest("Bu endpoint ma’lumot qabul qilmaydi.");
  }

  const { data, error } = await supabase.rpc("ensure_my_personal_workspace");
  if (error) return error.code === "42501" ? forbidden() : serverError();

  const workspace = Array.isArray(data) ? data[0] : data;
  if (!workspace) return serverError();

  return NextResponse.json({ workspace: publicWorkspace(workspace as WorkspaceRow) });
}
