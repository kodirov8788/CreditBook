import { NextResponse, type NextRequest } from "next/server";

// Release-scope gate, not authentication: allowed API handlers still verify
// the live Neon session and frozen owner intent on every request.
const minimalRoutes = new Set([
  "/", "/login", "/personal", "/personal/categories",
  "/api/session", "/api/auth/sign-in/email", "/api/auth/sign-out",
  "/api/personal/book", "/api/personal/categories", "/api/personal/entries", "/api/personal/ledger", "/api/personal/snapshot", "/api/personal/voice-draft",
]);
export function proxy(request: NextRequest) {
  if (process.env.CREDITBOOK_NEON_ENABLED !== "1") return NextResponse.next();
  if (minimalRoutes.has(request.nextUrl.pathname)) return NextResponse.next();
  // Legacy shop/admin/QA routes must not reach Supabase in the closed release.
  return NextResponse.json({ ok: false, code: "NOT_IN_PERSONAL_RELEASE" }, {
    status: 404, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}
export const config = {
  matcher: ["/((?!_next/static/|_next/image|favicon.ico|manifest.webmanifest|icons/).*)"],
};
