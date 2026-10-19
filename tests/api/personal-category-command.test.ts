import { describe, expect, it } from "vitest";
import { categoryCommandOutcome, categoryCommandPayload, createCategoryIntent, restoreCategoryIntent } from "@/lib/personal-finance/category-command";
const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const key = "33333333-3333-4333-8333-333333333333";
const categoryId = "44444444-4444-4444-8444-444444444444";
const commandId = "55555555-5555-4555-8555-555555555555";
const create = { operation: "create", name: "  Ovqat  " };
const rename = { operation: "rename", categoryId, categoryVersion: 2, name: "Taom" };
const archive = { operation: "archive", categoryId, categoryVersion: 2 };

describe("category command intent (pure contract, no storage or HTTP)", () => {
  it.each([create, rename, archive])("preserves exact payload and key for %j", command => {
    const intent = createCategoryIntent(owner, key, command);
    expect(restoreCategoryIntent(JSON.stringify(intent), owner)).toEqual(intent);
    expect(categoryCommandPayload(intent, owner)).toEqual({ clientKey: key, command });
    expect(categoryCommandPayload(intent, owner)).not.toHaveProperty("ownerId");
    expect(Object.isFrozen(intent)).toBe(true); expect(Object.isFrozen(intent.command)).toBe(true);
  });
  it("does not normalize a restored name into a changed idempotency payload", () => {
    const intent = createCategoryIntent(owner, key, create);
    expect(restoreCategoryIntent(JSON.stringify(intent), owner).command).toEqual(create);
    const mutable = { operation: "create", name: "Original" };
    const saved = createCategoryIntent(owner, key, mutable);
    mutable.name = "Changed";
    expect(saved.command).toEqual({ operation: "create", name: "Original" });
  });
  it("refuses another account's journal or outgoing request", () => {
    const intent = createCategoryIntent(owner, key, create);
    expect(() => restoreCategoryIntent(JSON.stringify(intent), other)).toThrow();
    expect(() => categoryCommandPayload(intent, other)).toThrow();
  });
  it("uses UUID identity rather than letter casing for the same owner", () => {
    const lower = "abcdefab-cdef-4abc-8def-abcdefabcdef", upper = lower.toUpperCase();
    const intent = createCategoryIntent(upper, key, create);
    expect(intent.ownerId).toBe(lower);
    expect(restoreCategoryIntent(JSON.stringify({ ...intent, ownerId: upper }), lower)).toEqual(intent);
    expect(categoryCommandPayload(intent, upper)).toEqual({ clientKey: key, command: create });
  });
  it.each([null, [], {}, { operation: "delete", categoryId }, { ...create, ownerId: other },
    { ...create, name: "" }, { ...create, name: "   " }, { ...create, name: "bad\nname" },
    { ...create, name: "a".repeat(81) }, { ...create, name: 1 }, { ...rename, categoryId: "bad" },
    { ...rename, categoryVersion: "2" }, { ...rename, categoryVersion: 0 }, { ...rename, categoryVersion: 2.5 },
    { ...rename, categoryVersion: 1000000000 }, { ...archive, name: "Unexpected" }])("rejects invalid command %j", command => {
    expect(() => createCategoryIntent(owner, key, command)).toThrow();
  });
  it.each([null, "bad", "00000000-0000-0000-0000-000000000000"])("rejects invalid key %j", invalid => {
    expect(() => createCategoryIntent(owner, invalid, create)).toThrow();
  });
  it("accepts one-character and Unicode labels using code-point length", () => {
    expect(createCategoryIntent(owner, key, { ...create, name: "食" }).command).toEqual({ operation: "create", name: "食" });
    expect(createCategoryIntent(owner, key, { ...create, name: "🍱".repeat(80) })).toBeDefined();
  });
  it.each(["bad\u0000name", "bad\u0085name", "\ud800", "\udfff"])("rejects invalid/control Unicode %j", name => {
    expect(() => createCategoryIntent(owner, key, { ...create, name })).toThrow();
  });
  it.each(["{bad", " ".repeat(8193), JSON.stringify({ ownerId: other, clientKey: key, command: create }),
    JSON.stringify({ ownerId: owner, clientKey: key, command: create, secret: "not accepted" })])("rejects malformed or foreign journal", raw => {
    expect(() => restoreCategoryIntent(raw, owner)).toThrow();
  });
  it("rejects command/journal UTF-8 byte overflow, not only character count", () => {
    expect(() => createCategoryIntent(owner, key, { ...create, name: " ".repeat(4096) + "食" })).toThrow();
    expect(() => restoreCategoryIntent('"' + "🍱".repeat(2100) + '"', owner)).toThrow();
  });
  it("matches the database JSONB separator-space byte limit", () => {
    const overhead = new TextEncoder().encode('{"name": "", "operation": "create"}').byteLength;
    const name = " ".repeat(4096 - overhead - 1) + "X";
    expect(createCategoryIntent(owner, key, { ...create, name })).toBeDefined();
    expect(() => createCategoryIntent(owner, key, { ...create, name: " " + name })).toThrow();
  });
});

describe("category command outcomes cannot discard unknown intent", () => {
  const result = { categoryId, categoryVersion: 1, commandId, replayed: false, clientKey: key };
  it.each([[create, 201, result], [create, 200, { ...result, replayed: true }],
    [rename, 200, { ...result, categoryVersion: 3 }], [archive, 200, { ...result, categoryVersion: 3, replayed: true }]])(
    "accepts only a matching receipt", (command, status, receipt) => {
      const outcome = categoryCommandOutcome(createCategoryIntent(owner, key, command), status as number, receipt);
      expect(outcome.kind).toBe("saved"); expect(outcome.clearIntent).toBe(true);
    },
  );
  it.each([[401, {}, "blocked"], [403, {}, "blocked"], [409, { code: "CONFLICT" }, "conflict"],
    [400, { error: "Invalid" }, "invalid"], [500, {}, "retry"], [503, {}, "retry"], [429, {}, "retry"],
    [204, null, "retry"], [409, {}, "retry"], [200, null, "retry"], [201, {}, "retry"]])(
    "retains the exact pending intent on status %s", (status, body, kind) => {
      const intent = createCategoryIntent(owner, key, create);
      const before = JSON.stringify(intent);
      expect(categoryCommandOutcome(intent, status as number, body)).toEqual({ kind, clearIntent: false });
      expect(JSON.stringify(intent)).toBe(before);
    },
  );
  it.each([{ ...result, categoryId: "bad" }, { ...result, commandId: "bad" }, { ...result, categoryVersion: "1" },
    { ...result, categoryVersion: 2 }, { ...result, replayed: "false" }, { ...result, replayed: true }])(
    "does not acknowledge a malformed/inconsistent create receipt", body => {
      expect(categoryCommandOutcome(createCategoryIntent(owner, key, create), 201, body).clearIntent).toBe(false);
    },
  );
  it.each([[create, 200, result], [rename, 201, { ...result, categoryVersion: 3 }],
    [archive, 201, { ...result, categoryVersion: 3, replayed: true }]])("retains intent for a mismatched success status/replay pairing", (command, status, receipt) => {
    expect(categoryCommandOutcome(createCategoryIntent(owner, key, command), status as number, receipt).clearIntent).toBe(false);
  });
  it("does not accept another category's receipt or an incorrect revision", () => {
    const intent = createCategoryIntent(owner, key, rename);
    expect(categoryCommandOutcome(intent, 200, { ...result, categoryId: other, categoryVersion: 3 }).clearIntent).toBe(false);
    expect(categoryCommandOutcome(intent, 200, { ...result, categoryVersion: 2 }).clearIntent).toBe(false);
  });
  it.each([undefined, other, null, 123])("retains an otherwise valid receipt without matching client key: %j", clientKey => {
    expect(categoryCommandOutcome(createCategoryIntent(owner, key, create), 201, { ...result, clientKey }).clearIntent).toBe(false);
  });
  it("does not retain unrelated response metadata in an accepted receipt", () => {
    const outcome = categoryCommandOutcome(createCategoryIntent(owner, key, create), 201, { ...result, unrelated: "not stored" });
    expect(outcome.kind).toBe("saved");
    expect(JSON.stringify(outcome)).not.toContain("not stored");
  });
});
