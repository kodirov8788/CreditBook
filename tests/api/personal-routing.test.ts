import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDashboardData } from "@/lib/dashboard-data";
import { createClient } from "@/lib/supabase/server";
vi.mock("@/lib/supabase/server", () => ({createClient:vi.fn()}));
vi.mock("next/navigation", () => ({redirect:(to:string)=>{throw new Error("redirect:"+to);}}));
const create=vi.mocked(createClient);
describe("personal fallback",()=>{
  beforeEach(()=>create.mockReset());
  it.each([null, undefined])("routes no-shop users: %s",async data=>{
    create.mockResolvedValue({auth:{getUser:async()=>({data:{user:{id:"owner"}}})},rpc:async()=>({data,error:null})} as never);
    await expect(getDashboardData({personalFallback:true})).rejects.toThrow("redirect:/personal");
  });
  it("does not disguise RPC failure as onboarding",async()=>{
    create.mockResolvedValue({auth:{getUser:async()=>({data:{user:{id:"owner"}}})},rpc:async()=>({data:null,error:{code:"XX000"}})} as never);
    expect((await getDashboardData({personalFallback:true})).initialError).toContain("Faol do'kon");
  });
  it("preserves explicit shop route behavior",async()=>{
    create.mockResolvedValue({auth:{getUser:async()=>({data:{user:{id:"owner"}}})},rpc:async()=>({data:null,error:null})} as never);
    expect((await getDashboardData()).liveMode).toBe(true);
  });
  it("requires login before routing",async()=>{
    create.mockResolvedValue({auth:{getUser:async()=>({data:{user:null}})}} as never);
    await expect(getDashboardData({personalFallback:true})).rejects.toThrow("redirect:/login");
  });
  it("keeps an active shop owner at the existing dashboard without personal provisioning",async()=>{
    const rpc=vi.fn((name:string)=> name === "shop_dashboard_page" ? {abortSignal: async () => ({data: {shopId: "active-shop", summary: [], nextCursor: null, totals: {customers: 0, active: 0, outstanding: 0, overdue: 0, collectedThisMonth: 0}}, error: null})} : Promise.resolve({data:name==="get_current_shop_id"?"active-shop":true,error:null}));
    const from=vi.fn((table:string)=>{
      if(table==="profiles"||table==="shops")return {select:()=>({eq:()=>({maybeSingle:async()=>({data:table==="shops"?{name:"Existing shop"}:{shop_name:"Profile shop"},error:null})})})};
      if(table==="customers")return {select:()=>({eq:()=>({order:async()=>({data:[],error:null})})})};
      return {select:()=>({eq:()=>({order:()=>({limit:async()=>({data:[],error:null})})})})};
    });
    create.mockResolvedValue({auth:{getUser:async()=>({data:{user:{id:"owner",email:"owner@fixture.test"}}})},rpc,from} as never);
    const result=await getDashboardData({personalFallback:true});
    expect(result.shopName).toBe("Existing shop");expect(result.canManageMembers).toBe(true);
    expect(rpc.mock.calls.map(([name])=>name)).toEqual(["get_current_shop_id","shop_dashboard_page","has_shop_permission"]);
    expect(from).not.toHaveBeenCalledWith("customers");
  });
});
