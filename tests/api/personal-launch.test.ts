import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { readFileSync } from "node:fs";
import manifest from "@/app/manifest";
import { viewport, metadata } from "@/app/layout";
import { proxy } from "@/proxy";
import { voiceFailureMessage } from "@/components/personal/voice-entry";

afterEach(()=>vi.unstubAllEnvs());
describe("personal Home Screen launch",()=>{
 it("launches the personal wallet with existing-session protection",()=>{
  vi.stubEnv("CREDITBOOK_NEON_ENABLED","1");expect(manifest().start_url).toBe("/personal");
  expect(proxy(new NextRequest("https://fixture.test/personal")).headers.get("x-middleware-next")).toBe("1");
  const response=proxy(new NextRequest("https://fixture.test/dashboard?old=1"));
  expect(response.status).toBe(307);expect(response.headers.get("location")).toBe("https://fixture.test/personal");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
 });
 it("preserves legacy-shop routing and refuses unrelated personal-release routes",()=>{
  vi.stubEnv("CREDITBOOK_NEON_ENABLED","0");expect(manifest().start_url).toBe("/dashboard");
  expect(proxy(new NextRequest("https://fixture.test/dashboard")).headers.get("x-middleware-next")).toBe("1");
  vi.stubEnv("CREDITBOOK_NEON_ENABLED","1");
  for(const path of ["/admin","/shops","/qa/mobile-a","/dashboard"]){expect(proxy(new NextRequest("https://fixture.test"+path,{method:path==="/dashboard"?"POST":"GET"})).status).toBe(404);}
 });
 it("ships real PNG icons with declared dimensions including Apple touch",()=>{
  expect(manifest().icons?.map(i=>i.src)).toEqual(["/icons/icon-192.png","/icons/icon-512.png"]);
  for(const [file,size] of [["icon-192.png",192],["icon-512.png",512],["apple-touch-icon.png",180]] as const){const b=readFileSync("public/icons/"+file);expect(b.subarray(1,4).toString()).toBe("PNG");expect(b.readUInt32BE(16)).toBe(size);expect(b.readUInt32BE(20)).toBe(size);}
  expect(metadata.icons).toHaveProperty("apple","/icons/apple-touch-icon.png");
 });
 it("does not prevent accessible pinch zoom",()=>{expect(viewport.maximumScale).toBeUndefined();expect(viewport.userScalable).not.toBe(false);});
});
describe("actionable private AI failures",()=>{
 it.each(["AI_PROVIDER_AUTH","AI_NOT_CONFIGURED"])("explains provider credential failure %s without logging out the user",code=>{expect(voiceFailureMessage(code)).toContain("kaliti");expect(voiceFailureMessage(code)).toContain("Qo‘lda");});
 it.each(["AI_PROVIDER_BUDGET","AI_BUDGET_EXHAUSTED"])("explains exhausted provider/application allowance %s",code=>{expect(voiceFailureMessage(code)).toContain("limit");});
 it("distinguishes unavailability and invalid output without exposing an arbitrary provider message",()=>{expect(voiceFailureMessage("AI_UNAVAILABLE")).toContain("ulanib");expect(voiceFailureMessage("AI_INVALID_OUTPUT")).toContain("ishonchli emas");expect(voiceFailureMessage({token:"private-value"})).not.toContain("private-value");});
});
