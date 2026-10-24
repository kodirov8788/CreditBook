import { handleLocalNeonPersonal, usesLocalNeonPersonal } from "@/lib/api/neon-personal";
import { NextResponse } from "next/server";
import { getAuthenticatedClient } from "@/lib/api/auth";
import { getPersonalAccess, personalAccessResponse } from "@/lib/api/personal-access";
import { badRequest, serverError, unauthorized } from "@/lib/api/response";
import { decodeHistoryCursor, encodeHistoryCursor, type HistoryCursor } from "@/lib/personal-finance/history-cursor";

export async function GET(request: Request, context: {params:Promise<{id:string}>}) {
  if (usesLocalNeonPersonal()) return handleLocalNeonPersonal(request, "history", (await context.params).id);
  const {supabase,user}=await getAuthenticatedClient(request);
  if(!supabase||!user)return unauthorized();
  const access = await getPersonalAccess(supabase, user);
  if (access !== "allowed") return personalAccessResponse(access);
  const {id}=await context.params;
  const params=new URL(request.url).searchParams;
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)||params.has("offset"))return badRequest("Hisob yoki tarix belgisi noto‘g‘ri.");
  let cursor:HistoryCursor|undefined;
  try { if(params.has("cursor"))cursor=decodeHistoryCursor(params.get("cursor")!,id); }
  catch { return badRequest("Tarix belgisi noto‘g‘ri."); }
  const {data:account,error:accountError}=await supabase.from("personal_accounts").select("id,currency_code,scale").eq("id",id).maybeSingle();
  if(accountError)return serverError();
  if(!account)return NextResponse.json({error:"Hisob topilmadi."},{status:404});
  let query=supabase.from("personal_postings").select("id,kind,amount_minor,effective_date,recorded_at")
    .eq("account_id",id).order("recorded_at",{ascending:false}).order("id",{ascending:false});
  if(cursor)query=query.or(`recorded_at.lt.${cursor.recordedAt},and(recorded_at.eq.${cursor.recordedAt},id.lt.${cursor.id})`);
  const {data,error}=await query.range(0,50);
  if(error)return serverError();
  // Current persisted per-posting cap is 1e14, within safe integer range. Fail
  // closed if a future ledger migration exceeds it instead of rounding money.
  if(data?.some(row=>typeof row.amount_minor!=="number"||!Number.isSafeInteger(row.amount_minor)))return serverError();
  const page=(data??[]).slice(0,50);
  let nextCursor:string|null=null;
  try { if((data?.length??0)>50){const last=page[49];nextCursor=encodeHistoryCursor({accountId:id,id:last.id,recordedAt:last.recorded_at});} }
  catch { return serverError(); }
  return NextResponse.json({currencyCode:account.currency_code,scale:account.scale,
    postings:page.map(row=>({...row,amount_minor:String(row.amount_minor)})),nextCursor}, {headers:{"Cache-Control":"private, no-store"}});
}
