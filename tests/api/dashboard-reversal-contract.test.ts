import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// Static wiring regression, NOT a mounted browser interaction test. History
// lacks linked debt status, so its amount must never drive financial setters.
const source = ts.createSourceFile("dashboard.tsx", readFileSync(new URL("../../components/dashboard.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function callsIn(name: string) {
  const calls: string[] = [];
  let found = false;
  function find(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
      found = true;
      function collect(child: ts.Node) {
        if (ts.isCallExpression(child) && ts.isIdentifier(child.expression)) calls.push(child.expression.text);
        ts.forEachChild(child, collect);
      }
      collect(node);
    } else ts.forEachChild(node, find);
  }
  find(source);
  if (!found) throw new Error(`Missing ${name}`);
  return calls;
}
describe("dashboard correction aggregate ownership (static wiring)", () => {
  it("cannot optimistically change aggregates using a cancelled-debt history payment amount", () => {
    const calls = callsIn("reverseTransaction");
    expect(calls).not.toContain("setStats");
    expect(calls).not.toContain("setCustomers");
    expect(calls).toContain("refreshDebtDates");
  });
  it("applies financial setters only through validated authoritative read after correction", () => {
    const calls = callsIn("refreshDebtDates");
    expect(calls.indexOf("refreshDashboardDebts")).toBeLessThan(calls.indexOf("setCustomers"));
    expect(calls).toContain("setStats");
  });
});
