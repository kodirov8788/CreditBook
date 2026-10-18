import { NextResponse } from "next/server";
import { getAuthenticatedClient } from "@/lib/api/auth";
import { badRequest, serverError, unauthorized } from "@/lib/api/response";

export async function GET(request: Request, context: {params:Promise<{id:string}>}) {
  const {supabase,user}=await getAuthenticatedClient(request);
  if(!supabase||!user)return unauthorized();
  const {id}=await context.params;
  const offset=new URL(request.url).searchParams.get("offset")??"0";
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)||!/^\d{1,6}$/.test(offset)||Number(offset)>100000)return badRequest("Hisob yoki sahifa noto‘g‘ri.");
  const {data:account,error:accountError}=await supabase.from("personal_accounts").select("id,currency_code,scale").eq("id",id).maybeSingle();
  if(accountError)return serverError();
  if(!account)return NextResponse.json({error:"Hisob topilmadi."},{status:404});
  const {data,error}=await supabase.from("personal_postings").select("id,kind,amount_minor,effective_date,recorded_at")
    .eq("account_id",id).order("recorded_at",{ascending:false}).order("id",{ascending:false}).range(Number(offset),Number(offset)+50);
  if(error)return serverError();
  // Current persisted per-posting cap is 1e14, within safe integer range. Fail
  // closed if a future ledger migration exceeds it instead of rounding money.
  if(data?.some(row=>typeof row.amount_minor!=="number"||!Number.isSafeInteger(row.amount_minor)))return serverError();
  return NextResponse.json({currencyCode:account.currency_code,scale:account.scale,
    postings:(data??[]).slice(0,50).map(row=>({...row,amount_minor:String(row.amount_minor)})),
    nextOffset:(data?.length??0)>50&&Number(offset)<100000?Number(offset)+50:null}, {headers:{"Cache-Control":"private, no-store"}});
}
