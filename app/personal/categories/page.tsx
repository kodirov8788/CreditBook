import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getPersonalAccess } from "@/lib/api/personal-access";
import PersonalCategories from "@/components/personal/categories";

export const dynamic = "force-dynamic";

export default async function CategoryPage() {
  if (process.env.CREDITBOOK_NEON_ENABLED === "1" || process.env.CREDITBOOK_NEON_PERSONAL_LOCAL === "1") redirect("/personal?view=categories");
  const supabase = await createClient();
  if (!supabase) return <main className="login-shell"><p>Kirish sozlamasi topilmadi.</p></main>;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const access = await getPersonalAccess(supabase, user);
  if (access !== "allowed") return <main className="personal-shell"><h1>Toifalar</h1>
    <p role="status">{access === "denied" ? "Shaxsiy bo‘limga ruxsat yo‘q." : "Ruxsatni tekshirib bo‘lmadi. Qayta urining."}</p>
    {access === "unavailable" && <p><a href="/personal/categories">Qayta urinish</a></p>}
    <Link href="/personal" prefetch={false}>Hisobga qaytish</Link></main>;
  return <PersonalCategories key={user.id} userId={user.id} />;
}
