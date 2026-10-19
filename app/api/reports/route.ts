import { NextResponse } from "next/server";
import { badRequest, serverError, unauthorized } from "@/lib/api/response";
import { getAuthenticatedClient, requireShopPermission } from "@/lib/api/auth";
import { readShopReport, validReportDate } from "@/lib/shop-read-model";

export async function GET(request: Request) {
  const { supabase, user } = await getAuthenticatedClient(request);
  if (!supabase || !user) return unauthorized();
  const access = await requireShopPermission(supabase, user, "report.read");
  if (!access.ok) return access.response;
  const params = new URL(request.url).searchParams;
  const from = params.get("from") || null;
  const to = params.get("to") || null;
  if (!validReportDate(from) || !validReportDate(to) || (from && to && from > to)) return badRequest("Hisobot sanalarini tekshiring.");
  try {
    const report = await readShopReport(supabase, access.shopId, from, to);
    return NextResponse.json({report}, {headers: {"Cache-Control": "private, no-store"}});
  } catch {
    return serverError();
  }
}
