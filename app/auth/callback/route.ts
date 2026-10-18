import { NextResponse } from "next/server";
import type { AuthError } from "@supabase/supabase-js";
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
  let next = new URL("/", appOrigin);
  try {
    const target = new URL(requestedNext, appOrigin);
    if (target.origin === appOrigin && !target.username && !target.password) next = target;
  } catch { /* Malformed return URLs safely fall back to the app root. */ }
  const loginFailure = (errorCode: string) => {
    const target = new URL("/login", appOrigin);
    target.searchParams.set("error_code", errorCode);
    return NextResponse.redirect(target);
  };
  if (requestUrl.searchParams.has("error") || requestUrl.searchParams.has("error_code")) {
    return loginFailure(requestUrl.searchParams.get("error_code") === "otp_expired" ? "otp_expired" : "auth_failed");
  }
  const supabase = await createClient();

  if (supabase && (code || tokenHash)) {
    let authError: AuthError | null = null;
    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      authError = error;
    } else if (tokenHash && type) {
      const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: type as never });
      authError = error;
    } else {
      return loginFailure("auth_failed");
    }
    if (authError) return loginFailure(authError.code === "otp_expired" ? "otp_expired" : "auth_failed");

    if (invitedShopId) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(invitedShopId)) return loginFailure("invite_activation_failed");
      const { error: activationError } = await supabase.rpc("activate_invited_memberships", { p_shop_id: invitedShopId });
      if (activationError) {
        return loginFailure("invite_activation_failed");
      }
    }
  }
  return NextResponse.redirect(next);
}
