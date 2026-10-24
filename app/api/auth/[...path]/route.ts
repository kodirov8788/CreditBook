import { handleMainAuth } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const path = (await context.params).path.join("/");
  if (path === "sign-in/email") return handleMainAuth(request, "login");
  if (path === "sign-out") return handleMainAuth(request, "logout");
  // Never expose the SDK's full proxy (signup/admin/reset or token endpoints).
  return Response.json({ ok: false, code: "NOT_FOUND" }, { status: 404, headers: { "Cache-Control": "private, no-store" } });
}
