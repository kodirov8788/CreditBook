import { createClient } from "@/lib/supabase/server";

export async function getAuthenticatedClient(request?: Request) {
  const supabase = await createClient();
  if (!supabase) return { supabase: null, user: null };

  const authorization = request?.headers.get("authorization");
  const bearerToken = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  const { data: { user } } = bearerToken
    ? await supabase.auth.getUser(bearerToken)
    : await supabase.auth.getUser();
  return { supabase, user };
}
