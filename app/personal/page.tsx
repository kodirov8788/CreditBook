import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import PersonalAccounts from "@/components/personal/accounts";

export const dynamic = "force-dynamic";

export default async function PersonalPage() {
  const supabase = await createClient();
  if (!supabase) return <main className="login-shell"><p>Kirish sozlamasi topilmadi.</p></main>;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: shops, error } = await supabase.rpc("list_user_shops");
  return <PersonalAccounts userId={user.id} hasShop={!error && Boolean(shops?.length)} />;
}
