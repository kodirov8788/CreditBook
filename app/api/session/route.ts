import { handleMainAuth } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) { return handleMainAuth(request, "session"); }
