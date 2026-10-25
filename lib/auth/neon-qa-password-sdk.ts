import { createAuthServer, resolveNeonAuthLogging } from "@neondatabase/auth/server";
import { createHash } from "node:crypto";
import { APPROVED_QA_AUTH_BASE_URL } from "./neon-qa-sdk.ts";
import type { QaAuthResult } from "./neon-qa.ts";

export type QaPasswordAuth = {
  request(input: { email: string; redirectTo: string }): Promise<QaAuthResult>;
  complete(input: { token: string; newPassword: string }): Promise<QaAuthResult>;
};

// Fingerprint of the two user-approved QA email/UUID pairs, not plaintext PII.
// Changing recipients or their identity binding requires a new exact approval.
const approvedTargets = "e2b83089c25909fadf7499c8b899674c5c2b084ad60ba5da38e0a85b37bcb119";
export function assertApprovedQaPasswordTargets(emails: readonly string[], owners: readonly string[]): void {
  if (emails.length !== 2 || owners.length !== 2) throw new Error("Exactly two approved setup targets are required.");
  const pairs = emails.map((email, index) => [email.trim().toLowerCase(), owners[index].trim().toLowerCase()])
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  if (createHash("sha256").update(JSON.stringify(pairs)).digest("hex") !== approvedTargets) {
    throw new Error("Password setup targets do not match the exact approved QA identities.");
  }
}

/** Unauthenticated reset operations only. Never shares login cookies or sessions. */
export function createNeonQaPasswordAuth(config: {
  baseUrl: string; origin: string; cookieSecret: string; qaEmails: readonly string[];
}): QaPasswordAuth {
  const origin = new URL(config.origin);
  if (config.baseUrl !== APPROVED_QA_AUTH_BASE_URL || origin.protocol !== "http:"
    || origin.hostname !== "localhost" || origin.origin !== config.origin || !origin.port
    || config.cookieSecret.length < 32) throw new Error("Only the approved local QA reset target is permitted.");
  const emails = new Set(config.qaEmails.map(email => email.trim().toLowerCase()));
  if (emails.size !== 2 || [...emails].some(email => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    throw new Error("Exactly two approved QA emails are required.");
  }
  const auth = createAuthServer({
    baseUrl: config.baseUrl, cookieSecret: config.cookieSecret, sessionDataTtl: 300,
    log: resolveNeonAuthLogging({ logLevel: "silent" }),
    context: () => ({
      getCookies: () => "", setCookie: () => {},
      getOrigin: () => origin.origin,
      getHeader: name => name.toLowerCase() === "origin" ? origin.origin : null,
      getFramework: () => "creditbook-local-qa-password",
    }),
  });
  let active = 0;
  async function bounded(work: () => Promise<QaAuthResult>): Promise<QaAuthResult> {
    if (active >= 2) return { data: null, error: { code: "SETUP_BUSY" } };
    active++;
    const pending = Promise.resolve().then(work).catch(() => ({ data: null, error: { code: "SETUP_UNAVAILABLE" } }))
      .finally(() => { active--; });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([pending, new Promise<QaAuthResult>(resolve => {
        timer = setTimeout(() => resolve({ data: null, error: { code: "SETUP_TIMEOUT" } }), 15000);
      })]);
    } finally { clearTimeout(timer); }
  }
  return {
    request(input) {
      const callback = new URL(input.redirectTo);
      if (!emails.has(input.email.toLowerCase()) || callback.origin !== origin.origin
        || callback.pathname !== "/qa/password-setup" || callback.hash || callback.username || callback.password
        || [...callback.searchParams.keys()].join(",") !== "state"
        || !/^[a-f0-9]{64}$/.test(callback.searchParams.get("state") ?? "")) {
        return Promise.resolve({ data: null, error: { code: "SETUP_DENIED" } });
      }
      return bounded(() => auth.requestPasswordReset(input));
    },
    complete: input => bounded(() => auth.resetPassword(input)),
  };
}
