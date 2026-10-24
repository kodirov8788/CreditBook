import { describe, expect, it } from "vitest";
import { formatMinorAmount, parseDecimalAmount, parseMinorAmount } from "@/lib/personal-finance/money";
import { CURRENCY_SCALES, DEFAULT_CURRENCY, type Money } from "@/lib/personal-finance/types";

// Fixture-only limit, not an approved product or database range.
const maxAbsMinor = BigInt("999999999999999999");
const limits = { scale: 2, maxAbsMinor };

describe("exact personal money", () => {
  it.each([
    ["0", "0"], ["-0", "0"], ["-0.00", "0"], ["0.1", "10"],
    ["0.10", "10"], ["100000", "10000000"], ["-45.01", "-4501"],
    ["90071992547409.93", "9007199254740993"],
  ])("converts %s without floating point", (input, expected) => {
    expect(parseDecimalAmount(input, limits)).toBe(BigInt(expected));
  });

  it.each(["", " ", " 1", "1 ", "1\n", "1\r", "1\t", "+1", "01", "00",
    "1,000", "1 000", "1e3", "NaN", "Infinity", "-Infinity", ".1", "1.", "١", "１", "1,20"])(
    "rejects ambiguous decimal input %j", (input) => {
      expect(() => parseDecimalAmount(input, limits)).toThrow();
    },
  );

  it.each([0, 1.2, Number.NaN, Infinity, null, undefined, {}, [], true, BigInt(1)])(
    "rejects non-string input %s", (input) => {
      expect(() => parseDecimalAmount(input, limits)).toThrow(TypeError);
      expect(() => parseMinorAmount(input, limits)).toThrow(TypeError);
    },
  );

  it.each(["0.001", "1.000", "-0.001"])("rejects excess scale instead of rounding %s", (input) => {
    expect(() => parseDecimalAmount(input, limits)).toThrow(RangeError);
  });

  it.each(["0", "-0", "1", "-42", "9007199254740993"])("parses exact minor units %s", (input) => {
    expect(parseMinorAmount(input, limits)).toBe(BigInt(input));
  });

  it.each(["01", "-01", "+1", "1.0", "1e2", " 1", "1\n", "١", "--1"])(
    "rejects noncanonical minor units %j", (input) => {
      expect(() => parseMinorAmount(input, limits)).toThrow(TypeError);
    },
  );

  it("enforces explicit positive and negative magnitude boundaries", () => {
    expect(parseMinorAmount(maxAbsMinor.toString(), limits)).toBe(maxAbsMinor);
    expect(parseMinorAmount((-maxAbsMinor).toString(), limits)).toBe(-maxAbsMinor);
    for (const outside of [maxAbsMinor + BigInt(1), -maxAbsMinor - BigInt(1)]) {
      expect(() => parseMinorAmount(outside.toString(), limits)).toThrow(RangeError);
      expect(() => parseDecimalAmount(formatMinorAmount(outside, 2), limits)).toThrow(RangeError);
    }
    expect(parseDecimalAmount("0", { scale: 2, maxAbsMinor: BigInt(0) })).toBe(BigInt(0));
  });

  it.each([-1, 0.5, 19, Number.NaN, Infinity])("rejects invalid scales %s", (scale) => {
    expect(() => parseDecimalAmount("1", { scale, maxAbsMinor })).toThrow(RangeError);
    expect(() => parseMinorAmount("1", { scale, maxAbsMinor })).toThrow(RangeError);
    expect(() => formatMinorAmount(BigInt(1), scale)).toThrow(RangeError);
  });

  it("rejects invalid limits and oversized raw input", () => {
    expect(() => parseDecimalAmount("1", { scale: 2, maxAbsMinor: -BigInt(1) })).toThrow();
    expect(() => parseMinorAmount("1", { scale: 2, maxAbsMinor: 1 as unknown as bigint })).toThrow();
    expect(() => parseDecimalAmount("1".repeat(97), limits)).toThrow();
    expect(() => parseMinorAmount("1".repeat(97), limits)).toThrow();
    expect(() => formatMinorAmount(1 as unknown as bigint, 2)).toThrow(TypeError);
  });

  it.each([["0", 2, "0.00"], ["1", 2, "0.01"], ["-1", 2, "-0.01"],
    ["100", 2, "1.00"], ["123", 0, "123"], ["-123", 0, "-123"]] as const)(
    "formats %s at scale %s", (minor, scale, expected) => {
      expect(formatMinorAmount(BigInt(minor), scale)).toBe(expected);
    },
  );

  it("reconciles opening, income and expenses exactly", () => {
    const parse = (value: string) => parseDecimalAmount(value, limits);
    expect(formatMinorAmount(parse("0.10") + parse("0.20"), 2)).toBe("0.30");
    expect(formatMinorAmount(parse("0") + parse("100000") - parse("45000"), 2)).toBe("55000.00");
    expect(formatMinorAmount(parse("100000") + parse("50000"), 2)).toBe("150000.00");
  });

  it("round-trips signed values for each approved currency", () => {
    expect(DEFAULT_CURRENCY).toBe("JPY");
    expect(CURRENCY_SCALES).toEqual({ UZS: 2, JPY: 0, USD: 2 });
    for (const scale of Object.values(CURRENCY_SCALES)) {
      for (const value of [BigInt(0), BigInt(1), -BigInt(1), BigInt("9007199254740993")]) {
        expect(parseDecimalAmount(formatMinorAmount(value, scale), { scale, maxAbsMinor })).toBe(value);
      }
    }
    expect(() => parseDecimalAmount("1.1", { scale: 0, maxAbsMinor })).toThrow();
  });

  it("transports money as strings without bigint or JSON number conversion", () => {
    const money: Money = { currencyCode: "UZS", scale: 2, amountMinor: "9007199254740993" };
    expect(JSON.parse(JSON.stringify(money))).toEqual(money);
    expect(typeof JSON.parse(JSON.stringify(money)).amountMinor).toBe("string");
  });

  it.each([0, 2, 18])("round-trips both signs at the raw length boundary, scale %s", (scale) => {
    const digits = scale === 0 ? 95 : 94;
    const boundary = BigInt("9".repeat(digits));
    const policy = { scale, maxAbsMinor: boundary };
    for (const amount of [boundary, -boundary]) {
      const decimal = formatMinorAmount(amount, scale);
      expect(decimal.length).toBeLessThanOrEqual(96);
      expect(parseMinorAmount(amount.toString(), policy)).toBe(amount);
      expect(parseDecimalAmount(decimal, policy)).toBe(amount);
    }
    const incompatible = { scale, maxAbsMinor: BigInt("9".repeat(digits + 1)) };
    expect(() => parseMinorAmount("0", incompatible)).toThrow(RangeError);
    expect(() => parseDecimalAmount("0", incompatible)).toThrow(RangeError);
  });
});
