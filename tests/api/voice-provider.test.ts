import { describe, expect, it, vi } from "vitest";
import { costMicros, inferVoice, validateVoiceDraft, validateVoiceRequest } from "@/lib/ai/voice-provider";
import { VOICE_CONSENT_VERSION, type VoiceDraftRequest } from "@/lib/personal-finance/voice-contract";
const input: VoiceDraftRequest = { mode:"text", text:"Tushlik 1200 yen", requestId:"11111111-1111-4111-8111-111111111111", defaultKind:"expense", consent:VOICE_CONSENT_VERSION };
const categories = [{id:"22222222-2222-4222-8222-222222222222",name:"Ovqat"}];
const draft = () => ({transcript:"model paraphrase",clarification:null,entries:[{kind:"expense",amountMinor:"1200",currencyCode:"JPY",categoryId:categories[0].id,effectiveDate:"2026-10-21",note:"Tushlik"}]});
function wav(samples = 16000) {
  const b = Buffer.alloc(44+samples*2); b.write("RIFF"); b.writeUInt32LE(b.length-8,4); b.write("WAVEfmt ",8); b.writeUInt32LE(16,16); b.writeUInt16LE(1,20); b.writeUInt16LE(1,22); b.writeUInt32LE(16000,24); b.writeUInt32LE(32000,28); b.writeUInt16LE(2,32); b.writeUInt16LE(16,34); b.write("data",36); b.writeUInt32LE(samples*2,40); return b;
}
describe("bounded private voice provider",()=>{
  it("accepts original text and canonical mono PCM only",()=>{
    expect(validateVoiceRequest(input)).toEqual(input);
    const base={requestId:input.requestId,consent:input.consent,defaultKind:input.defaultKind};
    expect(validateVoiceRequest({...base,mode:"audio",audio:wav().toString("base64")})).not.toBeNull();
    for(const bytes of [wav(0),wav(480001),Buffer.from("RIFFinvalid")]) expect(validateVoiceRequest({...base,mode:"audio",audio:bytes.toString("base64")})).toBeNull();
    const malformed=wav(); malformed.writeUInt16LE(2,22);
    expect(validateVoiceRequest({...base,mode:"audio",audio:malformed.toString("base64")})).toBeNull();
  });
  it.each([{consent:"old"},{text:""},{text:"x".repeat(1201)},{text:"secret\u0000"},{ownerId:"forged"},{requestId:"bad"},{mode:"video"}])("rejects invalid input %j",change=>{
    expect(validateVoiceRequest({...input,...change})).toBeNull();
  });
  it.each([[0,"0"],[0.00000001,"1"],[0.00012345,"124"],[0.05,"50000"],[0.050001,null],[-1,null],[Infinity,null],[null,null]] as const)("rounds cost %s safely",(cost,expected)=>expect(costMicros(cost)).toBe(expected));
  it("preserves text transcript and explicit foreign currency without FX",()=>{
    const value=draft();value.entries[0].currencyCode="USD";
    expect(validateVoiceDraft(value,input,categories)).toMatchObject({transcript:input.text,entries:[{currencyCode:"USD",amountMinor:"1200"}]});
  });
  it("requires correction for missing amounts/categories",()=>{
    const value={...draft(),entries:[{...draft().entries[0],amountMinor:null,categoryId:null}]};
    expect(validateVoiceDraft(value,input,categories)?.clarification).toBeTruthy();
  });
  it.each([{amountMinor:"1.2"},{amountMinor:"0"},{amountMinor:"1000000000001"},{categoryId:"foreign-owner"},{effectiveDate:"2026-02-30"},{currencyCode:"EUR"},{note:"x".repeat(401)},{tool:"execute"}])("rejects unsafe provider entry %j",change=>{
    expect(validateVoiceDraft({...draft(),entries:[{...draft().entries[0],...change}]},input,categories)).toBeNull();
  });
  it("pins audio-capable model, privacy and output bounds without temperature or retry",async()=>{
    const fetcher=vi.fn<typeof fetch>(async()=>Response.json({usage:{cost:0.001},choices:[{finish_reason:"stop",message:{content:JSON.stringify(draft())}}]}));
    const result=await inferVoice(input,categories,"synthetic-key",new AbortController().signal,fetcher);
    expect(result.cost).toBe("1000");expect(result.draft?.transcript).toBe(input.text);
    const spec=JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(spec.model).toBe("google/gemini-3.8-flash");expect(spec.temperature).toBeUndefined();
    expect(spec.provider).toMatchObject({data_collection:"deny",zdr:true,allow_fallbacks:false});
    expect(JSON.stringify(spec)).not.toContain(input.requestId); expect(fetcher).toHaveBeenCalledOnce();
  });
  it("records known cost even for invalid output; missing cost stays unknown",async()=>{
    const fetcher=vi.fn<typeof fetch>(async()=>Response.json({usage:{cost:0.001},choices:[{finish_reason:"length",message:{content:"partial"}}]}));
    expect(await inferVoice(input,categories,"synthetic-key",AbortSignal.timeout(1000),fetcher)).toEqual({draft:null,cost:"1000"});
    fetcher.mockResolvedValue(Response.json({choices:[]}));
    expect(await inferVoice(input,categories,"synthetic-key",AbortSignal.timeout(1000),fetcher)).toEqual({draft:null,cost:null});
  });
  it.each([400,401,402,403,429,500,503])("logs only HTTP status %s without retrying or exposing private errors",async status=>{
    const warning=vi.spyOn(console,"warn").mockImplementation(()=>{});
    try {
      const fetcher=vi.fn<typeof fetch>(async()=>Response.json({error:"private token"},{status,headers:{"X-Private":"private header"}}));
      expect(await inferVoice(input,categories,"synthetic-key",AbortSignal.timeout(1000),fetcher)).toEqual({draft:null,cost:null});
      expect(fetcher).toHaveBeenCalledOnce();
      expect(warning.mock.calls).toEqual([["creditbook_voice_upstream_failed",{status}]]);
    } finally { warning.mockRestore(); }
  });
});

describe("category-name audio drafts",()=>{
  const categoryInput: VoiceDraftRequest = { requestId:input.requestId, consent:input.consent, defaultKind:input.defaultKind, mode:"audio",audio:wav().toString("base64"),purpose:"category" };
  it("accepts explicit audio purpose but rejects unsupported modes and extra claims",()=>{
    expect(validateVoiceRequest(categoryInput)).toEqual(categoryInput);
    expect(validateVoiceRequest({...input,purpose:"category"})).toBeNull();
    expect(validateVoiceRequest({...categoryInput,purpose:"admin"})).toBeNull();
    expect(validateVoiceRequest({...categoryInput,ownerId:"forged"})).toBeNull();
  });
  it("accepts a category name without inventing money and rejects transaction output",()=>{
    const value={transcript:"Sport toifasini qo‘sh",entries:[],clarification:null,categoryName:"Sport"};
    expect(validateVoiceDraft(value,categoryInput,[])).toEqual(value);
    expect(validateVoiceDraft({...value,entries:draft().entries},categoryInput,categories)).toBeNull();
    expect(validateVoiceDraft({...value,categoryName:"x".repeat(81)},categoryInput,[])).toBeNull();
    expect(validateVoiceDraft({...value,categoryName:"sport\u0000"},categoryInput,[])).toBeNull();
    expect(validateVoiceDraft({...value,categoryName:null,clarification:"Nomni yana ayting"},categoryInput,[])).not.toBeNull();
    expect(validateVoiceDraft(value,input,categories)).toBeNull();
  });
  it("uses the same bounded provider with a category-only schema and no financial actions",async()=>{
    const value={transcript:"Sport",entries:[],clarification:null,categoryName:"Sport"};
    const fetcher=vi.fn<typeof fetch>(async()=>Response.json({usage:{cost:0.001},choices:[{finish_reason:"stop",message:{content:JSON.stringify(value)}}]}));
    expect((await inferVoice(categoryInput,categories,"synthetic-key",new AbortController().signal,fetcher)).draft).toEqual(value);
    const spec=JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(spec.response_format.json_schema.schema.properties.entries.maxItems).toBe(0);
    expect(spec.response_format.json_schema.schema.required).toContain("categoryName");
    expect(spec.messages[0].content).not.toContain(categories[0].id);
    expect(spec.provider).toMatchObject({data_collection:"deny",zdr:true,allow_fallbacks:false});
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
