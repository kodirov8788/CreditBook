import { NextResponse } from "next/server";
import { getAuthenticatedClient } from "@/lib/api/auth";
import { badRequest, forbidden, serverError, unauthorized } from "@/lib/api/response";
import { readJsonBody } from "@/lib/api/json-body";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuthenticatedClient(request);
  if (!supabase || !user) return unauthorized();
  const { id } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) return badRequest("Hisob noto‘g‘ri.");
  let body;
  try { body = await readJsonBody(request); } catch { return badRequest("So‘rov noto‘g‘ri."); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return badRequest("So‘rov noto‘g‘ri.");
  const input=body as Record<string,unknown>;
  if (Object.keys(input).some(k=>!["clientKey","command"].includes(k)) || typeof input.clientKey!=="string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.clientKey)
    || !input.command || typeof input.command!=="object" || Array.isArray(input.command) || "accountId" in input.command) return badRequest("So‘rov noto‘g‘ri.");
  const {data,error}=await supabase.rpc("manage_personal_account",{p_command:{...input.command,accountId:id},p_client_key:input.clientKey});
  if(error){
    if(error.code==="42501")return forbidden();
    if(error.code==="22023")return NextResponse.json({code:"22023",error:"Ma’lumot yoki hisob holatini tekshiring."},{status:400});
    if(error.code==="23505")return NextResponse.json({error:"Hisob yangilangan yoki so‘rov kaliti band. Ro‘yxatni yangilang."},{status:409});
    return serverError();
  }
  if(!data)return serverError();
  return NextResponse.json(data,{headers:{"Cache-Control":"private, no-store"}});
}
