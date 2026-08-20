import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getConfiguredAppOrigin } from "@/lib/app-url";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const requestedNext = requestUrl.searchParams.get("next") ?? "/";
  const invitedShopId = requestUrl.searchParams.get("shop_id");
  const appOrigin = getConfiguredAppOrigin() ?? requestUrl.origin;
  const requestedTarget = new URL(requestedNext, appOrigin);
  const next = requestedTarget.origin === appOrigin ? requestedTarget : new URL("/", appOrigin);
  const supabase = await createClient();

  if (code && supabase) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && invitedShopId && /^[0-9a-f-]{36}$/i.test(invitedShopId)) {
      await supabase.rpc("activate_invited_memberships", { p_shop_id: invitedShopId });
    }
  }
  return NextResponse.redirect(next);
}
