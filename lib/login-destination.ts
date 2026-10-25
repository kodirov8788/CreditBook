// Return only a same-origin local path; never send credentials to a return URL.
export function loginDestination(requested: string | null): string {
  if (!requested || !requested.startsWith("/") || requested.startsWith("//") || /[\\\u0000-\u0020\u007f]/.test(requested)) return "/dashboard";
  try {
    const target = new URL(requested, "https://creditbook.invalid");
    const pathname = decodeURIComponent(target.pathname).replace(/\/+$/, "").toLowerCase();
    if (target.origin !== "https://creditbook.invalid" || pathname === "/login" || pathname === "/auth" || pathname.startsWith("/auth/")) return "/dashboard";
    return target.pathname + target.search + target.hash;
  } catch { return "/dashboard"; }
}
