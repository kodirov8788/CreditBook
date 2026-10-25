import { describe, expect, it } from "vitest";
import { categoryNameProblem, parseInputPreferences } from "@/lib/personal-finance/input-preferences";

describe("voice-first input preferences", () => {
  it.each([null, "bad JSON", "null", "42", '{"entry":"unknown","category":"unknown"}'])("falls back safely for %s", raw => {
    expect(parseInputPreferences(raw)).toEqual({ entry: "voice", category: "voice" });
  });
  it("retains independently selected defaults and ignores unrelated fields", () => {
    expect(parseInputPreferences('{"entry":"receipt","category":"text","owner":"forged"}')).toEqual({ entry: "receipt", category: "text" });
    expect(parseInputPreferences('{"entry":"manual"}')).toEqual({ entry: "manual", category: "voice" });
  });
  it("rejects normalized duplicates including archived names supplied by the caller", () => {
    expect(categoryNameProblem("  OVQAT  ", ["Ovqat"])).toBeTruthy();
    expect(categoryNameProblem("Ｓｐｏｒｔ", ["sport"])).toBeTruthy();
    expect(categoryNameProblem("Yangi    nom", ["Yangi nom"])).toBeTruthy();
    expect(categoryNameProblem("Sport", ["Ovqat"])).toBeNull();
    expect(categoryNameProblem("", [])).toBeTruthy();
    expect(categoryNameProblem("x".repeat(81), [])).toBeTruthy();
    expect(categoryNameProblem("nom\u0000", [])).toBeTruthy();
  });
});
