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
});
