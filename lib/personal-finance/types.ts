// Draft domain/transport shapes, not persisted tables or authorization checks.
export const CURRENCY_SCALES = { UZS: 2, JPY: 0, USD: 2 } as const;
export type CurrencyCode = keyof typeof CURRENCY_SCALES;
export const DEFAULT_CURRENCY: CurrencyCode = "JPY";

export type Money = {
  [C in CurrencyCode]: Readonly<{
    currencyCode: C;
    scale: (typeof CURRENCY_SCALES)[C];
    /** Canonical integer string; untrusted input still requires runtime validation. */
    amountMinor: string;
  }>
}[CurrencyCode];

export type PersonalAccount = Readonly<{
  id: string;
  workspaceId: string;
  name: string;
  icon: string;
  color: string;
  status: "active" | "archived";
  includeInTotal: boolean;
  balance: Money;
}>;

export type PersonalAccountPreferences = Readonly<{
  workspaceId: string;
  /** Must resolve to an accessible active account; null if none is selected. */
  defaultAccountId: string | null;
}>;

type PostingBase = Readonly<{
  id: string;
  accountId: string;
  workspaceId: string;
  money: Money;
  effectiveDate: string;
  recordedAt: string;
}>;

export type PersonalPosting = PostingBase & (
  | Readonly<{ kind: "opening" }>
  | Readonly<{ kind: "income" | "expense" }>
  | Readonly<{ kind: "reversal"; reversesPostingId: string }>
  | Readonly<{ kind: "replacement"; correctsPostingId: string }>
);

export type IdempotencyIdentity = Readonly<{
  workspaceId: string;
  actorId: string;
  operation: string;
  clientKey: string;
}>;

export type IdempotencyRecord = IdempotencyIdentity & Readonly<{
  /** Stored separately from the unique identity, never part of its unique key. */
  requestFingerprint: string;
  resultId: string;
}>;
