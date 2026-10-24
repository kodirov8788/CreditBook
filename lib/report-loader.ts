import type { ShopReport } from "./shop-read-model";

export type ReportRange = {from: string; to: string};
export type ReportLoadState = {report: ShopReport | null; loading: boolean; error: string};
const retryError = "Hisobot olinmadi. Qayta urinib ko‘ring.";
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const isNumber = (value: unknown) => typeof value === "number" && Number.isFinite(value);
const isNullableText = (value: unknown) => value === null || typeof value === "string";
function isReport(value: unknown): value is ShopReport {
  if (!isRecord(value) || !isNullableText(value.from) || !isNullableText(value.to)) return false;
  if (!["newCredits","collected","expensesTotal","netCashflow","outstanding","overdueAmount","overdueCount","activeCustomers"].every(key=>isNumber(value[key]))) return false;
  return Array.isArray(value.monthly) && value.monthly.every(row=>isRecord(row) && typeof row.month === "string" && [row.credits,row.collected,row.expenses,row.netCashflow].every(isNumber))
    && Array.isArray(value.expenses) && value.expenses.every(row=>isRecord(row) && [row.id,row.category,row.spent_at,row.payment_method,row.created_at].every(item=>typeof item === "string") && isNumber(row.amount) && [row.vendor,row.note,row.voided_at,row.void_reason].every(isNullableText));
}

export function reportMatchesRange(report: Pick<ShopReport, "from" | "to"> | null, range: ReportRange) {
  return report !== null && report.from === (range.from || null) && report.to === (range.to || null);
}

/** Owns one mounted dashboard's report reads. Aborting saves client work;
 * the generation check also rejects transports that ignore cancellation.
 */
export function createReportLoader(publish: (state: ReportLoadState) => void, request: typeof fetch = fetch) {
  let generation = 0;
  let controller: AbortController | null = null;
  return {
    cancel() {
      generation++;
      controller?.abort();
      controller = null;
    },
    async load(range: ReportRange, liveMode: boolean) {
      const current = ++generation;
      controller?.abort();
      const active = new AbortController();
      controller = active;
      publish({report: null, loading: true, error: ""});
      const selected = {...range};
      let timer: ReturnType<typeof setTimeout> | undefined;
      let failure = retryError;
      try {
        if (!liveMode) { failure = "Hisobot uchun Supabase ulanishi kerak."; throw new Error(failure); }
        const params = new URLSearchParams();
        if (selected.from) params.set("from", selected.from);
        if (selected.to) params.set("to", selected.to);
        // Controller + cleared timer also works on browsers without AbortSignal.any.
        timer = setTimeout(() => active.abort(), 20_000);
        const response = await request(`/api/reports?${params}`, {cache: "no-store", signal: active.signal});
        const payload: unknown = await response.json().catch(() => null);
        if (current !== generation) return;
        if (active.signal.aborted) throw new Error(retryError);
        if (isRecord(payload) && typeof payload.error === "string") failure = payload.error;
        if (!response.ok || !isRecord(payload) || !isReport(payload.report) || !reportMatchesRange(payload.report, selected)) throw new Error(failure);
        publish({report: payload.report, loading: false, error: ""});
      } catch {
        if (current !== generation) return;
        publish({report: null, loading: false, error: failure});
      } finally {
        clearTimeout(timer);
        if (current === generation) controller = null;
      }
    },
  };
}
