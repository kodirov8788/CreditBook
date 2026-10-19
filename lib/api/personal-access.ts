import type { SupabaseClient, User } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export type PersonalAccess = "allowed" | "denied" | "unavailable";

// The database resolves the verified session UUID and current account status.
// Never infer pilot membership from email, user_metadata or a client argument.
export async function getPersonalAccess(
  supabase: SupabaseClient,
  user: Pick<User, "id" | "is_anonymous">,
): Promise<PersonalAccess> {
  if (!user.id || user.is_anonymous) return "denied";
  try {
    const { data, error } = await supabase.rpc("has_personal_pilot_access");
    if (error) return "unavailable";
    if (data === true) return "allowed";
    return data === false ? "denied" : "unavailable";
  } catch {
    return "unavailable";
  }
}

export function personalAccessResponse(access: Exclude<PersonalAccess, "allowed">) {
  return NextResponse.json(
    access === "denied"
      ? { code: "PERSONAL_ACCESS_DENIED", error: "Shaxsiy bo‘limga ruxsat yo‘q." }
      : { code: "PERSONAL_ACCESS_UNAVAILABLE", error: "Ruxsatni tekshirib bo‘lmadi. Qayta urining." },
    { status: access === "denied" ? 403 : 503, headers: { "Cache-Control": "private, no-store" } },
  );
}
