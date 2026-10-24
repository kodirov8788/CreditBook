import { NextResponse } from "next/server";
import { getAuthenticatedClient } from "@/lib/api/auth";
import { unauthorized, serverError } from "@/lib/api/response";
import { createSupabaseShopRepository } from "@/lib/data/shops";

export async function GET(request: Request) {
  const { supabase, user } = await getAuthenticatedClient(request);
  if (!supabase || !user) return unauthorized();

  try {
    return NextResponse.json(await createSupabaseShopRepository(supabase).list(), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch { return serverError(); }
}
