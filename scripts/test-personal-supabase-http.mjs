// Explicit opt-in integration runner. Only a NEW disposable local CLI project;
// never reads .env, hosted credentials, or a linked project's settings.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createServerClient } from '@supabase/ssr';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workdir = realpathSync(process.argv[2] ?? '');
assert.match(workdir, /^\/private\/tmp\/creditbook-g01-supabase\.[A-Za-z0-9]+$/);
const config = readFileSync(path.join(workdir, 'supabase/config.toml'), 'utf8');
const project = config.match(/^project_id = "([^"]+)"/m)?.[1];
assert.equal(project, path.basename(workdir), 'Only a matching disposable project is allowed');
assert.match(config, /^enable_anonymous_sign_ins = true$/m, 'Enable anonymous signups only in the disposable test config');
assert.equal(existsSync(path.join(workdir, 'supabase/.temp/project-ref')), false, 'Never use a linked project');
const db = `supabase_db_${project}`;
const childEnv = { DOCKER_CONTEXT: 'colima', NEXT_TELEMETRY_DISABLED: '1' };
for (const key of ['PATH', 'TMPDIR', 'LANG', 'LC_ALL']) if (process.env[key]) childEnv[key] = process.env[key];
assert.equal(execFileSync('supabase', ['--version'], { env: childEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(), '2.75.0', 'Reviewed CLI version required');
const status = JSON.parse(execFileSync('supabase', ['status', '--workdir', workdir, '-o', 'json'], { env: childEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
const base = status.API_URL;
assert.equal(base, 'http://127.0.0.1:54321', 'Refuse any non-local API target');
assert.ok(status.ANON_KEY, 'Local CLI public auth key is required');
for (const container of [db, `supabase_kong_${project}`]) {
  const labels = JSON.parse(execFileSync('docker', ['--context', 'colima', 'inspect', container, '--format', '{{json .Config.Labels}}'], { encoding: 'utf8' }));
  assert.equal(labels['com.supabase.cli.project'], project, 'Refuse a container from another project');
  const ports = JSON.parse(execFileSync('docker', ['--context', 'colima', 'inspect', container, '--format', '{{json .NetworkSettings.Ports}}'], { encoding: 'utf8' }));
  const bindings = Object.values(ports).flat().filter(Boolean);
  assert.ok(bindings.length > 0 && bindings.every(binding => binding.HostIp === '127.0.0.1'), 'Only loopback-published containers allowed');
}
const sql = statement => execFileSync('docker', ['--context', 'colima', 'exec', '-i', db,
  'psql', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'],
{ input: statement, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const uid = value => { assert.match(value, /^[0-9a-f-]{36}$/); return literal(value); };
let passed = 0;
const check = (label, ok) => { assert.ok(ok, label); passed++; console.log(`PASS: ${label}`); };
async function request(endpoint, { token, method = 'GET', body, headers = {}, app = false } = {}) {
  const target = (app ? 'http://127.0.0.1:4389' : base) + endpoint;
  const response = await fetch(target, {
    method, redirect: 'manual', signal: AbortSignal.timeout(20000),
    headers: { ...(app ? {} : { apikey: status.ANON_KEY }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  return { status: response.status, data, text, headers: response.headers };
}
const rpc = (name, token, body = {}) => request('/rest/v1/rpc/' + name, { token, method: 'POST', body });
const command = name => ({ name, currencyCode: 'JPY', openingAmountMinor: '10000', openingDate: '2026-01-01', timeZone: 'Asia/Tokyo' });
const tables = ['personal_workspaces', 'personal_accounts', 'personal_postings', 'personal_workspace_preferences', 'personal_audit_events'];
let appProcess;
let appdir;
let ownsFreshTarget = false;
try {
  check('target database is a fresh local Auth instance', sql('select count(*) from auth.users;') === '0');
  check('target contains no prior application schema', sql("select to_regclass('public.profiles') is null;") === 't');
  ownsFreshTarget = true;
  sql(readFileSync(path.join(repo, 'supabase/schema.sql'), 'utf8'));
  for (const file of readdirSync(path.join(repo, 'supabase/migrations')).filter(n => n.endsWith('.sql')).sort()) {
    sql(readFileSync(path.join(repo, 'supabase/migrations', file), 'utf8'));
  }
  sql("notify pgrst, 'reload schema';");

  const users = [];
  for (const name of ['owner-a', 'non-pilot-b', 'owner-c', 'invite-d']) {
    const email = `${name}-${randomUUID()}@fixture.test`, password = randomBytes(24).toString('base64url');
    const signup = await request('/auth/v1/signup', { method: 'POST', body: { email, password, data: { personal_pilot: true, role: 'platform_owner' } } });
    check(`${name}: real GoTrue signup invokes application trigger`, signup.status === 200 && !!signup.data?.user?.id);
    const login = await request('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } });
    check(`${name}: real password login returns an Auth-issued JWT`, login.status === 200 && !!login.data?.access_token);
    const user = { id: login.data.user.id, token: login.data.access_token, email, password };
    const verified = await request('/auth/v1/user', { token: user.token });
    check(`${name}: issued JWT is verified by Auth`, verified.status === 200 && verified.data?.id === user.id);
    users.push(user);
  }
  const [a, b, c, d] = users;
  const badLogin = await request('/auth/v1/token?grant_type=password', { method: 'POST', body: { email: a.email, password: 'not-the-password' } });
  check('incorrect password does not authenticate', badLogin.status === 400 && !badLogin.data?.access_token);
  check('real signup creates one personal workspace per identity', sql('select count(*) from public.personal_workspaces;') === '4');
  check('metadata creates no platform role', sql('select count(*) from public.platform_roles;') === '0');
  check('metadata creates no shop or membership', sql('select count(*) from public.shops;') === '0' && sql('select count(*) from public.shop_members;') === '0');
  const anonymous = await request('/auth/v1/signup', { method: 'POST', body: { data: { personal_pilot: true } } });
  check('real anonymous Auth signup returns its own issued JWT', anonymous.status === 200 && anonymous.data?.user?.is_anonymous === true && !!anonymous.data?.access_token);
  const anonUser = anonymous.data.user;
  sql(`insert into creditbook_private.personal_pilot_allowlist(user_id) values(${uid(anonUser.id)});`);
  const anonymousPermit = await rpc('has_personal_pilot_access', anonymous.data.access_token);
  check('even allowlisted real anonymous JWT is denied personal access', anonymousPermit.status === 200 && anonymousPermit.data === false);
  const anonymousRows = await request('/rest/v1/personal_postings?select=*', { token: anonymous.data.access_token });
  check('real anonymous JWT cannot read personal money', anonymousRows.status === 200 && anonymousRows.data?.length === 0);
  const anonymousProvision = await rpc('ensure_my_personal_workspace', anonymous.data.access_token);
  check('real anonymous JWT cannot provision a personal workspace', anonymousProvision.status === 403);
  check('anonymous signup trigger does not provision personal authority', sql(`select count(*) from public.personal_workspaces where owner_user_id=${uid(anonUser.id)};`) === '0');

  for (const user of users) {
    const denied = await rpc('has_personal_pilot_access', user.token);
    check('fresh signup is not silently enrolled in the pilot', denied.status === 200 && denied.data === false);
  }
  sql(`insert into creditbook_private.personal_pilot_allowlist(user_id) values(${uid(a.id)}),(${uid(b.id)}),(${uid(c.id)});`);
  let create;
  const created = [];
  for (const [name, user] of [['A', a], ['B', b], ['C', c]]) {
    const key = randomUUID();
    create = await rpc('create_personal_account', user.token, { p_command: command('Fixture ' + name), p_client_key: key });
    check(`${name}: approved owner can create through real REST RPC`, create.status === 200 && !!create.data?.accountId);
    const replay = await rpc('create_personal_account', user.token, { p_command: command('Fixture ' + name), p_client_key: key });
    check(`${name}: HTTP retry replays without duplicate money`, replay.status === 200 && replay.data?.replayed === true && replay.data.accountId === create.data.accountId);
    created.push({ id: create.data.accountId, key, command: command('Fixture ' + name) });
  }
  sql(`update creditbook_private.personal_pilot_allowlist set enabled=false where user_id=${uid(b.id)};`);
  const rowsBeforeDenial = sql('select count(*) from public.personal_accounts;');
  const ownRows = new Map();
  for (const table of tables) {
    const own = await request(`/rest/v1/${table}?select=*`, { token: a.token });
    check(`approved A sees only own ${table}`, own.status === 200 && own.data?.length === 1);
    ownRows.set(table, own.data[0]);
    const denied = await request(`/rest/v1/${table}?select=*`, { token: b.token });
    check(`non-pilot B cannot read existing ${table}`, denied.status === 200 && denied.data?.length === 0);
  }
  const cross = await request(`/rest/v1/personal_accounts?select=*&id=eq.${created[0].id}`, { token: c.token });
  check('approved C cannot read A account by guessing UUID', cross.status === 200 && cross.data?.length === 0);
  for (const [name, body] of [
    ['ensure_my_personal_workspace', {}], ['get_personal_accounts', { p_offset: 0 }],
    ['create_personal_account', { p_command: command('Denied'), p_client_key: randomUUID() }],
    ['manage_personal_account', { p_command: {}, p_client_key: randomUUID() }],
  ]) {
    const denied = await rpc(name, b.token, body);
    check(`non-pilot cannot bypass app through ${name}`, denied.status === 403 && denied.data?.code === '42501');
  }
  const privateRead = await request('/rest/v1/personal_pilot_allowlist?select=*', { token: a.token, headers: { 'Accept-Profile': 'creditbook_private' } });
  check('private allowlist schema is not exposed by PostgREST', privateRead.status === 406);
  const privateCall = await request('/rest/v1/rpc/create_personal_account', { token: b.token, method: 'POST', headers: { 'Content-Profile': 'creditbook_private' }, body: {} });
  check('private financial schema cannot be selected through REST', privateCall.status === 406);
  const directWrite = await request('/rest/v1/personal_accounts', { token: a.token, method: 'POST', body: { name: 'Bypass' } });
  check('authenticated direct financial table writes remain forbidden', directWrite.status === 403);
  for (const [table, patch] of [['personal_postings', { amount_minor: 1 }], ['personal_audit_events', { event_type: 'account.updated' }], ['personal_workspace_preferences', { time_zone: 'UTC' }], ['personal_accounts', { name: 'Forbidden' }]]) {
    for (const method of ['POST', 'PATCH', 'DELETE']) {
      // Attack a known own row, not an unfiltered update rejected by an unrelated
      // platform safe-update rule before the privilege/RLS boundary is reached.
      const key = table === 'personal_workspace_preferences' ? 'workspace_id' : 'id';
      const filter = method === 'POST' ? '' : `?${key}=eq.${ownRows.get(table)[key]}`;
      const denied = await request('/rest/v1/' + table + filter, { token: a.token, method, ...(method === 'DELETE' ? {} : { body: patch }) });
      check(`direct ${method} ${table} cannot bypass financial RPC (HTTP ${denied.status}, ${denied.data?.code ?? 'no-code'})`, denied.status === 403);
    }
  }
  const receiptRead = await request('/rest/v1/personal_command_receipts?select=*', { token: a.token, headers: { 'Accept-Profile': 'creditbook_private' } });
  check('private command receipts are not exposed through REST', receiptRead.status === 406);
  const ownerSpoof = await request('/rest/v1/personal_workspaces', { token: a.token, method: 'POST', body: { owner_user_id: c.id } });
  check('approved owner cannot provision another UUID through REST', ownerSpoof.status === 403);
  check('denied commands changed no existing account count', sql('select count(*) from public.personal_accounts;') === rowsBeforeDenial);
  const anon = await rpc('has_personal_pilot_access');
  check('anonymous REST requests cannot execute the policy RPC', anon.status === 401);
  const parts = a.token.split('.');
  parts[2] = (parts[2][0] === 'a' ? 'b' : 'a') + parts[2].slice(1);
  const tampered = await rpc('has_personal_pilot_access', parts.join('.'));
  check('PostgREST rejects a tampered JWT signature', tampered.status === 401);

  // Explicitly local synthetic shops; the personal pilot never grants shop roles.
  const shopA = randomUUID(), shopB = randomUUID();
  sql(`insert into public.shops(id,owner_user_id,name) values(${uid(shopA)},${uid(a.id)},'Fixture shop A'),(${uid(shopB)},${uid(b.id)},'Fixture shop B');
    insert into public.shop_members(shop_id,user_id,role,status) values(${uid(shopA)},${uid(a.id)},'shop_owner','active'),(${uid(shopB)},${uid(b.id)},'shop_owner','active'),(${uid(shopB)},${uid(d.id)},'cashier','invited');
    update public.profiles set current_shop_id=${uid(shopA)} where id=${uid(a.id)};
    update public.profiles set current_shop_id=${uid(shopB)} where id=${uid(b.id)};`);
  const customers = [];
  for (const [name, user] of [['A', a], ['B', b]]) {
    const customer = await request('/rest/v1/customers', { token: user.token, method: 'POST', headers: { Prefer: 'return=representation' }, body: { name: 'Fixture customer ' + name } });
    check(`${name}: existing shop authority works independently of pilot`, customer.status === 201 && customer.data?.length === 1);
    customers.push(customer.data[0]);
  }
  for (const [user, foreign] of [[a, customers[1]], [b, customers[0]]]) {
    const hidden = await request(`/rest/v1/customers?select=*&id=eq.${foreign.id}`, { token: user.token });
    check('cross-shop customer is hidden through REST', hidden.status === 200 && hidden.data?.length === 0);
  }
  const wrongPermission = await rpc('has_shop_permission', b.token, { p_shop_id: shopA, p_permission: 'customer.read' });
  check('non-pilot shop owner cannot acquire another shop permission', wrongPermission.status === 200 && wrongPermission.data === false);
  const wrongWrite = await request('/rest/v1/customers', { token: b.token, method: 'POST', body: { name: 'Cross shop attempt', shop_id: shopA } });
  check('cross-shop customer creation is denied', wrongWrite.status === 403);
  const beforeInvite = await rpc('get_current_shop_id', d.token);
  check('pending invite has no active shop access', beforeInvite.status === 200 && beforeInvite.data === null);
  const invite = await rpc('activate_invited_memberships', d.token, { p_shop_id: shopB });
  check('existing invitation still activates via HTTP RPC', invite.status === 200 && invite.data === 1);
  const inviteReplay = await rpc('activate_invited_memberships', d.token, { p_shop_id: shopB });
  check('invitation replay is idempotent', inviteReplay.status === 200 && inviteReplay.data === 0);
  const afterInvite = await rpc('get_current_shop_id', d.token);
  check('activated invite resolves only the intended shop', afterInvite.status === 200 && afterInvite.data === shopB);
  check('shop invitation never grants personal pilot access', (await rpc('has_personal_pilot_access', d.token)).data === false);

  sql(`insert into public.platform_roles(user_id,role) values(${uid(c.id)},'platform_admin');`);
  const adminCross = await request(`/rest/v1/personal_accounts?select=*&id=eq.${created[0].id}`, { token: c.token });
  check('actual platform admin cannot read another personal owner', adminCross.status === 200 && adminCross.data?.length === 0);
  const metadata = await request('/auth/v1/user', { token: b.token, method: 'PUT', body: { data: { personal_pilot: true, role: 'platform_owner' } } });
  check('Auth allows editing ordinary user metadata for spoof test', metadata.status === 200);
  const freshB = await request('/auth/v1/token?grant_type=password', { method: 'POST', body: { email: b.email, password: b.password } });
  check('fresh signed token with forged metadata grants no pilot authority', freshB.status === 200 && (await rpc('has_personal_pilot_access', freshB.data.access_token)).data === false);

  // Run real Next HTTP handlers as well, with explicit local-only Supabase env.
  // Stage reviewed application sources only: no dotenv, .git, existing .next,
  // ambient credentials or original worktree writes in the child Next process.
  appdir = mkdtempSync('/private/tmp/creditbook-g01-http-app.');
  for (const entry of ['app', 'components', 'lib', 'public', 'next.config.ts', 'next-env.d.ts', 'tsconfig.json', 'package.json', 'package-lock.json']) {
    if (existsSync(path.join(repo, entry))) cpSync(path.join(repo, entry), path.join(appdir, entry), { recursive: true });
  }
  symlinkSync(path.join(repo, 'node_modules'), path.join(appdir, 'node_modules'), 'dir');
  assert.ok(!readdirSync(appdir).some(name => name.startsWith('.env')), 'No dotenv files staged');
  const portProbe = createServer();
  await new Promise((resolve, reject) => { portProbe.once('error', reject); portProbe.listen(4389, '127.0.0.1', resolve); });
  await new Promise((resolve, reject) => portProbe.close(error => error ? reject(error) : resolve()));
  const appEnv = { ...childEnv, NODE_ENV: 'production',
      NEXT_PUBLIC_SUPABASE_URL: base, SUPABASE_URL: base,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: status.ANON_KEY, SUPABASE_PUBLISHABLE_KEY: status.ANON_KEY,
      NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:4389', SUPABASE_SECRET_KEY: '',
      DATABASE_URL: '', DIRECT_URL: '', SUPABASE_DATABASE_PASSWORD: '',
  };
  execFileSync(process.execPath, [path.join(repo, 'node_modules/next/dist/bin/next'), 'build', '--webpack'], {
    cwd: appdir, env: appEnv, timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'],
  });
  appProcess = spawn(process.execPath, [path.join(repo, 'node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', '4389'], {
    cwd: appdir, stdio: 'ignore', env: appEnv,
  });
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    try { const res = await request('/api/personal/accounts', { app: true }); if (res.status === 401) { ready = true; break; } } catch { /* bounded startup */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  check('local Next HTTP server is ready without authenticating anonymous requests', ready);
  const appAllowed = await request('/api/personal/accounts', { app: true, token: a.token });
  check('real Next handler verifies Auth JWT and returns permitted account', appAllowed.status === 200 && appAllowed.data?.accounts?.[0]?.id === created[0].id);
  const appAnonymous = await request('/api/personal/accounts', { app: true, token: anonymous.data.access_token });
  check('real Next handler rejects an Auth-issued anonymous JWT', appAnonymous.status === 403);
  const signedOutPage = await request('/personal', { app: true });
  check(`signed-out server page redirects to login (HTTP ${signedOutPage.status})`,
    (signedOutPage.status === 307 && new URL(signedOutPage.headers.get('location') ?? '/', 'http://127.0.0.1:4389').pathname === '/login')
    || (signedOutPage.status === 200 && signedOutPage.text.includes('http-equiv="refresh"') && signedOutPage.text.includes('url=/login')));
  for (const [name, user] of [['allowed', a], ['denied', b]]) {
    let cookies = [];
    const ssr = createServerClient(base, status.ANON_KEY, {
      cookies: { getAll: () => [], setAll: items => { cookies = items; } },
    });
    const { error } = await ssr.auth.signInWithPassword({ email: user.email, password: user.password });
    check(`${name}: real SSR login produces session cookies`, !error && cookies.length > 0);
    const page = await request('/personal', { app: true, headers: { Cookie: cookies.map(({ name: key, value }) => `${key}=${encodeURIComponent(value)}`).join('; ') } });
    check(`${name}: real server page enforces cookie-session access`, page.status === 200 && page.text.includes(name === 'allowed' ? 'Hisoblar' : 'Shaxsiy bo‘limga ruxsat yo‘q.'));
    check(`${name}: private server page is not publicly cacheable (${page.headers.get('cache-control') ?? 'missing header'})`, page.headers.get('cache-control')?.includes('no-store'));
  }
  const ensured = await request('/api/personal/workspace', { app: true, token: a.token, method: 'POST', body: {} });
  check('allowed Next workspace POST provisions idempotently', ensured.status === 200 && !!ensured.data?.workspace?.id);
  const httpWorkspace = await request('/api/personal/workspace', { app: true, token: a.token });
  check('allowed Next workspace GET returns the same owner workspace', httpWorkspace.status === 200 && httpWorkspace.data?.workspace?.id === ensured.data.workspace.id);
  const httpCommand = command('HTTP wallet'), httpKey = randomUUID();
  const httpCreated = await request('/api/personal/accounts', { app: true, token: a.token, method: 'POST', body: { command: httpCommand, clientKey: httpKey } });
  check('allowed Next account POST maps command and returns 201', httpCreated.status === 201 && !!httpCreated.data?.accountId);
  const httpReplay = await request('/api/personal/accounts', { app: true, token: a.token, method: 'POST', body: { command: httpCommand, clientKey: httpKey } });
  check('allowed Next account POST replay returns 200 without duplicate', httpReplay.status === 200 && httpReplay.data?.replayed === true && httpReplay.data.accountId === httpCreated.data.accountId);
  const httpManaged = await request(`/api/personal/accounts/${httpCreated.data.accountId}`, { app: true, token: a.token, method: 'PATCH', body: { clientKey: randomUUID(), command: {
    operation: 'update', name: 'HTTP renamed', accountVersion: httpCreated.data.accountVersion, preferencesVersion: httpCreated.data.preferencesVersion,
  } } });
  check('allowed Next PATCH maps versioned account command', httpManaged.status === 200 && httpManaged.data?.accountVersion === 2);
  const httpHistory = await request(`/api/personal/accounts/${httpCreated.data.accountId}/postings`, { app: true, token: a.token });
  check('allowed Next history GET returns exact opening string', httpHistory.status === 200 && httpHistory.data?.postings?.length === 1 && httpHistory.data.postings[0].amount_minor === '10000');
  const boundaries = [
    ['GET', '/api/personal/workspace'], ['POST', '/api/personal/workspace'],
    ['GET', '/api/personal/accounts'], ['POST', '/api/personal/accounts'],
    ['PATCH', `/api/personal/accounts/${created[0].id}`], ['GET', `/api/personal/accounts/${created[0].id}/postings`],
  ];
  for (const [method, endpoint] of boundaries) {
    const denied = await request(endpoint, { app: true, token: b.token, method, ...(method === 'GET' ? {} : { body: {} }) });
    check(`real Next ${method} personal boundary denies non-pilot`, denied.status === 403 && denied.data?.code === 'PERSONAL_ACCESS_DENIED');
    check('private denial response is not cacheable', denied.headers.get('cache-control') === 'private, no-store');
  }

  sql(`update creditbook_private.personal_pilot_allowlist set enabled=false where user_id=${uid(a.id)};`);
  check('revoked old JWT is still cryptographically valid at Auth', (await request('/auth/v1/user', { token: a.token })).status === 200);
  check('old valid JWT loses pilot access without refresh', (await rpc('has_personal_pilot_access', a.token)).data === false);
  check('old valid JWT cannot read personal history', (await request('/rest/v1/personal_postings?select=*', { token: a.token })).data?.length === 0);
  const oldReplay = await rpc('create_personal_account', a.token, { p_command: created[0].command, p_client_key: created[0].key });
  check('revoked old JWT cannot replay a successful financial command', oldReplay.status === 403);
  check('real Next handler also rejects revoked valid JWT', (await request('/api/personal/accounts', { app: true, token: a.token })).status === 403);
  sql(`update creditbook_private.personal_pilot_allowlist set enabled=true where user_id=${uid(a.id)};
    update auth.users set banned_until=now()+interval '1 day' where id=${uid(a.id)};`);
  check('old issued JWT is denied by pilot policy after a fresh ban', (await rpc('has_personal_pilot_access', a.token)).data === false);
  check('old issued JWT cannot read accounts after fresh ban', (await request('/rest/v1/personal_accounts?select=*', { token: a.token })).data?.length === 0);
  sql(`update auth.users set banned_until=null,deleted_at=now() where id=${uid(a.id)};`);
  check('soft-deleted identity cannot reuse an old issued JWT', (await rpc('has_personal_pilot_access', a.token)).data === false);
  sql(`update auth.users set deleted_at=null where id=${uid(a.id)};`);
  sql(`update public.personal_workspaces set status='suspended' where owner_user_id=${uid(a.id)};`);
  const suspended = await rpc('get_personal_accounts', a.token, { p_offset: 0 });
  check('approved pilot cannot bypass suspended workspace through REST RPC', suspended.status === 403);
  const suspendedRows = await request('/rest/v1/personal_accounts?select=*', { token: a.token });
  check('approved pilot sees no suspended workspace accounts', suspendedRows.status === 200 && suspendedRows.data?.length === 0);
  sql(`update public.personal_workspaces set status='active' where owner_user_id=${uid(a.id)};`);
  check('authorized state restoration preserves original personal history', sql('select count(*) from public.personal_accounts;') === '4' && sql('select sum(amount_minor) from public.personal_postings;') === '40000');
  check('shop/customer records survive all personal permission changes', sql('select count(*) from public.shops;') === '2' && sql('select count(*) from public.customers;') === '2');
  console.log(`RESULT: ${passed} real local Auth/REST/Next assertions passed. No hosted project accessed.`);
} finally {
  if (appProcess) {
    await new Promise(resolve => {
      if (appProcess.exitCode !== null || appProcess.signalCode !== null) { resolve(); return; }
      const timer = setTimeout(() => appProcess.kill('SIGKILL'), 3000);
      appProcess.once('exit', () => { clearTimeout(timer); resolve(); });
      appProcess.kill('SIGTERM');
    });
  }
  try {
    if (appdir) rmSync(appdir, { recursive: true, force: true });
  } finally {
    if (ownsFreshTarget) {
      execFileSync('supabase', ['stop', '--workdir', workdir, '--project-id', project, '--no-backup'], { env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
      console.log('CLEANUP: only this verified disposable project and staged app were removed.');
    }
  }
}
