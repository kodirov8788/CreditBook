import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient(request?: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) return null;

  const cookieStore = await cookies();
  const authorization = request?.headers.get("authorization");
  const bearerToken = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];

  return createServerClient(url, key, {
    global: bearerToken ? { headers: { Authorization: `Bearer ${bearerToken}` } } : undefined,
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Server Components cannot always write cookies. The proxy handles refreshes.
        }
      },
    },
  });
}
