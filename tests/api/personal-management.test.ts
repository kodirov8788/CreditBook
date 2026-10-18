import {beforeEach,describe,expect,it,vi} from "vitest";
import {PATCH} from "@/app/api/personal/accounts/[id]/route";
import {GET} from "@/app/api/personal/accounts/[id]/postings/route";
import {getAuthenticatedClient} from "@/lib/api/auth";
vi.mock("@/lib/api/auth",()=>({getAuthenticatedClient:vi.fn()}));
const auth=vi.mocked(getAuthenticatedClient),rpc=vi.fn(),from=vi.fn();
const id="11111111-1111-4111-8111-111111111111",clientKey="22222222-2222-4222-8222-222222222222";
const context={params:Promise.resolve({id})};
const req=(command:unknown)=>new Request("http://localhost/api/personal/accounts/"+id,{method:"PATCH",body:JSON.stringify({clientKey,command})});
describe("account management and statements",()=>{
 beforeEach(()=>{vi.clearAllMocks();auth.mockResolvedValue({supabase:{rpc,from} as never,user:{id:"owner"} as never});});
 it("requires authentication for mutations and history",async()=>{
  auth.mockResolvedValue({supabase:null,user:null});
  expect((await PATCH(req({}),context)).status).toBe(401);expect((await GET(new Request("http://localhost/history"),context)).status).toBe(401);
 });
 it("pins account identity to validated path",async()=>{
  rpc.mockResolvedValue({data:{accountId:id},error:null});
  const command={operation:"archive",accountVersion:1,preferencesVersion:2};
  expect((await PATCH(req(command),context)).status).toBe(200);
  expect(rpc).toHaveBeenCalledWith("manage_personal_account",{p_command:{...command,accountId:id},p_client_key:clientKey});
  expect((await PATCH(req({...command,accountId:"foreign"}),context)).status).toBe(400);
 });
 it.each(["------------------------------------","123","111111111111111111111111111111111111"])("rejects invalid path %s without querying",async bad=>{
  const c={params:Promise.resolve({id:bad})};
  expect((await PATCH(req({}),c)).status).toBe(400);expect((await GET(new Request("http://localhost/history"),c)).status).toBe(400);
  expect(rpc).not.toHaveBeenCalled();expect(from).not.toHaveBeenCalled();
 });
 it.each([["23505",409],["42501",403],["22023",400],["XX000",500]])("maps command failure %s",async(code,status)=>{
  rpc.mockResolvedValue({data:null,error:{code,message:"privateSQL"}});
  const response=await PATCH(req({operation:"archive"}),context);expect(response.status).toBe(status);expect(await response.text()).not.toContain("privateSQL");
 });
 it("does not expose an inaccessible account's history",async()=>{
  const maybeSingle=vi.fn().mockResolvedValue({data:null,error:null});const query={select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),maybeSingle};from.mockReturnValue(query);
  expect((await GET(new Request("http://localhost/history"),context)).status).toBe(404);expect(from).toHaveBeenCalledTimes(1);
 });
 it("returns bounded string money history under the account RLS query",async()=>{
  const account={select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),maybeSingle:vi.fn().mockResolvedValue({data:{id,currency_code:"UZS",scale:2},error:null})};
  const history={select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),order:vi.fn().mockReturnThis(),range:vi.fn().mockResolvedValue({data:[{id:"opening",kind:"opening",amount_minor:100000000000000,effective_date:"2026-01-01"}],error:null})};
  from.mockReturnValueOnce(account).mockReturnValueOnce(history);
  const response=await GET(new Request("http://localhost/history"),context);
  expect((await response.json()).postings[0].amount_minor).toBe("100000000000000");expect(history.eq).toHaveBeenCalledWith("account_id",id);
 });
});
