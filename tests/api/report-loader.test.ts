import { describe, expect, it, vi } from "vitest";
import { createReportLoader, reportMatchesRange, type ReportLoadState } from "@/lib/report-loader";
import type { ShopReport } from "@/lib/shop-read-model";

const first = {from: "2026-10-01", to: "2026-10-19"};
const last = {from: "2026-10-18", to: "2026-10-18"};
const report = (range = last): ShopReport => ({...range, newCredits: 0, collected: 0, expensesTotal: 0, netCashflow: 0, outstanding: 66289.99, overdueAmount: 289.99, overdueCount: 5, activeCustomers: 1105, monthly: [], expenses: []});
function deferred() {
  let resolve!: (response: Response) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Response>((yes,no) => {resolve=yes; reject=no;});
  return {promise, resolve, reject};
}
const response = (value: ShopReport) => new Response(JSON.stringify({report: value}));
function setup() {
  const old = deferred(), latest = deferred();
  // Deliberately ignore AbortSignal so generation safety is independently proven.
  const request = vi.fn<typeof fetch>().mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
  const states: ReportLoadState[] = [];
  const loader = createReportLoader(state => states.push(state), request);
  return {old, latest, request, states, loader};
}
describe("latest report request owns all UI state", () => {
  it("late old success cannot overwrite a newer zero-period success", async () => {
    const s=setup(), a=s.loader.load(first,true), b=s.loader.load(last,true);
    expect(s.request.mock.calls[0][1]?.signal?.aborted).toBe(true);
    s.latest.resolve(response(report())); await b;
    const count=s.states.length;
    s.old.resolve(response({...report(first),collected:44320.01})); await a;
    expect(s.states).toHaveLength(count);
    expect(s.states.at(-1)).toEqual({report:report(),loading:false,error:""});
  });
  it("old success does not stop loading while latest is pending", async () => {
    const s=setup(), a=s.loader.load(first,true), b=s.loader.load(last,true);
    s.old.resolve(response(report(first))); await a;
    expect(s.states.at(-1)).toEqual({report:null,loading:true,error:""});
    s.latest.resolve(response(report())); await b;
  });
  it("old body decoding that finishes late cannot publish after the newer response", async () => {
    let finishBody!: (value: {report: ShopReport}) => void;
    const body = new Promise<{report: ShopReport}>(resolve => {finishBody=resolve;});
    const oldResponse = response(report(first));
    oldResponse.json = () => body;
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(oldResponse).mockResolvedValueOnce(response(report()));
    const states: ReportLoadState[]=[];
    const loader=createReportLoader(state=>states.push(state),request);
    const old=loader.load(first,true);
    await Promise.resolve();
    await loader.load(last,true);
    const count=states.length;
    finishBody({report:report(first)}); await old;
    expect(states).toHaveLength(count);
    expect(states.at(-1)?.report).toEqual(report());
  });
  it("late old network failure cannot replace newer success", async () => {
    const s=setup(), a=s.loader.load(first,true), b=s.loader.load(last,true);
    s.latest.resolve(response(report())); await b;
    s.old.reject(new Error("old offline")); await a;
    expect(s.states.at(-1)).toEqual({report:report(),loading:false,error:""});
  });
  it("latest failure clears stale data, terminates loading, and can retry", async () => {
    const states: ReportLoadState[]=[];
    const request=vi.fn<typeof fetch>().mockResolvedValueOnce(response(report(first))).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(response(report()));
    const loader=createReportLoader(state=>states.push(state),request);
    await loader.load(first,true); await loader.load(last,true);
    expect(states.at(-1)).toMatchObject({report:null,loading:false});
    expect(states.at(-1)?.error).toContain("Qayta urinib");
    await loader.load(last,true);
    expect(states.at(-1)).toEqual({report:report(),loading:false,error:""});
  });
  it("unmount cancellation prevents late setters even when transport ignores abort", async () => {
    const s=setup(), pending=s.loader.load(first,true);
    s.loader.cancel(); const count=s.states.length;
    s.old.resolve(response(report(first))); await pending;
    expect(s.states).toHaveLength(count);
  });
  it("rejects a server response belonging to a different date range", async () => {
    const s=setup(), pending=s.loader.load(last,true);
    s.old.resolve(response(report(first))); await pending;
    expect(s.states.at(-1)).toMatchObject({report:null,loading:false});
    expect(s.states.at(-1)?.error).not.toBe("");
  });
  it("rejects range-matching malformed data before the report panel can render it", async () => {
    const s=setup(), pending=s.loader.load(last,true);
    s.old.resolve(new Response(JSON.stringify({report:last}))); await pending;
    expect(s.states.at(-1)).toMatchObject({report:null,loading:false});
    expect(s.states.at(-1)?.error).not.toBe("");
  });
  it("reports current HTTP failure without retaining old totals", async () => {
    const s=setup(), pending=s.loader.load(last,true);
    s.old.resolve(new Response(JSON.stringify({error:"Hisobot sanalarini tekshiring."}),{status:400})); await pending;
    expect(s.states.at(-1)).toEqual({report:null,loading:false,error:"Hisobot sanalarini tekshiring."});
  });
  it("uses no-store and a captured date range", async () => {
    const s=setup(), input={...first}, pending=s.loader.load(input,true);
    input.from=last.from;
    s.old.resolve(response(report(first))); await pending;
    expect(s.states.at(-1)?.report?.from).toBe(first.from);
    expect(s.request).toHaveBeenCalledWith('/api/reports?from=2026-10-01&to=2026-10-19',expect.objectContaining({cache:'no-store',signal:expect.any(AbortSignal)}));
  });
  it("live-mode absence needs no network and leaves loading false", async () => {
    const s=setup(); await s.loader.load(last,false);
    expect(s.request).not.toHaveBeenCalled();
    expect(s.states.at(-1)).toMatchObject({report:null,loading:false});
  });
  it("timeout-style rejection ends loading and shows a retryable error", async () => {
    const states: ReportLoadState[]=[];
    const loader=createReportLoader(state=>states.push(state),vi.fn<typeof fetch>().mockRejectedValue(new DOMException("timed out","TimeoutError")));
    await loader.load(last,true);
    expect(states.at(-1)).toMatchObject({report:null,loading:false});
    expect(states.at(-1)?.error).toContain("Qayta urinib");
  });
  it("enforces its deadline even when transport ignores the abort signal", async () => {
    vi.useFakeTimers();
    try {
      const s=setup(), pending=s.loader.load(last,true);
      await vi.advanceTimersByTimeAsync(20_000);
      expect(s.request.mock.calls[0][1]?.signal?.aborted).toBe(true);
      s.old.resolve(response(report())); await pending;
      expect(s.states.at(-1)).toMatchObject({report:null,loading:false});
      expect(s.states.at(-1)?.error).toContain("Qayta urinib");
      expect(vi.getTimerCount()).toBe(0);
    } finally {vi.useRealTimers();}
  });
  it("render guard hides old range immediately, before effects", () => {
    expect(reportMatchesRange(report(first),last)).toBe(false);
    expect(reportMatchesRange(report(),last)).toBe(true);
    expect(reportMatchesRange(null,last)).toBe(false);
    expect(reportMatchesRange({from:null,to:null},{from:"",to:""})).toBe(true);
  });
});
