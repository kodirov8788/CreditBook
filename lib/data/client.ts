import type { SupabaseClient } from "@supabase/supabase-js";

// Transitional PostgREST contract, not a claim that another provider is enabled.
// Keep auth/admin/storage operations outside ordinary application data access.
export type DataClient = Pick<SupabaseClient, "from" | "rpc">;

// Wrap the request's existing client: cookies, bearer identity and RLS context
// must stay together. Never cache this facade across requests or accounts.
export function createSupabaseDataClient(client: SupabaseClient): DataClient {
  return {
    from: client.from.bind(client),
    rpc: client.rpc.bind(client),
  };
}
