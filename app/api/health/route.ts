import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const headers = { "Cache-Control": "public, max-age=0, s-maxage=30, stale-while-revalidate=30" };
  const supabase = await createClient();
  if (!supabase) {
    return NextResponse.json({ ok: false, service: "creditbook", checks: { supabase: "not_configured" } }, { status: 503, headers });
  }

  const { error } = await supabase.from("customers").select("id", { count: "exact", head: true });
  return NextResponse.json({
    ok: !error,
    service: "creditbook",
    checks: { supabase: error ? "error" : "ok", customers_table: error ? "error" : "ok" },
  }, { status: error ? 503 : 200, headers });
}
