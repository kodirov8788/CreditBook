import {beforeEach,describe,expect,it,vi} from "vitest";
import {GET} from "@/app/api/personal/accounts/[id]/postings/route";
import {getAuthenticatedClient} from "@/lib/api/auth";
import {decodeHistoryCursor,encodeHistoryCursor} from "@/lib/personal-finance/history-cursor";
vi.mock("@/lib/api/auth",()=>({getAuthenticatedClient:vi.fn()}));
const auth=vi.mocked(getAuthenticatedClient);
const id="11111111-1111-4111-8111-111111111111", context={params:Promise.resolve({id})};
const rowId=(n:number)=>`22222222-2222-4222-8222-${String(n).padStart(12,"0")}`;
const recordedAt="2026-10-18T06:00:00.123456+00:00";
function client(rows:unknown[]){
 const account={select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),maybeSingle:vi.fn().mockResolvedValue({data:{id,currency_code:"UZS",scale:2},error:null})};
 const history={select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),order:vi.fn().mockReturnThis(),or:vi.fn().mockReturnThis(),range:vi.fn().mockResolvedValue({data:rows,error:null})};
 const from=vi.fn().mockReturnValueOnce(account).mockReturnValueOnce(history);
 auth.mockResolvedValue({supabase:{from} as never,user:{id:"owner"} as never});return{from,account,history};
}
describe("bounded keyset history",()=>{
 beforeEach(()=>auth.mockReset());
 it("returns fifty exact rows and a position preserving microseconds",async()=>{
  const c=client(Array.from({length:51},(_,n)=>({id:rowId(100-n),kind:"opening",amount_minor:100,recorded_at:recordedAt,effective_date:"2026-10-18"})));
  const response=await GET(new Request("http://localhost/history"),context),body=await response.json();
  expect(body.postings).toHaveLength(50);expect(body.postings[0].amount_minor).toBe("100");
  expect(decodeHistoryCursor(body.nextCursor,id)).toEqual({accountId:id,id:rowId(51),recordedAt});
  expect(c.history.order).toHaveBeenCalledWith("recorded_at",{ascending:false});expect(c.history.order).toHaveBeenCalledWith("id",{ascending:false});
  expect(c.history.range).toHaveBeenCalledWith(0,50);
 });
 it("bounds the next page by timestamp and UUID, avoiding offset shifts from new insertions",async()=>{
  const c=client([]),cursor=encodeHistoryCursor({accountId:id,id:rowId(51),recordedAt});
  const response=await GET(new Request("http://localhost/history?cursor="+cursor),context);
  expect(c.history.or).toHaveBeenCalledWith(`recorded_at.lt.${recordedAt},and(recorded_at.eq.${recordedAt},id.lt.${rowId(51)})`);
  expect((await response.json()).nextCursor).toBeNull();
 });
 it.each(["", "not-json", "!bad", Buffer.from('{"id":"filter,injection"}').toString("base64url")])("rejects malformed cursor %s before data access",async raw=>{
  const c=client([]);expect((await GET(new Request("http://localhost/history?cursor="+raw),context)).status).toBe(400);expect(c.from).not.toHaveBeenCalled();
 });
 it("rejects a cursor scoped to another account",async()=>{
  const c=client([]),cursor=encodeHistoryCursor({accountId:rowId(1),id:rowId(51),recordedAt});
  expect((await GET(new Request("http://localhost/history?cursor="+cursor),context)).status).toBe(400);expect(c.from).not.toHaveBeenCalled();
 });
 it.each(["0000-01-01T00:00:00Z","2026-02-30T00:00:00Z","2026-10-18T24:00:00Z","2026-10-18T06:00:00Z),id.gt.0"])("rejects invalid or filter-unsafe time %s",time=>{
  const raw=Buffer.from(JSON.stringify({accountId:id,id:rowId(1),recordedAt:time})).toString("base64url");expect(()=>decodeHistoryCursor(raw,id)).toThrow();
 });
 it("fails closed on unsafe posting precision",async()=>{
  client([{id:rowId(1),amount_minor:9007199254740992}]);expect((await GET(new Request("http://localhost/history"),context)).status).toBe(500);
 });
});
vi.mock("@/lib/api/personal-access", () => ({ getPersonalAccess: vi.fn().mockResolvedValue("allowed") }));
