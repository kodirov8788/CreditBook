// Real Auth/PostgREST/Next + manual CUA acceptance; owned localhost targets only.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServerClient } from '@supabase/ssr';
import { createOwnedDirectory, provisionOwnedSupabase } from './lib/owned-local-supabase.mjs';

assert.equal(process.argv.length, 2, 'No caller-supplied target allowed');
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = await provisionOwnedSupabase();
let ownedApp, appProcess;
let passed = 0;
const check = (label, ok) => {assert.ok(ok, label); passed++; console.log('PASS: ' + label);};
async function stopApp() {
  if (!appProcess) return;
  await new Promise(resolve => {
    if (appProcess.exitCode !== null || appProcess.signalCode !== null) {resolve(); return;}
    const timer = setTimeout(() => appProcess.kill('SIGKILL'), 3000);
    appProcess.once('exit', () => {clearTimeout(timer); resolve();});
    appProcess.kill('SIGTERM');
  });
  appProcess = undefined;
}
try {
  fixture.verify();
  const portProbe = createServer();
  await new Promise((resolve,reject)=>{portProbe.once('error',reject);portProbe.listen(4389,'127.0.0.1',resolve);});
  await new Promise((resolve,reject)=>portProbe.close(error=>error?reject(error):resolve()));
  const db = `supabase_db_${fixture.project}`;
  const sql = statement => execFileSync('docker', ['--context', 'colima', 'exec', '-i', db, 'psql', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres'], {input: statement, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']}).trim();
  check('fresh database has no prior users or application schema', sql("select count(*)=0 and to_regclass('public.profiles') is null from auth.users;") === 't');
  sql(readFileSync(path.join(repo, 'supabase/schema.sql'), 'utf8'));
  for (const file of readdirSync(path.join(repo, 'supabase/migrations')).filter(n => n.endsWith('.sql')).sort()) sql(readFileSync(path.join(repo, 'supabase/migrations', file), 'utf8'));
  sql("notify pgrst, 'reload schema';");
  const status = JSON.parse(execFileSync('supabase', ['status', '--workdir', fixture.workdir, '-o', 'json'], {env: fixture.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}));
  assert.equal(status.API_URL, 'http://127.0.0.1:54321');
  const base = status.API_URL;
  async function request(endpoint, {app = false, token, cookie, body, method = 'GET'} = {}) {
    const started = performance.now();
    const response = await fetch((app ? 'http://127.0.0.1:4389' : base) + endpoint, {method, redirect: 'manual', signal: AbortSignal.timeout(30000), headers: {
      ...(!app ? {apikey: status.ANON_KEY} : {}), ...(token ? {Authorization: `Bearer ${token}`} : {}), ...(cookie ? {Cookie: cookie} : {}), ...(body !== undefined ? {'Content-Type': 'application/json'} : {}),
    }, ...(body !== undefined ? {body: JSON.stringify(body)} : {})});
    const text = await response.text(); let data;
    try {data = JSON.parse(text);} catch {data = null;}
    return {status: response.status, data, text, headers: response.headers, milliseconds: Math.round(performance.now() - started)};
  }
  const users = [];
  for (let i = 0; i < 2; i++) {
    const email = `shop-http-${randomUUID()}@fixture.test`, password = randomBytes(24).toString('base64url');
    const signup = await request('/auth/v1/signup', {method: 'POST', body: {email, password}});
    check('QA signup succeeds against local Auth', signup.status === 200);
    const login = await request('/auth/v1/token?grant_type=password', {method: 'POST', body: {email, password}});
    check('local Auth issues actual JWT', login.status === 200 && !!login.data?.access_token);
    users.push({id: login.data.user.id, token: login.data.access_token, email, password});
  }
  const [a, b] = users;
  for (const [index, user] of users.entries()) {
    const shop = randomUUID(); user.shop = shop;
    sql(`insert into public.shops(id,owner_user_id,name) values('${shop}','${user.id}','QA HTTP Shop ${index + 1}');
      insert into public.shop_members(shop_id,user_id,role,status) values('${shop}','${user.id}','shop_owner','active');
      update public.profiles set current_shop_id='${shop}' where id='${user.id}';`);
  }
  sql(`insert into public.customers(id,user_id,shop_id,name,phone,created_at)
    select ('81000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'${a.id}','${a.shop}','QA Customer '||i,null,now()+(i||' seconds')::interval from generate_series(1,1105)i;
    insert into public.debts(id,user_id,shop_id,customer_id,principal,due_date)
    select ('82000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'${a.id}','${a.shop}',('81000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,100,(now() at time zone 'UTC')::date + case when i<=5 then -1 else 30 end from generate_series(1,1105)i;
    insert into public.payments(user_id,shop_id,customer_id,debt_id,amount)
    select '${a.id}','${a.shop}',('81000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,('82000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,40 from generate_series(1,1105)i;
    insert into public.payments(user_id,shop_id,customer_id,debt_id,amount)
    select '${a.id}','${a.shop}','81000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001',0.01 from generate_series(1,1001);
    insert into public.debts(id,user_id,shop_id,customer_id,principal,due_date,status) values
    ('82000000-0000-4000-8000-000000002001','${a.id}','${a.shop}','81000000-0000-4000-8000-000000001105',100,(now() at time zone 'UTC')::date-40,'paid'),
    ('82000000-0000-4000-8000-000000002002','${a.id}','${a.shop}','81000000-0000-4000-8000-000000001105',1000,(now() at time zone 'UTC')::date-40,'cancelled');
    insert into public.payments(user_id,shop_id,customer_id,debt_id,amount) values
    ('${a.id}','${a.shop}','81000000-0000-4000-8000-000000001105','82000000-0000-4000-8000-000000002001',100),
    ('${a.id}','${a.shop}','81000000-0000-4000-8000-000000001105','82000000-0000-4000-8000-000000002002',10);
    insert into public.payments(user_id,shop_id,customer_id,debt_id,amount,voided_at) values('${a.id}','${a.shop}','81000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001',500,now());
    insert into public.expenses(user_id,shop_id,category,amount,spent_at) select '${a.id}','${a.shop}','QA Stock',2,(now() at time zone 'UTC')::date from generate_series(1,1105);
    insert into public.expenses(user_id,shop_id,category,amount,voided_at) values('${a.id}','${a.shop}','QA Voided',500,now());`);
  const before = sql('select jsonb_build_object(\'customers\',(select count(*) from public.customers),\'debts\',(select count(*) from public.debts),\'payments\',(select count(*) from public.payments),\'expenses\',(select count(*) from public.expenses));');
  const raw = await request('/rest/v1/customers?select=id&limit=2000', {token: a.token});
  check('ordinary REST read really is capped at1000 despite1105 rows', raw.status === 200 && raw.data.length === 1000);
  const rpcPage = await request('/rest/v1/rpc/shop_dashboard_page', {token: a.token, method: 'POST', body: {p_limit: 100}});
  check('scalar aggregate RPC survives actual PostgREST row cap', rpcPage.status === 200 && rpcPage.data.summary.length === 100 && rpcPage.data.totals.customers === 1105 && rpcPage.data.totals.outstanding === 66289.99);
  ownedApp = createOwnedDirectory('app'); const appdir = ownedApp.workdir;
  for (const entry of ['app','components','lib','public','next.config.ts','next-env.d.ts','tsconfig.json','package.json','package-lock.json']) if (existsSync(path.join(repo, entry))) cpSync(path.join(repo, entry),path.join(appdir,entry),{recursive:true});
  symlinkSync(path.join(repo,'node_modules'),path.join(appdir,'node_modules'),'dir');
  assert.ok(!readdirSync(appdir).some(n=>n.startsWith('.env')));
  const appEnv = {...fixture.env, NODE_ENV:'production', NEXT_PUBLIC_SUPABASE_URL:base,SUPABASE_URL:base,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:status.ANON_KEY,SUPABASE_PUBLISHABLE_KEY:status.ANON_KEY,NEXT_PUBLIC_APP_URL:'http://127.0.0.1:4389',SUPABASE_SECRET_KEY:'',DATABASE_URL:'',DIRECT_URL:''};
  async function startApp(label) {
    console.log('BUILD: isolated local '+label+' app using existing dependencies, no dotenv.');
    execFileSync(process.execPath,[path.join(repo,'node_modules/next/dist/bin/next'),'build','--webpack'],{cwd:appdir,env:appEnv,timeout:120000,stdio:['ignore','pipe','pipe']});
    appProcess=spawn(process.execPath,[path.join(repo,'node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port','4389'],{cwd:appdir,env:appEnv,stdio:'ignore'});
    let ready=false; for(let i=0;i<40;i++){try{if((await request('/api/dashboard',{app:true})).status===401){ready=true;break;}}catch{} await new Promise(r=>setTimeout(r,500));}
    check(label+' local Next server enforces signed-out401',ready);
    assert.equal(appProcess.exitCode,null,'Only the freshly staged Next process may serve acceptance');
  }
  // Paired real HTTP measurement: same fixture/schema/data, only page capacity
  // differs. No edits to the user's checkout, no caller-supplied target.
  const helperPath=path.join(appdir,'lib/shop-read-model.ts');
  const optimizedHelper=readFileSync(helperPath,'utf8');
  assert.equal((optimizedHelper.match(/const PAGE_SIZE = 1000;/g)||[]).length,1);
  writeFileSync(helperPath,optimizedHelper.replace('const PAGE_SIZE = 1000;','const PAGE_SIZE = 100;'));
  await startApp('baseline100');
  const baseline={dashboard:[],report:[]};
  for(let i=0;i<3;i++)for(const name of ['dashboard','report']){
    const response=await request('/api/'+(name==='report'?'reports':name),{app:true,token:a.token});
    assert.equal(response.status,200,'Baseline must return a successful complete response');
    baseline[name].push(response);
  }
  await stopApp();
  writeFileSync(helperPath,optimizedHelper);
  await startApp('optimized1000');
  const timing={};
  for(const name of ['dashboard','report']){
    const samples=[];
    for(let i=0;i<3;i++){
      const response=await request('/api/'+(name==='report'?'reports':name),{app:true,token:a.token});
      assert.equal(response.status,200);
      assert.deepEqual(response.data,baseline[name][i].data,'Optimization must preserve every row and exact aggregate');
      samples.push(response.milliseconds);
    }
    const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
    timing[name]={baselineMs:baseline[name].map(r=>r.milliseconds),optimizedMs:samples};
    timing[name].baselineMedianMs=median(timing[name].baselineMs);
    timing[name].optimizedMedianMs=median(samples);
    console.log('PERFORMANCE: '+name+' '+JSON.stringify(timing[name]));
    check(name+' all three optimized HTTP bodies equal baseline exactly',true);
    // Local smoke gate only, not a production latency/SLO guarantee. Machine
    // noise should fail the run for investigation, never hide a regression.
    check(name+' optimized local median is lower than baseline',timing[name].optimizedMedianMs<timing[name].baselineMedianMs);
  }
  const dash=await request('/api/dashboard',{app:true,token:a.token});
  console.log('TIMING: dashboard HTTP '+dash.milliseconds+'ms status'+dash.status);
  check('Next dashboard returns every1105 customers',dash.status===200&&dash.data.summary.length===1105);
  assert.deepEqual(dash.data.totals,{customers:1105,active:1105,outstanding:66289.99,overdue:289.99,collectedThisMonth:44310.01}); passed++; console.log('PASS: exact full dashboard totals');
  check('paid historical due date does not leak into future-only customer',dash.data.summary.find(r=>r.id.endsWith('000000001105')).due_date===sql("select ((now() at time zone 'UTC')::date+30)::text;"));
  const report=await request('/api/reports',{app:true,token:a.token});
  console.log('TIMING: report HTTP '+report.milliseconds+'ms status'+report.status);
  check('Next report returns all1105 active expenses',report.status===200&&report.data.report.expenses.length===1105);
  const expected={newCredits:110600,collected:44320.01,expensesTotal:2210,netCashflow:42110.01,outstanding:66289.99,overdueAmount:289.99,overdueCount:5,activeCustomers:1105};
  for(const [field,value] of Object.entries(expected))check('exact report '+field,report.data.report[field]===value);
  check('monthly totals include all records beyond cap',report.data.report.monthly.length===1&&report.data.report.monthly[0].collected===44320.01&&report.data.report.monthly[0].expenses===2210);
  const other=await request('/api/dashboard',{app:true,token:b.token});
  check('second shop sees no first-shop customer or balance',other.status===200&&other.data.summary.length===0&&other.data.totals.outstanding===0);
  const otherReport=await request('/api/reports',{app:true,token:b.token});
  check('second shop report excludes first-shop money',otherReport.status===200&&otherReport.data.report.collected===0&&otherReport.data.report.expenses.length===0);
  // Use the actual app loader with real HTTP, deliberately ignoring cancellation
  // in this TEST transport so an older full-range response can arrive last.
  const {createReportLoader}=await import(pathToFileURL(path.join(repo,'lib/report-loader.ts')).href);
  const today=new Date().toISOString().slice(0,10), yesterday=new Date(Date.now()-86400000).toISOString().slice(0,10);
  const states=[], arrivals=[];
  let releaseOlder;
  const oldGate=new Promise(resolve=>{releaseOlder=resolve;});
  const loader=createReportLoader(state=>states.push(state),async(url,options)=>{
    const isOlder=String(url).includes('from='+today);
    try {
      const response=await fetch('http://127.0.0.1:4389'+url,{...options,signal:AbortSignal.timeout(30000),headers:{Authorization:`Bearer ${a.token}`}});
      const body=await response.text();
      if(isOlder) await oldGate;
      arrivals.push(String(url));
      return new Response(body,{status:response.status,headers:response.headers});
    } finally {if(!isOlder) releaseOlder();}
  });
  const older=loader.load({from:today,to:today},true);
  const newer=loader.load({from:yesterday,to:yesterday},true);
  await Promise.all([older,newer]);
  check('real HTTP newer empty-period response arrives before older full report',arrivals.length===2&&arrivals[0].includes('from='+yesterday));
  check('actual loader ignores late older HTTP response despite transport ignoring abort',states.at(-1).report?.from===yesterday&&states.at(-1).report?.collected===0&&states.at(-1).loading===false&&states.at(-1).error==='');
  check('only latest real HTTP report was published',states.filter(state=>state.report!==null).length===1);
  check('newer HTTP report retains all-time outstanding and has no period expenses',states.at(-1).report.outstanding===66289.99&&states.at(-1).report.expenses.length===0);
  loader.cancel();
  const denied=await request('/rest/v1/rpc/shop_dashboard_page',{method:'POST',body:{}});
  check('unauthenticated REST cannot execute aggregate RPC',denied.status===401||denied.status===403);
  let cookies=[];
  const ssr=createServerClient(base,status.ANON_KEY,{cookies:{getAll:()=>[],setAll:items=>{cookies=items;}}});
  const {error}=await ssr.auth.signInWithPassword({email:a.email,password:a.password}); assert.ok(!error&&cookies.length);
  const cookie=cookies.map(({name,value})=>`${name}=${encodeURIComponent(value)}`).join('; ');
  const page=await request('/dashboard',{app:true,cookie});
  check('actual SSR page includes last customer beyond1000 and no read failure',page.status===200&&page.text.includes('QA Customer 1105')&&!page.text.includes("Ma&#x27;lumotlar to&#x27;liq olinmadi"));
  const handoff=path.join(appdir,'shop-browser-qa.json');
  writeFileSync(handoff,JSON.stringify({url:'http://127.0.0.1:4389/login?next=%2Fdashboard',users:users.map(({email,password})=>({email,password})),expected,today,yesterday,timing,counts:{customers:1105,expenses:1105}}),{mode:0o600,flag:'wx'});
  console.log('SHOP_BROWSER_READY: '+handoff+' (synthetic credentials withheld)');
  const done=path.join(appdir,'shop-browser-done.txt'), deadline=Date.now()+600000;
  while(!existsSync(done)&&Date.now()<deadline)await new Promise(r=>setTimeout(r,1000));
  assert.ok(existsSync(done),'Browser review acknowledgement missing; HTTP proof is separate from browser evidence');
  check('browser read checks preserve all fixture record counts',sql('select jsonb_build_object(\'customers\',(select count(*) from public.customers),\'debts\',(select count(*) from public.debts),\'payments\',(select count(*) from public.payments),\'expenses\',(select count(*) from public.expenses));')===before);
  console.log(`RESULT: ${passed} real local Auth/REST/Next assertions passed; browser evidence recorded separately.`);
} finally {
  await stopApp();
  if(ownedApp)ownedApp.remove();
  fixture.dispose();
  console.log('CLEANUP: only owned temporary local app and Supabase project removed.');
}
