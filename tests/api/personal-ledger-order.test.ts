import { describe, expect, it } from "vitest";
import { createNeonPersonalLedger } from "@/lib/data/neon-personal-ledger";
import type { NeonStatement } from "@/lib/data/neon-owner";

const owner = "11111111-1111-4111-8111-111111111111";
describe("ledger cursor ordering", () => {
  it("orders inside the JSON aggregate so the page boundary is deterministic", async () => {
    let statements: readonly NeonStatement[] = [];
    const ledger = createNeonPersonalLedger({ ownerId: owner, issuer: "https://fixture.invalid", execute: async batch => {
      statements = batch;
      return [...batch.slice(0, -1).map(() => []), [{result:{summary:{balance_minor:"0",income_minor:"0",expense_minor:"0"},entries:[]}}]];
    }});
    await ledger.ledger("2026-10");
    expect(statements.at(-1)?.text).toContain("jsonb_agg(h order by h.effective_date desc,h.recorded_at desc,h.id desc)");
    expect(statements.at(-1)?.values).toEqual(["2026-10-01",null,null,null]);
  });
});
