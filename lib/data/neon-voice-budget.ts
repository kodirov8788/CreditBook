import type { NeonAtomicExecutor, NeonStatement } from "./neon-owner";

export type VoiceReservation = Readonly<{ granted: boolean; reason: "ready" | "budget" | "rate" | "replay" | "conflict"; remainingMicros: string }>;
export type VoiceBudget = Readonly<{
  reserve(requestId: string, fingerprint: string): Promise<VoiceReservation>;
  finish(requestId: string, costMicros: string | null): Promise<void>;
}>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function createVoiceBudget({ ownerId, issuer, execute, signal }: { ownerId: string; issuer: string; execute: NeonAtomicExecutor; signal?: AbortSignal }): VoiceBudget {
  if (!uuid.test(ownerId) || !issuer.startsWith("https://")) throw new Error("Verified voice owner required.");
  async function run(statement: NeonStatement) {
    const results = await execute([
      { text: "set local role creditbook_personal_app", values: [] },
      { text: "select set_config('creditbook.personal_owner',$1,true)", values: [ownerId.toLowerCase()] },
      { text: "select set_config('creditbook.personal_issuer',$1,true)", values: [issuer] },
      { text: "select creditbook_personal_private.require_personal_access($1::uuid)", values: [ownerId.toLowerCase()] }, statement,
    ], signal);
    if (results.length !== 5 || results[4].length !== 1) throw new Error("Invalid AI budget result.");
    return results[4][0].result;
  }
  return {
    async reserve(id, fingerprint) {
      if (!uuid.test(id) || !/^[0-9a-f]{64}$/.test(fingerprint)) throw new Error("Invalid AI reservation.");
      const value = await run({ text: "select creditbook_personal_private.reserve_ai_request($1::uuid,$2::text) as result", values: [id.toLowerCase(), fingerprint] });
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid AI reservation result.");
      const row = value as Record<string, unknown>;
      if (typeof row.granted !== "boolean" || !["ready", "budget", "rate", "replay", "conflict"].includes(String(row.reason))
        || row.granted !== (row.reason === "ready") || typeof row.remainingMicros !== "string" || !/^\d{1,7}$/.test(row.remainingMicros)
        || BigInt(row.remainingMicros) > BigInt(5000000)) throw new Error("Invalid AI reservation result.");
      return row as VoiceReservation;
    },
    async finish(id, cost) {
      if (!uuid.test(id) || (cost !== null && (!/^(0|[1-9]\d{0,5})$/.test(cost) || BigInt(cost) > BigInt(50000)))) throw new Error("Invalid AI settlement.");
      await run({ text: "select creditbook_personal_private.finish_ai_request($1::uuid,$2::bigint) as result", values: [id.toLowerCase(), cost] });
    },
  };
}
