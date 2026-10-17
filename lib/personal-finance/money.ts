/** Pure exact arithmetic. No database, currency conversion or JSON numbers. */
export type MoneyLimits = Readonly<{ scale: number; maxAbsMinor: bigint }>;

const ZERO = BigInt(0);
const TEN = BigInt(10);
const MAX_INPUT_LENGTH = 96;

function checkScale(scale: number): void {
  if (!Number.isInteger(scale) || scale < 0 || scale > 18) {
    throw new RangeError("Money scale must be an integer between 0 and 18.");
  }
}

function checkLimits(limits: MoneyLimits): void {
  checkScale(limits.scale);
  if (typeof limits.maxAbsMinor !== "bigint" || limits.maxAbsMinor < ZERO) {
    throw new RangeError("A nonnegative bigint magnitude limit is required.");
  }
  // The longest signed fixed-scale spelling must fit the same parser cap.
  // Otherwise an accepted minor amount could format to an unparseable decimal.
  if (formatMinorAmount(-limits.maxAbsMinor, limits.scale).length > MAX_INPUT_LENGTH) {
    throw new RangeError("Money limit exceeds the signed round-trip length cap.");
  }
}

function checkText(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.length === 0
    || value.length > MAX_INPUT_LENGTH || value.trim() !== value) {
    throw new TypeError("Money must be a bounded, unpadded ASCII string.");
  }
}

function withinLimit(value: bigint, limit: bigint): bigint {
  if (value > limit || value < -limit) throw new RangeError("Money exceeds its magnitude limit.");
  return value;
}

/** API minor units: canonical integer spelling; negative zero normalizes to zero. */
export function parseMinorAmount(value: unknown, limits: MoneyLimits): bigint {
  checkLimits(limits);
  checkText(value);
  if (!/^-?(?:0|[1-9][0-9]*)$/.test(value)) {
    throw new TypeError("Minor units must be a canonical integer string.");
  }
  return withinLimit(BigInt(value), limits.maxAbsMinor);
}

/** User decimal spelling: no grouping, exponents, plus sign or silent rounding. */
export function parseDecimalAmount(value: unknown, limits: MoneyLimits): bigint {
  checkLimits(limits);
  checkText(value);
  const match = /^(-?)(0|[1-9][0-9]*)(?:\.([0-9]+))?$/.exec(value);
  if (!match) throw new TypeError("Invalid decimal money spelling.");
  const fraction = match[3] ?? "";
  if (fraction.length > limits.scale) throw new RangeError("Money has excess precision.");
  const factor = TEN ** BigInt(limits.scale);
  const absolute = BigInt(match[2]) * factor
    + BigInt(fraction.padEnd(limits.scale, "0") || "0");
  return withinLimit(match[1] ? -absolute : absolute, limits.maxAbsMinor);
}

/** Fixed-scale decimal output; bigint never crosses the JSON transport boundary. */
export function formatMinorAmount(value: bigint, scale: number): string {
  checkScale(scale);
  if (typeof value !== "bigint") throw new TypeError("Expected exact bigint minor units.");
  const absolute = value < ZERO ? -value : value;
  const sign = value < ZERO ? "-" : "";
  if (scale === 0) return sign + absolute.toString();
  const digits = absolute.toString().padStart(scale + 1, "0");
  return `${sign}${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
}
