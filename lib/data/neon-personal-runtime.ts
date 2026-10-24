import type { NeonAtomicExecutor } from "./neon-owner";
import { createNeonAtomicExecutor } from "./neon-executor.ts";
import { readNeonConfig } from "../auth/local-config.ts";

export type LocalPersonalRuntime = Readonly<{ issuer: string; execute: NeonAtomicExecutor }>;
const key = Symbol.for("creditbook.personal.owned-local-runtime.v1");
type LocalHost = typeof globalThis & { [key]?: LocalPersonalRuntime };

function requireLocalEnvironment() {
  if (process.env.NODE_ENV !== "development" || process.env.VERCEL
    || process.env.CREDITBOOK_NEON_AUTH_LOCAL !== "1" || process.env.CREDITBOOK_NEON_PERSONAL_LOCAL !== "1") {
    throw new Error("Personal local fixture unavailable.");
  }
}

/** Test-only process injection by the owned Next custom server. No user, token,
 * password or SQL URL is stored globally; only one owned executor and its issuer.
 * It is not an HTTP bridge and is never constructed from request input.
 */
export function installOwnedLocalPersonalRuntime(runtime: LocalPersonalRuntime): () => void {
  requireLocalEnvironment();
  const host = globalThis as LocalHost;
  if (host[key] || typeof runtime.execute !== "function" || runtime.issuer !== process.env.NEON_AUTH_BASE_URL) {
    throw new Error("Owned personal fixture binding rejected.");
  }
  const captured = Object.freeze({ issuer: runtime.issuer, execute: runtime.execute });
  host[key] = captured;
  return () => { if (host[key] === captured) delete host[key]; };
}

export function getOwnedLocalPersonalRuntime(): LocalPersonalRuntime {
  requireLocalEnvironment();
  const runtime = (globalThis as LocalHost)[key];
  if (!runtime || runtime.issuer !== process.env.NEON_AUTH_BASE_URL) throw new Error("Owned personal fixture not installed.");
  return runtime;
}

export function getPersonalRuntime(): LocalPersonalRuntime {
  if (process.env.CREDITBOOK_NEON_ENABLED !== "1") return getOwnedLocalPersonalRuntime();
  const config = readNeonConfig(process.env);
  if (!config) throw new Error("Neon release unavailable.");
  return { issuer: config.baseUrl, execute: createNeonAtomicExecutor(
    process.env.CREDITBOOK_NEON_DATABASE_URL ?? "", "creditbook_personal_gateway") };
}
