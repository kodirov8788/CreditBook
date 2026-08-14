import { createClient } from "@/lib/supabase/server";

export async function getAuthenticatedClient() {
  const supabase = await createClient();
  if (!supabase) return { supabase: null, user: null };

  const { data: { user } } = await supabase.auth.getUser();
  return { supabase, user };
}
