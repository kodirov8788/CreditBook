import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  if (!supabase) {
    return NextResponse.json({ ok: false, service: "creditbook", checks: { supabase: "not_configured" } }, { status: 503 });
  }

  const { error } = await supabase.from("customers").select("id", { count: "exact", head: true });
  return NextResponse.json({
    ok: !error,
    service: "creditbook",
    checks: { supabase: error ? "error" : "ok", customers_table: error ? "error" : "ok" },
  }, { status: error ? 503 : 200 });
}
