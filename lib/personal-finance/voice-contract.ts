/** Editable suggestions only. Neither a draft nor AI output authorizes a write. */
export const VOICE_CONSENT_VERSION = "google-safety-retention-2026-10-21";
export const VOICE_MAX_SECONDS = 30;
export const VOICE_MAX_TEXT = 1200;
export const VOICE_MAX_AUDIO_BYTES = 960044;
export const VOICE_MAX_ENTRIES = 10;

export type VoiceCategory = Readonly<{ id: string; name: string }>;
export type VoiceEntry = Readonly<{
  kind: "income" | "expense";
  amountMinor: string | null;
  currencyCode: "JPY" | "USD" | "UZS" | null;
  categoryId: string | null;
  effectiveDate: string;
  note: string;
  taxRatePercent?: 8 | 10 | null;
  /** Application-computed evidence; never supplied by the model. */
  receiptTax?: Readonly<{ baseMinor: string; taxMinor: string }>;
}>;
export type VoiceDraft = Readonly<{
  transcript: string;
  /** Present only for category-name drafts; never a financial write. */
  categoryName?: string | null;
  entries: readonly VoiceEntry[];
  clarification: string | null;
  receipt?: ReceiptSummary;
}>;
export type ReceiptSummary = Readonly<{
  totalMinor: string | null;
  currencyCode: "JPY" | "USD" | "UZS" | null;
  complete: boolean;
  /** Explicit, uniform outside tax only; null/absent means unknown or already included. */
  taxMinor?: string | null;
  taxRatePercent?: 8 | 10 | null;
}>;
export type VoiceDraftRequest = Readonly<{
  requestId: string;
  consent: typeof VOICE_CONSENT_VERSION;
  defaultKind: "income" | "expense";
  purpose?: "category";
}> & (Readonly<{ mode: "text"; text: string }> | Readonly<{ mode: "audio"; audio: string }> | Readonly<{ mode: "receipt"; image: string }>);
export type VoiceDraftResponse = Readonly<{
  ok: true;
  ownerId: string;
  requestId: string;
  draft: VoiceDraft;
  categoryContextLimited?: boolean;
  budget: Readonly<{ remainingMicros: string }>;
}>;
