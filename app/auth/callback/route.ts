import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const requestedNext = requestUrl.searchParams.get("next") ?? "/";
  const requestedTarget = new URL(requestedNext, requestUrl.origin);
  const next = requestedTarget.origin === requestUrl.origin ? requestedTarget : new URL("/", requestUrl.origin);
  const supabase = await createClient();

  if (code && supabase) await supabase.auth.exchangeCodeForSession(code);
  return NextResponse.redirect(next);
}
