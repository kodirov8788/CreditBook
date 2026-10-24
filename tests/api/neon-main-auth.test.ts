import { afterEach, describe, expect, it, vi } from "vitest";
import { createMainAuthHandler, handleMainAuth, type MainAuth } from "@/lib/auth/server";
import { readLocalNeonConfig, type LocalNeonConfig } from "@/lib/auth/local-config";
import { isAuthIdentity } from "@/lib/auth/identity";
import { cookies, headers } from "next/headers";

vi.mock("next/headers", () => ({ cookies: vi.fn(), headers: vi.fn() }));
const a = { id: "11111111-1111-4111-8111-111111111111", email: "a@example.invalid" };
const b = { id: "22222222-2222-4222-8222-222222222222", email: "b@example.invalid" };
const config: LocalNeonConfig = { origin: "http://localhost:4181", baseUrl: "https://ep-qa.neonauth.aws.neon.tech/neondb/auth",
  cookieSecret: "synthetic-only-secret-".repeat(3), identities: [a, b] };
const live = (user = a) => ({ data: { user: { ...user, privateMetadata: "never-public" },
  session: { id: "synthetic-session", token: "never-public", userId: user.id, expiresAt: new Date(Date.now() + 3600000).toISOString() } }, error: null });
function fixture() {
  const auth: MainAuth = { login: vi.fn(async () => live()), session: vi.fn(async () => live()), logout: vi.fn(async () => ({ data: { token: "never-public" }, error: null })) };
  const factory = vi.fn(() => auth);
  return { auth, factory, handle: createMainAuthHandler(config, factory) };
}
function request(path = "/api/session", options: { method?: string; body?: unknown; headers?: Record<string, string | undefined> } = {}) {
  const method = options.method ?? "GET";
  const requestHeaders = new Headers({ Host: "localhost:4181", ...(method === "POST" ? { Origin: config.origin, "Content-Type": "application/json" } : {}) });
  for (const [key,value] of Object.entries(options.headers ?? {})) if (value !== undefined) requestHeaders.set(key,value);
  return new Request(config.origin + path, { method,
    headers: requestHeaders,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}) });
}
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("main app Neon LOCAL opt-in", () => {
  it("stays off without explicit server opt-in", async () => {
    expect(readLocalNeonConfig({ NEXT_PUBLIC_CREDITBOOK_NEON_AUTH_LOCAL: "1" })).toBeNull();
    vi.stubEnv("CREDITBOOK_NEON_AUTH_LOCAL", "");
    expect((await handleMainAuth(request(), "session")).status).toBe(404);
  });
  it.each([{ NODE_ENV: "production" }, { VERCEL: "1" }, { NEXT_PUBLIC_CREDITBOOK_NEON_AUTH_LOCAL: "" }])("cannot activate in hosted or mismatched mode %j", patch => {
    expect(() => readLocalNeonConfig({ CREDITBOOK_NEON_AUTH_LOCAL: "1", NEXT_PUBLIC_CREDITBOOK_NEON_AUTH_LOCAL: "1", ...patch })).toThrow();
  });
  it.each(["http://127.0.0.1:4181", "http://localhost", "https://localhost:4181", "http://localhost:4181/", "http://localhost.evil.invalid:4181"])("rejects noncanonical origin %s", origin => {
    expect(() => readLocalNeonConfig({ CREDITBOOK_NEON_AUTH_LOCAL: "1", NEXT_PUBLIC_CREDITBOOK_NEON_AUTH_LOCAL: "1", CREDITBOOK_NEON_AUTH_ORIGIN: origin })).toThrow();
  });
  it("does not accept arbitrary UUID/email enrollment", () => {
    expect(() => readLocalNeonConfig({ CREDITBOOK_NEON_AUTH_LOCAL: "1", NEXT_PUBLIC_CREDITBOOK_NEON_AUTH_LOCAL: "1", CREDITBOOK_NEON_AUTH_ORIGIN: config.origin,
      NEON_AUTH_BASE_URL: "https://ep-long-cherry-b4u07ix0.neonauth.c-6.us-east-2.aws.neon.tech/neondb/auth", NEON_AUTH_COOKIE_SECRET: config.cookieSecret,
      CREDITBOOK_QA_EMAILS: [a.email,b.email].join(","), CREDITBOOK_QA_USER_IDS: [a.id,b.id].join(",") })).toThrow(/reviewed/);
  });
});

describe("main app Neon Auth protocol (mocked Auth, no DB)", () => {
  it("returns only the approved minimal identity with private responses", async () => {
    const f = fixture(); const response = await f.handle(request(), "session");
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ ok: true, user: a });
    expect(f.factory).toHaveBeenCalledOnce();
  });
  it.each([null, { user: a }, { user: a, session: null }, { user: a, session: { userId: b.id, expiresAt: new Date(Date.now()+10000) } },
    { user: a, session: { userId: a.id, expiresAt: "2000-01-01" } }, { user: a, session: { userId: a.id, expiresAt: "invalid" } }])("rejects missing/invalid/expired authority %j", async data => {
    const f = fixture(); vi.mocked(f.auth.session).mockResolvedValue({ data, error: null });
    expect((await f.handle(request(), "session")).status).toBe(401);
  });
  it("does not authorize an unknown user or mismatched email/UUID pair", async () => {
    for (const user of [{ ...a, email: b.email }, { ...a, id: "33333333-3333-4333-8333-333333333333" }]) {
      const f = fixture(); vi.mocked(f.auth.session).mockResolvedValue(live(user));
      expect((await f.handle(request(), "session")).status).toBe(403);
    }
  });
  it("rejects stale A intent under B without logging B out", async () => {
    const f = fixture(); vi.mocked(f.auth.session).mockResolvedValue(live(b));
    const response = await f.handle(request("/api/auth/sign-out", { method: "POST", body: {}, headers: { "X-CreditBook-Owner": a.id } }), "logout");
    expect(response.status).toBe(409); expect(f.auth.logout).not.toHaveBeenCalled();
    expect((await f.handle(request("/api/session", { headers: { "X-CreditBook-Owner": a.id } }), "session")).status).toBe(409);
  });
  it("keeps concurrent request identities separate", async () => {
    const fa = fixture(), fb = fixture(); vi.mocked(fb.auth.session).mockResolvedValue(live(b));
    const responses = await Promise.all([fa.handle(request(), "session"),fb.handle(request(), "session")]);
    expect(await Promise.all(responses.map(response=>response.json()))).toEqual([{ok:true,user:a},{ok:true,user:b}]);
  });
  it.each([{ status: 401 }, { code: "SESSION_EXPIRED" }, { status: 503 }, { code: "NETWORK_TIMEOUT" }])("fails closed on provider errors %j", async error => {
    const f = fixture(); vi.mocked(f.auth.session).mockResolvedValue({ ...live(), error });
    expect((await f.handle(request(), "session")).status).toBe(error.status === 401 || error.code === "SESSION_EXPIRED" ? 401 : 503);
  });
  it.each([{ Host: "127.0.0.1:4181" }, { Host: "localhost:4182", "X-Forwarded-Host": "localhost:4181" },
    { Origin: "https://evil.invalid" }, { "Sec-Fetch-Site": "cross-site" }, { Authorization: "Bearer synthetic" }])("rejects transport confusion before Auth %j", async headers => {
    const f = fixture(); const response = await f.handle(request("/api/session", { headers }), "session");
    expect([401,403]).toContain(response.status); expect(f.factory).not.toHaveBeenCalled();
  });
  it.each([{ body: [] }, { body: { extra: true } }, { body: { email: a.email } }, { body: { email: a.email, password: "x", callbackURL: "https://evil.invalid" } },
    { body: { email: a.email, password: "x" }, headers: { Origin: "" } }, { body: {}, headers: { "Content-Type": "text/plain" } }])("rejects malformed POST before Auth %j", async options => {
    const f = fixture(); const response = await f.handle(request("/api/auth/sign-in/email", { method:"POST", ...options }), "login");
    expect([400,403,415]).toContain(response.status); expect(f.factory).not.toHaveBeenCalled();
  });
  it("bounds actual body bytes and rejects malformed JSON", async () => {
    for (const body of ["{", JSON.stringify({ email: a.email, password: "x".repeat(10000) })]) {
      const f = fixture();
      const response = await f.handle(new Request(config.origin+"/api/auth/sign-in/email", { method:"POST", headers:{Host:"localhost:4181",Origin:config.origin,"Content-Type":"application/json"},body }),"login");
      expect(response.status).toBe(400); expect(f.factory).not.toHaveBeenCalled();
    }
  });
  it("never sends another email's password upstream", async () => {
    const f = fixture(); expect((await f.handle(request("/api/auth/sign-in/email", {method:"POST",body:{email:"outside@example.invalid",password:"synthetic-only"}}),"login")).status).toBe(401);
    expect(f.factory).not.toHaveBeenCalled();
  });
  it("keeps login response token-free and requires exact requested identity", async () => {
    const f = fixture(); const req = () => request("/api/auth/sign-in/email", {method:"POST",body:{email:a.email,password:"synthetic-only"}});
    const response = await f.handle(req(),"login");
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ok:true,user:a});
    vi.mocked(f.auth.login).mockResolvedValue(live(b));
    expect((await f.handle(req(),"login")).status).toBe(403);
  });
  it("requires matching intent for logout and does not expose upstream data", async () => {
    const f = fixture();
    expect((await f.handle(request("/api/auth/sign-out", {method:"POST",body:{}}),"logout")).status).toBe(409);
    const response=await f.handle(request("/api/auth/sign-out", {method:"POST",body:{},headers:{"X-CreditBook-Owner":a.id}}),"logout");
    expect(response.status).toBe(200);expect(await response.json()).toEqual({ok:true});
    vi.mocked(f.auth.session).mockResolvedValue({data:null,error:null});
    expect((await f.handle(request(),"session")).status).toBe(401);
  });
  it("scrubs unexpected errors", async () => {
    const f=fixture(); vi.mocked(f.auth.session).mockRejectedValue(new Error("synthetic-private-provider-detail"));
    const response=await f.handle(request(),"session");expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("synthetic-private");
  });
  it("bounds stalled provider calls and keeps capacity occupied until they settle",async()=>{
    vi.useFakeTimers();
    const f=fixture();const settle:((result:Awaited<ReturnType<MainAuth["session"]>>)=>void)[]=[];
    vi.mocked(f.auth.session).mockImplementation(()=>new Promise(resolve=>settle.push(resolve)));
    const pending=[0,1,2,3].map(()=>f.handle(request(),"session"));
    expect((await f.handle(request(),"session")).status).toBe(503);
    await vi.advanceTimersByTimeAsync(15000);
    expect((await Promise.all(pending)).every(response=>response.status===503)).toBe(true);
    expect((await f.handle(request(),"session")).status).toBe(503);
    for(const resolve of settle)resolve(live());
    await vi.advanceTimersByTimeAsync(0);
    vi.mocked(f.auth.session).mockResolvedValue(live());
    expect((await f.handle(request(),"session")).status).toBe(200);
  });
  it("partitions login limits by approved email while retaining the global pressure cap",async()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date("2040-01-01T00:00:00Z"));
    const f=fixture();vi.mocked(f.auth.login).mockResolvedValue({data:null,error:{status:401}});
    const login=(email:string)=>f.handle(request("/api/auth/sign-in/email",{method:"POST",body:{email,password:"synthetic-only"}}),"login");
    for(let index=0;index<8;index++)expect((await login(a.email)).status).toBe(401);
    expect((await login(a.email)).status).toBe(429);
    expect((await login(b.email)).status).toBe(401);
    expect(f.auth.login).toHaveBeenCalledTimes(9);
    await vi.advanceTimersByTimeAsync(60001);
    expect((await login(a.email)).status).toBe(401);
  });
});

describe("public identity DTO validation",()=>{
  it.each([null,[],{}, {id:a.id,email:1}, {id:"bad",email:a.email}])("rejects malformed identity %j",value=>expect(isAuthIdentity(value)).toBe(false));
});

describe("installed Next SDK boundary (stubbed upstream, no real cookies)",()=>{
  it("does not cache A and B sessions, always sends disableCookieCache=true",async()=>{
    // Supply only synthetic next/headers and test the real pinned SDK through
    // the exported entry. The exact approved roster is NOT configured here.
    expect(typeof cookies).toBe("function");expect(typeof headers).toBe("function");
    const {createNeonAuth}=await import("@neondatabase/auth/next/server");
    const seen:string[]=[];
    vi.mocked(cookies).mockResolvedValue({set:vi.fn()} as unknown as Awaited<ReturnType<typeof cookies>>);
    vi.stubGlobal("fetch",vi.fn(async(url: string|URL|Request,init?:RequestInit)=>{
      seen.push(String(url));const cookie=new Headers(init?.headers).get("cookie");
      return Response.json(live(cookie?.includes("synthetic-a")?a:b).data);
    }));
    const auth=createNeonAuth({baseUrl:config.baseUrl,cookies:{secret:config.cookieSecret,sessionDataTtl:300},logLevel:"silent"});
    const subjects=[];
    for(const value of ["synthetic-a","synthetic-b","synthetic-a"]){
      vi.mocked(headers).mockResolvedValue(new Headers({cookie:`__Secure-neon-auth.session_token=${value}`,origin:config.origin}) as Awaited<ReturnType<typeof headers>>);
      const result=await auth.getSession({query:{disableCookieCache:"true"}});subjects.push(result.data?.user.id);
    }
    expect(subjects).toEqual([a.id,b.id,a.id]);expect(seen).toHaveLength(3);
    expect(seen.every(url=>new URL(url).searchParams.get("disableCookieCache")==="true")).toBe(true);
  });
});
