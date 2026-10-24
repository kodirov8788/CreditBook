import { VOICE_MAX_ENTRIES, type ReceiptSummary, type VoiceEntry } from "./voice-contract";

export function isReceiptSummary(value: unknown): value is ReceiptSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return Object.keys(row).every(key => ["totalMinor", "currencyCode", "complete", "taxMinor", "taxRatePercent"].includes(key)) && ["totalMinor", "currencyCode", "complete"].every(key => key in row)
    && typeof row.complete === "boolean"
    && (row.currencyCode === null || row.currencyCode === "JPY" || row.currencyCode === "USD" || row.currencyCode === "UZS")
    && (row.totalMinor === null || typeof row.totalMinor === "string" && /^[1-9]\d{0,14}$/.test(row.totalMinor) && BigInt(row.totalMinor) <= BigInt("10000000000000"))
    && (row.taxRatePercent === undefined || row.taxRatePercent === null || row.taxRatePercent === 8 || row.taxRatePercent === 10)
    && (row.taxMinor === undefined || row.taxMinor === null || typeof row.taxMinor === "string" && /^(0|[1-9]\d{0,12})$/.test(row.taxMinor) && BigInt(row.taxMinor) <= BigInt("1000000000000"));
}

/** Largest remainders in printed order: exact JPY, no invented tax or double allocation. */
export function allocateReceiptTax<T extends VoiceEntry>(entries: readonly T[], receipt: ReceiptSummary | null | undefined): readonly T[] | null {
  if (!isReceiptSummary(receipt) || !receipt.complete || receipt.currencyCode !== "JPY" || !receipt.totalMinor || !receipt.taxMinor || receipt.taxMinor === "0"
    || !receipt.taxRatePercent || entries.length < 1 || entries.length > VOICE_MAX_ENTRIES) return null;
  if (entries.some(entry => entry.kind !== "expense" || entry.currencyCode !== "JPY" || entry.taxRatePercent !== receipt.taxRatePercent || !entry.amountMinor || !/^[1-9]\d{0,12}$/.test(entry.amountMinor) || BigInt(entry.amountMinor) > BigInt("1000000000000"))) return null;
  const bases = entries.map(entry => BigInt(entry.amountMinor!)), sum = bases.reduce((a, b) => a + b, BigInt(0)), tax = BigInt(receipt.taxMinor);
  const numerator = sum * BigInt(receipt.taxRatePercent);
  if (sum + tax !== BigInt(receipt.totalMinor) || tax < numerator / BigInt(100) || tax > (numerator + BigInt(99)) / BigInt(100)) return null;
  const shares = bases.map(base => base * tax / sum);
  const order = bases.map((base, index) => ({ index, remainder: base * tax % sum }))
    .sort((a, b) => a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1);
  const remaining = tax - shares.reduce((a, b) => a + b, BigInt(0));
  for (let i = 0; BigInt(i) < remaining; i++) shares[order[i].index] += BigInt(1);
  const result = entries.map((entry, index) => ({ ...entry, amountMinor: String(bases[index] + shares[index]),
    receiptTax: { baseMinor: String(bases[index]), taxMinor: String(shares[index]) } }));
  if (result.some(entry => BigInt(entry.amountMinor) > BigInt("1000000000000"))) return null;
  return result;
}

/** Validate application-generated tax evidence before displaying or persisting it. */
export function validReceiptTax(entry: VoiceEntry): boolean {
  const value: unknown = entry.receiptTax;
  if (value === undefined) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return Object.keys(row).length === 2 && typeof row.baseMinor === "string" && /^[1-9]\d{0,12}$/.test(row.baseMinor)
    && typeof row.taxMinor === "string" && /^(0|[1-9]\d{0,12})$/.test(row.taxMinor)
    && typeof entry.amountMinor === "string" && /^[1-9]\d{0,12}$/.test(entry.amountMinor)
    && BigInt(row.baseMinor) + BigInt(row.taxMinor) === BigInt(entry.amountMinor);
}

/** Tax evidence is all-or-nothing for the current receipt, including its rounding. */
export function validReceiptTaxBatch(entries: readonly VoiceEntry[], receipt: ReceiptSummary): boolean {
  if (entries.every(entry => entry.receiptTax === undefined)) return true;
  if (entries.some(entry => !entry.receiptTax || !validReceiptTax(entry))) return false;
  const expected = allocateReceiptTax<VoiceEntry>(entries.map(entry => ({ ...entry, amountMinor: entry.receiptTax!.baseMinor, receiptTax: undefined })), receipt);
  return !!expected && expected.every((entry, index) => entry.amountMinor === entries[index].amountMinor
    && entry.receiptTax?.taxMinor === entries[index].receiptTax?.taxMinor);
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
  return sum === BigInt(receipt.totalMinor) ? (validReceiptTaxBatch(entries, receipt) ? null : "Soliq taqsimoti o‘zgargan. Summalarni tekshiring yoki soliqni qayta taqsimlang.") : `Mahsulotlar jami ${sum} JPY, chek jami ${receipt.totalMinor} JPY. Soliq yoki chegirmani tekshirib, summalarni tuzating.`;
}
