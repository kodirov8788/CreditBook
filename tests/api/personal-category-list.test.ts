import { describe, expect, it } from "vitest";
import { mergeCategoryList, parseCategoryList } from "@/lib/personal-finance/category-list";
const row = { id: "11111111-1111-4111-8111-111111111111", name: "Ovqat", status: "active" as const, version: 1 };

describe("category list transport (not browser behavior)", () => {
  it("accepts empty and archived lists without changing the source", () => {
    expect(parseCategoryList({ categories: [], nextOffset: null }, 0)).toEqual({ categories: [], nextOffset: null });
    const source = { categories: [Object.freeze({ ...row, status: "archived" })], nextOffset: null };
    expect(parseCategoryList(source, 0)).toEqual(source);
  });
  it("copies only known display fields", () => {
    expect(parseCategoryList({ categories: [{ ...row, secret: "not a display field" }], nextOffset: null }, 0).categories).toEqual([row]);
  });
  it.each([null, [], {}, { categories: null, nextOffset: null }, { categories: [null], nextOffset: null },
    { categories: [row, row], nextOffset: null }, { categories: [{ ...row, id: "bad" }], nextOffset: null },
    { categories: [{ ...row, name: 1 }], nextOffset: null }, { categories: [{ ...row, name: "" }], nextOffset: null },
    { categories: [{ ...row, name: "bad\nname" }], nextOffset: null }, { categories: [{ ...row, status: "deleted" }], nextOffset: null },
    { categories: [{ ...row, version: "1" }], nextOffset: null }, { categories: [{ ...row, version: 0 }], nextOffset: null },
    { categories: [row], nextOffset: 100 }, { categories: [], nextOffset: 0 }, { categories: [], nextOffset: -1 },
    { categories: [], nextOffset: "100" }])("rejects malformed response %j", value => {
    expect(() => parseCategoryList(value, 0)).toThrow("INVALID_CATEGORY_LIST");
  });
  it("supports Unicode labels without counting surrogate pairs twice", () => {
    const name = "🍱".repeat(80);
    expect(parseCategoryList({ categories: [{ ...row, name }], nextOffset: null }, 0).categories[0].name).toBe(name);
    expect(() => parseCategoryList({ categories: [{ ...row, name: name + "🍱" }], nextOffset: null }, 0)).toThrow();
  });
  it("accepts only the exact full-page next offset", () => {
    const categories = Array.from({ length: 100 }, (_, index) => ({ ...row, id: `11111111-1111-4111-8111-${String(index).padStart(12, "0")}` }));
    expect(parseCategoryList({ categories, nextOffset: 200 }, 100).nextOffset).toBe(200);
    expect(() => parseCategoryList({ categories, nextOffset: 300 }, 100)).toThrow();
    expect(() => parseCategoryList({ categories: [...categories, row], nextOffset: null }, 0)).toThrow();
    expect(parseCategoryList({ categories, nextOffset: null, paginationLimitReached: true }, 100000).paginationLimitReached).toBe(true);
    expect(() => parseCategoryList({ categories, nextOffset: 100100 }, 100000)).toThrow();
    expect(() => parseCategoryList({ categories, nextOffset: null, paginationLimitReached: true }, 0)).toThrow();
  });
  it.each([-1, 1.5, Number.NaN, 100001])("rejects invalid requested offset %s", offset => {
    expect(() => parseCategoryList({ categories: [], nextOffset: null }, offset)).toThrow();
  });
  it("merges pagination without duplication, mutation or version downgrade", () => {
    const second = { ...row, id: "22222222-2222-4222-8222-222222222222" };
    const old = Object.freeze([{ ...row, name: "Current", version: 3 }]);
    expect(mergeCategoryList(old, [row, second])).toEqual([old[0], second]);
    expect(mergeCategoryList([row], [{ ...row, name: "Renamed", version: 2 }])).toEqual([{ ...row, name: "Renamed", version: 2 }]);
    expect(old).toHaveLength(1);
  });
});
