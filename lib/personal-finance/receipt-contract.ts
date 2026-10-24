import { VOICE_MAX_ENTRIES, type ReceiptSummary, type VoiceEntry } from "./voice-contract";

export function isReceiptSummary(value: unknown): value is ReceiptSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return Object.keys(row).length === 3 && ["totalMinor", "currencyCode", "complete"].every(key => key in row)
    && typeof row.complete === "boolean"
    && (row.currencyCode === null || row.currencyCode === "JPY" || row.currencyCode === "USD" || row.currencyCode === "UZS")
    && (row.totalMinor === null || typeof row.totalMinor === "string" && /^[1-9]\d{0,14}$/.test(row.totalMinor) && BigInt(row.totalMinor) <= BigInt("10000000000000"));
}

/** Exact reconciliation: no FX, invented adjustment or partial receipt acceptance. */
export function receiptProblem(entries: readonly VoiceEntry[], receipt: ReceiptSummary | null | undefined): string | null {
  if (!isReceiptSummary(receipt)) return "Chek jami aniqlanmadi. Qayta suratga oling.";
  if (!receipt.complete || entries.length < 1 || entries.length > VOICE_MAX_ENTRIES) return "Chek to‘liq o‘qilmadi yoki 10 tadan ortiq mahsulot bor. Qayta suratga oling yoki qo‘lda kiriting.";
  if (receipt.currencyCode !== "JPY") return "Bu chek JPYda emas yoki valyuta noaniq. Avtomatik kurs qo‘llanmaydi.";
  if (!receipt.totalMinor) return "Chekdagi jami summani JPYda kiriting.";
  let sum = BigInt(0);
  for (const entry of entries) {
    if (entry.kind !== "expense" || entry.currencyCode !== "JPY" || !entry.amountMinor || !/^[1-9]\d{0,12}$/.test(entry.amountMinor) || BigInt(entry.amountMinor) > BigInt("1000000000000")) return "Har bir mahsulot uchun musbat JPY xarajati kerak.";
    sum += BigInt(entry.amountMinor);
  }
  return sum === BigInt(receipt.totalMinor) ? null : `Mahsulotlar jami ${sum} JPY, chek jami ${receipt.totalMinor} JPY. Soliq yoki chegirmani tekshirib, summalarni tuzating.`;
}
