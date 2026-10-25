import { describe, expect, it } from "vitest";
import { allocateReceiptTax, isReceiptSummary, receiptProblem, validReceiptTax } from "@/lib/personal-finance/receipt-contract";
import { validateVoiceDraft, inferVoice } from "@/lib/ai/voice-provider";
import { confirmedVoiceEntries } from "@/components/personal/voice-entry";
import { VOICE_CONSENT_VERSION, type VoiceEntry, type ReceiptSummary, type VoiceDraftRequest } from "@/lib/personal-finance/voice-contract";

const category = "22222222-2222-4222-8222-222222222222";
const categories = [{ id: category, name: "Boshqa" }];
const line = (amount: string): VoiceEntry => ({ kind: "expense", amountMinor: amount, currencyCode: "JPY", categoryId: category, effectiveDate: "2026-10-24", note: "Yogurt", taxRatePercent: 8 });
const receipt: ReceiptSummary = { totalMinor: "602", currencyCode: "JPY", complete: true, taxMinor: "44", taxRatePercent: 8 };
const request: VoiceDraftRequest = { requestId: "11111111-1111-4111-8111-111111111111", consent: VOICE_CONSENT_VERSION, defaultKind: "expense", mode: "receipt", image: "unused" };

describe("explicit receipt tax allocation", () => {
  it("allocates 558 + 44 = 602 exactly without changing original drafts or IDs", () => {
    const original = [{ ...line("299"), id: "a" }, { ...line("259"), id: "b" }];
    const result = allocateReceiptTax(original, receipt)!;
    expect(result.map(e => e.amountMinor)).toEqual(["323", "279"]);
    expect(result.map(e => e.id)).toEqual(["a", "b"]);
    expect(result[0].receiptTax).toEqual({baseMinor:"299",taxMinor:"24"});
    expect(result[0].note).toBe("Yogurt");
    expect(original[0].amountMinor).toBe("299");
    expect(receiptProblem(result, receipt)).toBeNull();
    expect(allocateReceiptTax(result, receipt)).toBeNull(); // never charge tax twice
  });
  it("breaks equal remainders by printed order", () => {
    const result = allocateReceiptTax([line("4"), line("4"), line("4")], { ...receipt, totalMinor: "13", taxMinor: "1" })!;
    expect(result.map(e => e.amountMinor)).toEqual(["5", "4", "4"]);
  });
  it("preserves exact sums and proportional floor/ceiling for varying product counts", () => {
    for (let count = 1; count <= 10; count++) for (let seed = 1; seed <= 25; seed++) {
      const items = Array.from({ length: count }, (_, i) => line(String(seed * 17 + i * 13)));
      const base = items.reduce((sum, e) => sum + BigInt(e.amountMinor!), BigInt(0));
      const tax = Number(base * BigInt(8) / BigInt(100));
      const result = allocateReceiptTax(items, { ...receipt, taxMinor: String(tax), totalMinor: String(base + BigInt(tax)) })!;
      expect(result.reduce((sum, e) => sum + BigInt(e.amountMinor!), BigInt(0))).toBe(base + BigInt(tax));
      result.forEach((e, i) => {
        const product = BigInt(items[i].amountMinor!), share = BigInt(e.amountMinor!) - product;
        expect(share >= product * BigInt(tax) / base && share <= (product * BigInt(tax) + base - BigInt(1)) / base).toBe(true);
      });
    }
  });
  it.each([{taxMinor:null}, {taxMinor:undefined}, {taxMinor:"0"}, {taxMinor:"43"}, {taxMinor:"-44"}, {taxMinor:"4.4"}, {complete:false}, {currencyCode:"USD"}, {totalMinor:"550"}])("does not invent adjustments for %j", change => {
    expect(allocateReceiptTax([line("299"),line("259")], {...receipt,...change} as ReceiptSummary)).toBeNull();
  });
  it("rejects unsupported or excessive amounts, incomplete products and forged tax evidence", () => {
    for (const bad of [line("0"),line("1.5"),line("1000000000001"),{...line("558"),currencyCode:"USD" as const},{...line("558"),kind:"income" as const}]) expect(allocateReceiptTax([bad],receipt)).toBeNull();
    expect(validReceiptTax({...line("323"),receiptTax:{baseMinor:"299",taxMinor:"24"}})).toBe(true);
    expect(validReceiptTax({...line("324"),receiptTax:{baseMinor:"299",taxMinor:"24"}})).toBe(false);
    expect(allocateReceiptTax(Array.from({length:11},()=>line("1")),{...receipt,totalMinor:"55"})).toBeNull();
    expect(allocateReceiptTax([line("1000000000000")],{...receipt,totalMinor:"1000000000044"})).toBeNull();
  });
  it("accepts legacy receipts and rejects extra or invalid metadata", () => {
    expect(isReceiptSummary({totalMinor:"602",currencyCode:"JPY",complete:true})).toBe(true);
    expect(isReceiptSummary(receipt)).toBe(true);
    expect(isReceiptSummary({...receipt,taxMinor:"NaN"})).toBe(false);
    expect(isReceiptSummary({...receipt,execute:true})).toBe(false);
  });
  it("automatically returns confirmable, individually taxed cards while retaining real ambiguities", () => {
    const raw = {transcript:"Yogurt",entries:[line("299"),line("259")],clarification:null,receipt};
    const draft = validateVoiceDraft(raw,request,categories)!;
    expect(draft.clarification).toBeNull();
    expect(draft.entries.map(e=>e.amountMinor)).toEqual(["323","279"]);
    const confirmed = confirmedVoiceEntries(draft.entries.map((e,i)=>({...e,id:String(i)})),draft.transcript,"receipt",categories,draft.receipt)!;
    expect(confirmed.map(e=>e.amountMinor)).toEqual(["323","279"]);
    expect(confirmed[0].note).toContain("soliq ulushi 24 JPY");
    expect(validateVoiceDraft({...raw,clarification:"Sana noaniq"},request,categories)?.clarification).toBe("Sana noaniq");
    expect(validateVoiceDraft({...raw,receipt:{...receipt,taxMinor:null}},request,categories)?.clarification).toBeTruthy();
  });
  it("rejects mixed rates, exempt/unknown lines and arithmetic-inconsistent declared tax", () => {
    for (const rate of [null, undefined, 10] as const) expect(allocateReceiptTax([line("299"),{...line("259"),taxRatePercent:rate}],receipt)).toBeNull();
    expect(allocateReceiptTax([line("299"),line("259")],{...receipt,taxRatePercent:null})).toBeNull();
    expect(allocateReceiptTax([line("299"),line("259")],{...receipt,taxMinor:"80",totalMinor:"638"})).toBeNull();
  });
  it("does not persist stale tax claims after a user edits amounts or duplicate claims on reallocation", () => {
    const allocated = allocateReceiptTax([line("299"),line("259")],receipt)!;
    const edited = allocated.map((e,i)=>({...e,id:String(i),amountMinor:i===0?"324":"278",receiptTax:undefined}));
    const confirmed=confirmedVoiceEntries(edited,"Yogurt","receipt",categories,receipt)!;
    expect(confirmed.map(e=>e.amountMinor)).toEqual(["324","278"]);
    expect(confirmed.every(e=>!e.note.includes("soliq ulushi"))).toBe(true);
    expect(confirmedVoiceEntries([{...allocated[0],id:"0",amountMinor:"324"},{...allocated[1],id:"1",amountMinor:"278"}],"Yogurt","receipt",categories,receipt)).toBeNull();
    const again=allocateReceiptTax(allocated.map((e,i)=>({...e,amountMinor:i===0?"299":"259",receiptTax:undefined})),receipt)!;
    expect(again.map(e=>e.receiptTax)).toEqual(allocated.map(e=>e.receiptTax));
    expect(again.map(e=>e.note)).toEqual(["Yogurt","Yogurt"]);
  });
  it("rejects partial or collectively wrong tax annotations even when the payable total matches", () => {
    const allocated = allocateReceiptTax([line("299"),line("259")],receipt)!;
    expect(receiptProblem([{...allocated[0],receiptTax:undefined},allocated[1]],receipt)).toBeTruthy();
    expect(receiptProblem([{...allocated[0],amountMinor:"322",receiptTax:{baseMinor:"299",taxMinor:"23"}},{...allocated[1],amountMinor:"280",receiptTax:{baseMinor:"259",taxMinor:"21"}}],receipt)).toBeTruthy();
    expect(receiptProblem(allocated,receipt)).toBeNull();
  });
  it("requests only printed uniform exclusive tax and keeps the provider privacy guards", async () => {
    let spec: Record<string, unknown> = {};
    const fetcher: typeof fetch = async (_url, options) => { spec=JSON.parse(String(options?.body)); return Response.json({usage:{cost:0.001},choices:[{finish_reason:"stop",message:{content:JSON.stringify({transcript:"Yogurt",entries:[line("299"),line("259")],clarification:null,receipt})}}]}); };
    const result=await inferVoice(request,categories,"synthetic",new AbortController().signal,fetcher);
    expect(result.draft?.entries.map(e=>e.amountMinor)).toEqual(["323","279"]);
    expect(JSON.stringify(spec)).toContain("taxMinor");
    expect(spec).toHaveProperty("response_format.json_schema.schema.properties.receipt.required", ["totalMinor","currencyCode","complete","taxMinor","taxRatePercent"]);
    expect(JSON.stringify(spec)).toContain("mixed rates");
    expect(spec.provider).toMatchObject({data_collection:"deny",zdr:true,allow_fallbacks:false});
  });
});
