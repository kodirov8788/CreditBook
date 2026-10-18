import { expect, test, devices } from "@playwright/test";
test.use({ ...devices["iPhone 13"], defaultBrowserType: "chromium", channel: "chrome", storageState: process.env.CREDITBOOK_AUTH_STATE });
test.skip(!process.env.CREDITBOOK_AUTH_STATE, "Requires an explicitly prepared synthetic Auth session; API outcomes are fixtures.");

test("mobile exact opening and lost-response recovery survives reload", async ({ page }, testInfo) => {
  const accounts: Record<string, unknown>[] = [];
  const commands = new Map<string, { accountId: string; replayed: boolean }>();
  let drop = true;
  await page.route(/\/api\/personal\/accounts(?:\/|\?|$)/, async route => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { accounts, totals: accounts.length ? [{currencyCode:"UZS",scale:2,includedMinor:"10000001",archivedMinor:"0"}] : [], preferences: accounts.length ? {defaultAccountId:"fixture-1",timeZone:"UTC",version:2} : null,nextOffset:null } }); return;
    }
    const body=route.request().postDataJSON();
    expect(body.command.openingAmountMinor).toBe("10000001");
    if (!commands.has(body.clientKey)) {
      accounts.push({id:"fixture-1",name:body.command.name,icon:"wallet",color:"#18794E",currencyCode:"UZS",scale:2,status:"active",includeInTotal:true,version:1,balanceMinor:body.command.openingAmountMinor});
      commands.set(body.clientKey,{accountId:"fixture-1",replayed:false});
    }
    if(drop){drop=false;await route.abort("failed");return;}
    await route.fulfill({status:200,json:{...commands.get(body.clientKey),replayed:true}});
  });
  await page.goto("/");
  await expect(page).toHaveURL(/\/personal$/);
  await expect(page.getByRole("heading",{name:"Hisoblar",exact:true})).toBeVisible();
  await page.getByRole("button",{name:"+ Hisob",exact:true}).click();
  await page.getByLabel("Nom",{exact:true}).fill("Sinov Naqd");
  await page.getByLabel("Boshlang‘ich qoldiq",{exact:true}).fill("100000.01");
  await page.getByRole("button",{name:"Saqlash",exact:true}).click();
  await expect(page.getByRole("button",{name:"Qayta urinish",exact:true})).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button",{name:"Qayta urinish",exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:"+ Hisob",exact:true})).toBeDisabled();
  await page.getByRole("button",{name:"Qayta urinish",exact:true}).click();
  await expect(page.getByRole("status")).toContainText("Hisob ochildi.");
  expect(commands.size).toBe(1); expect(accounts).toHaveLength(1);
  await expect(page.locator("article")).toHaveCount(1);
  await expect(page.locator("article")).toContainText("100 000.01");
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath("personal-mobile.png"),fullPage:true});
});

test("journal restores even if initial workspace request fails", async ({ page }) => {
  await page.goto("/personal");
  // Write through a real uncertain submission, so the component owns the
  // user-scoped journal rather than the test guessing an Auth identifier.
  await page.route(/\/api\/personal\/accounts(?:\/|\?|$)/,async route=>{
    if(route.request().method()==="GET")await route.fulfill({json:{accounts:[],totals:[],preferences:null,nextOffset:null}});
    else await route.abort("failed");
  });
  await page.reload();
  await page.getByRole("button",{name:"+ Hisob",exact:true}).click();
  await page.getByLabel("Nom",{exact:true}).fill("Sinov retry");
  await page.getByRole("button",{name:"Saqlash",exact:true}).click();
  await expect(page.getByRole("button",{name:"Qayta urinish",exact:true})).toBeVisible();
  await page.route("**/api/personal/workspace",route=>route.abort("failed"));
  await page.reload();
  await expect(page.getByRole("button",{name:"Qayta urinish",exact:true})).toBeVisible();
  await expect(page.getByLabel("Nom",{exact:true})).toBeDisabled();
});

test("mobile account management preserves money and exposes opening history",async({page})=>{
 const id="11111111-1111-4111-8111-111111111111";
 const account={id,name:"Naqd",icon:"cash",color:"#18794E",currencyCode:"UZS",scale:2,status:"active",includeInTotal:true,version:1,balanceMinor:"10000000"};
 let prefVersion=2;
 await page.route(/\/api\/personal\/accounts(?:\/|\?|$)/,async route=>{
  if(route.request().method()==="GET"){
   if(route.request().url().includes("/postings")){await route.fulfill({json:{postings:[{id:"opening",kind:"opening",amount_minor:"10000000",effective_date:"2026-01-01"}],nextOffset:null}});return;}
   await route.fulfill({json:{accounts:[account],totals:[{currencyCode:"UZS",scale:2,includedMinor:account.status==="active"&&account.includeInTotal?"10000000":"0",archivedMinor:account.status==="archived"?"10000000":"0"}],preferences:{defaultAccountId:account.status==="active"?id:null,timeZone:"UTC",version:prefVersion},nextOffset:null}});return;
  }
  const body=route.request().postDataJSON();expect(body.command.accountVersion).toBe(account.version);expect(body.command.preferencesVersion).toBe(prefVersion);
  if(body.command.operation==="update"){account.name=body.command.name;account.includeInTotal=body.command.includeInTotal;}
  if(body.command.operation==="archive"){account.status="archived";prefVersion++;}
  if(body.command.operation==="unarchive"){account.status="active";prefVersion++;}
  account.version++;await route.fulfill({json:{accountId:id,replayed:false}});
 });
 await page.goto("/personal");const card=page.locator("article");
 await card.getByText("Boshqarish",{exact:true}).click();
 await card.getByLabel("Hisob nomi").fill("Karta");await card.getByLabel("Jamiga qo‘shish").uncheck();
 await card.getByRole("button",{name:"Saqlash",exact:true}).click();
 await expect(card.getByRole("heading",{name:"Karta"})).toBeVisible();await expect(card).toContainText("100 000");
 await card.getByRole("button",{name:"Arxivlash",exact:true}).click();
 await expect(card.getByRole("button",{name:"Arxivdan olish",exact:true})).toBeVisible();
 await card.getByRole("button",{name:"Arxivdan olish",exact:true}).click();
 await expect(card.getByRole("button",{name:"Arxivlash",exact:true})).toBeVisible();
 await card.getByRole("button",{name:"Tarix",exact:true}).click();await expect(card.getByRole("region",{name:"Karta tarixi"})).toContainText("Boshlang‘ich");
 expect(account.balanceMinor).toBe("10000000");
});

test("restored rejected creation keeps major units when corrected",async({page})=>{
 let attempts=0;
 await page.route(/\/api\/personal\/accounts(?:\/|\?|$)/,async route=>{
  if(route.request().method()==="GET"){await route.fulfill({json:{accounts:[],totals:[],preferences:null,nextOffset:null}});return;}
  attempts++;expect(route.request().postDataJSON().command.openingAmountMinor).toBe("10000");
  if(attempts===1){await route.abort("failed");return;}
  if(attempts===2){await route.fulfill({status:400,json:{code:"22023",error:"Nomni tekshiring."}});return;}
  await route.fulfill({status:201,json:{accountId:"created",replayed:false}});
 });
 await page.goto("/personal");await page.getByRole("button",{name:"+ Hisob",exact:true}).click();
 await page.getByLabel("Boshlang‘ich qoldiq",{exact:true}).fill("100.00");
 await page.getByRole("button",{name:"Saqlash",exact:true}).click();
 await expect(page.getByRole("button",{name:"Qayta urinish",exact:true})).toBeVisible();
 await page.reload();await page.getByRole("button",{name:"Qayta urinish",exact:true}).click();
 await expect(page.getByLabel("Boshlang‘ich qoldiq",{exact:true})).toHaveValue("100.00");
 await page.getByLabel("Nom",{exact:true}).fill("Tuzatilgan");
 await page.getByRole("button",{name:"Saqlash",exact:true}).click();
 await expect(page.getByRole("status")).toContainText("Hisob ochildi.");expect(attempts).toBe(3);
});

test("restored management retry leaves new-account defaults intact",async({page})=>{
 const id="11111111-1111-4111-8111-111111111111";let attempts=0;
 await page.route(/\/api\/personal\/accounts(?:\/|\?|$)/,async route=>{
  if(route.request().method()==="GET"){await route.fulfill({json:{accounts:[{id,name:"Bank",icon:"bank",color:"#18794E",currencyCode:"UZS",scale:2,status:"active",includeInTotal:true,version:1,balanceMinor:"0"}],totals:[],preferences:{defaultAccountId:id,timeZone:"UTC",version:2},nextOffset:null}});return;}
  attempts++;if(attempts===1){await route.abort("failed");return;}
  await route.fulfill({json:{accountId:id,replayed:true}});
 });
 await page.goto("/personal");const card=page.locator("article");await card.getByText("Boshqarish",{exact:true}).click();
 await card.getByRole("button",{name:"Arxivlash",exact:true}).click();
 await expect(page.getByRole("button",{name:"Qayta urinish",exact:true})).toBeVisible();await page.reload();
 await page.getByRole("button",{name:"Qayta urinish",exact:true}).click();await expect(page.getByRole("status")).toContainText("Hisob yangilandi.");
 await page.getByRole("button",{name:"+ Hisob",exact:true}).click();
 await expect(page.getByLabel("Nom",{exact:true})).toHaveValue("Naqd");
 await expect(page.getByLabel("Boshlang‘ich qoldiq",{exact:true})).toHaveValue("0");
 await expect(page.getByLabel("Valyuta",{exact:true})).toHaveValue("UZS");
});
