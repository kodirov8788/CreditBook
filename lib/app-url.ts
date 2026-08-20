const allowedProtocols = new Set(["http:", "https:"]);

export function getConfiguredAppOrigin() {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!configured) return null;

  try {
    const url = new URL(configured);
    const isLocalHttp = url.protocol === "http:" && process.env.NODE_ENV !== "production";
    return url.protocol === "https:" || (allowedProtocols.has(url.protocol) && isLocalHttp) ? url.origin : null;
  } catch {
    return null;
  }
}

/**
 * Invite links must not derive their destination from an untrusted Host header
 * in production. Local development may safely fall back to the request origin.
 */
export function getTrustedInviteOrigin(request: Request) {
  return getConfiguredAppOrigin() ?? (process.env.NODE_ENV === "production" ? null : new URL(request.url).origin);
}
