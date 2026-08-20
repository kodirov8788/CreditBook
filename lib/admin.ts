import "server-only";
import { createClient as createSupabaseClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

type AdminContext = { user: User; client: SupabaseClient; authClient: SupabaseClient };

export function createServiceClient() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret) return null;
  return createSupabaseClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false } });
}

export async function getPlatformAdmin(): Promise<AdminContext | null> {
  const authClient = await createClient();
  if (!authClient) return null;

  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return null;

  const { data: isAdmin, error: roleError } = await authClient.rpc("is_platform_admin");
  if (roleError || !isAdmin) return null;

  const client = createServiceClient();
  if (!client) return null;

  return {
    user,
    client,
    authClient,
  };
}

export async function requirePlatformAdmin() {
  const admin = await getPlatformAdmin();
  if (!admin) redirect("/dashboard");
  return admin;
}
