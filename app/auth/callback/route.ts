import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getConfiguredAppOrigin } from "@/lib/app-url";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const tokenHash = requestUrl.searchParams.get("token_hash");
  const type = requestUrl.searchParams.get("type");
  const requestedNext = requestUrl.searchParams.get("next") ?? "/";
  const invitedShopId = requestUrl.searchParams.get("shop_id");
  const appOrigin = getConfiguredAppOrigin() ?? requestUrl.origin;
  const requestedTarget = new URL(requestedNext, appOrigin);
  const next = requestedTarget.origin === appOrigin ? requestedTarget : new URL("/", appOrigin);
  const supabase = await createClient();

  if (supabase && (code || tokenHash)) {
    let authError: Error | null = null;
    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      authError = error;
    } else if (tokenHash && type) {
      const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: type as never });
      authError = error;
    }

    if (!authError && invitedShopId && /^[0-9a-f-]{36}$/i.test(invitedShopId)) {
      const { error: activationError } = await supabase.rpc("activate_invited_memberships", { p_shop_id: invitedShopId });
      if (activationError) {
        const activationFailure = new URL("/login", appOrigin);
        activationFailure.searchParams.set("error_code", "invite_activation_failed");
        return NextResponse.redirect(activationFailure);
      }
    }
  }
  return NextResponse.redirect(next);
}
