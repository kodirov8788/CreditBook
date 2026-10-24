import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getPersonalAccess } from "@/lib/api/personal-access";
import PersonalBook from "@/components/personal/book";
import NeonWallet from "@/components/personal/neon-wallet";

export const dynamic = "force-dynamic";

export default async function PersonalPage({ searchParams }: { searchParams: Promise<{view?: string}> }) {
  if (process.env.CREDITBOOK_NEON_ENABLED === "1" || process.env.CREDITBOOK_NEON_PERSONAL_LOCAL === "1") return <NeonWallet initialView={(await searchParams).view === "categories" ? "categories" : "home"} />;
  const supabase = await createClient();
  if (!supabase) return <main className="login-shell"><p>Kirish sozlamasi topilmadi.</p></main>;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const access = await getPersonalAccess(supabase, user);
  if (access !== "allowed") {
    return <main className="login-shell"><section role="status">
      <h1>Shaxsiy hisob</h1>
      <p>{access === "denied" ? "Shaxsiy bo‘limga ruxsat yo‘q." : "Ruxsatni tekshirib bo‘lmadi. Qayta urining."}</p>
      {access === "unavailable" && <p><a href="/personal">Qayta urinish</a></p>}
      <Link href="/" prefetch={false}>Bosh sahifa</Link>
    </section></main>;
  }
  const { data: shops, error } = await supabase.rpc("list_user_shops");
  return <PersonalBook userId={user.id} hasShop={!error && Boolean(shops?.length)} />;
}
