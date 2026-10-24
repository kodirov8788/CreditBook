import { createHash } from "node:crypto";

export type LocalNeonConfig = Readonly<{
  origin: string; baseUrl: string; cookieSecret: string;
  identities: readonly Readonly<{ id: string; email: string }>[];
}>;

const approvedUrl = "https://ep-long-cherry-b4u07ix0.neonauth.c-6.us-east-2.aws.neon.tech/neondb/auth";
// Same reviewed two-account roster as the standalone QA; no credentials stored here.
const approvedRoster = "e2b83089c25909fadf7499c8b899674c5c2b084ad60ba5da38e0a85b37bcb119";

/** Opt-in LOCAL rehearsal only, not a production provider switch. No dotenv/DB reads. */
export function readLocalNeonConfig(env: Readonly<Record<string, string | undefined>>): LocalNeonConfig | null {
  if (env.CREDITBOOK_NEON_AUTH_LOCAL !== "1") return null;
  if (env.NODE_ENV === "production" || env.VERCEL || env.NEXT_PUBLIC_CREDITBOOK_NEON_AUTH_LOCAL !== "1") {
    throw new Error("Neon Auth local mode is unavailable in this environment.");
  }
  const origin = env.CREDITBOOK_NEON_AUTH_ORIGIN ?? "";
  const url = new URL(origin);
  if (url.protocol !== "http:" || url.hostname !== "localhost" || !url.port || url.origin !== origin) {
    throw new Error("An exact localhost QA origin is required.");
  }
  return reviewedIdentityConfig(env, origin);
}

function reviewedIdentityConfig(env: Readonly<Record<string, string | undefined>>, origin: string): LocalNeonConfig {
  const baseUrl = env.NEON_AUTH_BASE_URL ?? "";
  const cookieSecret = env.NEON_AUTH_COOKIE_SECRET ?? "";
  if (baseUrl !== approvedUrl || cookieSecret.length < 32) throw new Error("Explicit QA Auth configuration required.");
  const ids = (env.CREDITBOOK_QA_USER_IDS ?? "").split(",").map(value => value.trim().toLowerCase());
  const emails = (env.CREDITBOOK_QA_EMAILS ?? "").split(",").map(value => value.trim().toLowerCase());
  // Bind each email to its reviewed UUID; neither an arbitrary email nor the
  // first signed-in user can enroll itself or acquire business/admin access.
  const pairs = emails.map((email, index) => [email, ids[index]])
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  const fingerprint = createHash("sha256").update(JSON.stringify(pairs)).digest("hex");
  if (ids.length !== 2 || emails.length !== 2 || fingerprint !== approvedRoster) {
    throw new Error("Only the two reviewed QA identities are permitted.");
  }
  return { origin, baseUrl, cookieSecret, identities: ids.map((id, index) => ({ id, email: emails[index] })) };
}

/** Explicit closed two-user release. Legacy/local mode is unchanged and a
 * broken hosted configuration must never fall back to another auth provider. */
export function readNeonConfig(env: Readonly<Record<string, string | undefined>>): LocalNeonConfig | null {
  if (env.CREDITBOOK_NEON_ENABLED !== "1") return readLocalNeonConfig(env);
  if (env.NEXT_PUBLIC_CREDITBOOK_NEON_ENABLED !== "1" || env.CREDITBOOK_NEON_AUTH_LOCAL === "1") {
    throw new Error("Conflicting Neon release configuration.");
  }
  const origin = env.CREDITBOOK_NEON_AUTH_ORIGIN ?? "";
  const parsed = new URL(origin);
  if (parsed.protocol !== "https:" || parsed.origin !== origin || parsed.username || parsed.password || parsed.port) {
    throw new Error("Exact HTTPS release origin required.");
  }
  return reviewedIdentityConfig(env, origin);
}
