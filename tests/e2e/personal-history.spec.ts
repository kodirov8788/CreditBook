import {expect,test,devices} from "@playwright/test";
// A local-only temporary page renders the real card with synthetic props. The
// runner creates/removes it; no Auth, cloud database or production keys are used.
test.use({...devices["iPhone 13"],defaultBrowserType:"chromium",channel:"chrome"});
test.skip(!process.env.PERSONAL_CARD_FIXTURE_URL,"Requires scripts/test-personal-history-ui.sh local fixture runner.");
const posting=(n:number)=>({id:`post-${n}`,kind:"opening",amount_minor:String(n*100),effective_date:"2026-10-18"});

test("history pages preserve rows, reject duplicate clicks, retry failure and retain keyboard focus",async({page},info)=>{
 let first=0,next=0;let release:()=>void=()=>{};
 const blocked=new Promise<void>(resolve=>{release=resolve;});
 await page.route("**/postings*",async route=>{
  if(!route.request().url().includes("cursor=")){
   first++;await blocked;
   await route.fulfill({json:{postings:Array.from({length:50},(_,n)=>posting(n)),nextCursor:"second"}});return;
  }
  next++;if(next===1){await route.fulfill({status:503,json:{error:"Tarix olinmadi."}});return;}
  // Duplicate boundary records must not duplicate list entries.
  await route.fulfill({json:{postings:[posting(49),posting(50)],nextCursor:null}});
 });
 await page.goto(process.env.PERSONAL_CARD_FIXTURE_URL!);
 const trigger=page.getByRole("button",{name:"Naqd: tarix",exact:true});
 await trigger.press("Enter");await trigger.press("Enter");
 const region=page.getByRole("region",{name:"Naqd tarixi"});
 await expect(region).toHaveAttribute("aria-busy","true");
 await expect(trigger).toHaveAttribute("aria-expanded","true");
 expect(first).toBe(1);release();await expect(region.getByRole("listitem")).toHaveCount(50);
 const more=region.getByRole("button",{name:"Yana",exact:true});
 await more.press("Enter");await expect(page.locator("article").getByRole("alert")).toHaveText("Tarix olinmadi.");
 await expect(more).toBeFocused();await expect(region.getByRole("listitem")).toHaveCount(50);
 await more.press("Enter");await expect(region.getByRole("listitem")).toHaveCount(51);
 await expect(region).toBeFocused();await expect(more).toHaveCount(0);
 await region.getByRole("button",{name:"Yopish",exact:true}).press("Enter");
 await expect(trigger).toBeFocused();await expect(trigger).toHaveAttribute("aria-expanded","false");
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await trigger.press("Enter");await expect(region.getByRole("listitem")).toHaveCount(50);expect(first).toBe(2);
 await page.screenshot({path:info.outputPath("history-mobile.png"),fullPage:true});
});

test("closing and reopening ignores a stale in-flight response",async({page})=>{
 let count=0;let release:()=>void=()=>{};const blocked=new Promise<void>(resolve=>{release=resolve;});
 await page.route("**/postings*",async route=>{
  const n=++count;if(n===1)await blocked;
  await route.fulfill({json:{postings:[posting(n)],nextCursor:null}});
 });
 await page.goto(process.env.PERSONAL_CARD_FIXTURE_URL!);
 const trigger=page.getByRole("button",{name:"Naqd: tarix",exact:true}),region=page.getByRole("region",{name:"Naqd tarixi"});
 await trigger.click();await expect(region).toHaveAttribute("aria-busy","true");
 await region.getByRole("button",{name:"Yopish",exact:true}).click();await expect(trigger).toBeFocused();
 await trigger.click();await expect(region).toContainText("2 UZS");
 const response=page.waitForResponse(r=>r.url().includes("/postings"));release();await response;
 await expect(region.getByRole("listitem")).toHaveCount(1);await expect(region).toContainText("2 UZS");
});
