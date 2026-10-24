import { notFound } from "next/navigation";
import NeonPersonalQa from "@/components/auth/neon-personal-qa";

export const dynamic = "force-dynamic";

export default function PersonalApiQaPage() {
  if (process.env.NODE_ENV !== "development" || process.env.VERCEL
    || process.env.CREDITBOOK_NEON_AUTH_LOCAL !== "1" || process.env.CREDITBOOK_NEON_PERSONAL_LOCAL !== "1") notFound();
  return <NeonPersonalQa />;
}
