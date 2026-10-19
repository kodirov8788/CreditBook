# G01 real local Auth / REST / HTTP acceptance

Date: 2026-10-19 (Asia/Tokyo). Local-only, no hosted-project access or release.
Source baseline: fbc15d1 plus the uncommitted G01 application/database changes.

## Result

The final complete runner exited 0 with **122 passing assertions**. It used real
Supabase GoTrue signup/password login and Auth-issued JWTs, real PostgREST, and a
real local Next production-mode build/server. There were no route/Auth/database
mocks in this matrix. Four regular synthetic users and one anonymous user were
created only in the disposable CLI project. No real account was enrolled.

## Verified coverage

- Normal signup trigger, password login and Auth verification; invalid password
  denied, tampered JWT signature rejected by PostgREST.
- No metadata-driven platform/shop/pilot authority. A fresh signed token after
  editing user metadata still cannot self-enrol.
- Real anonymous signup/token, including an explicitly allowlisted anonymous
  fixture: permission false, financial rows hidden, provisioning and app API denied.
- Approved A and C remain isolated across all five public personal tables.
  A non-pilot with existing money cannot read it or use provisioning/read/create/
  manage RPCs. A real platform-admin role does not expose another person's money.
- Private allowlist, private RPC schema and command receipts are not exposed
  through PostgREST. Direct POST/PATCH/DELETE against accounts, postings,
  preferences and audit rows are denied. PATCH/DELETE target known rows so an
  unrelated unfiltered-update safeguard cannot masquerade as the RLS test.
- All six current Next personal handler methods are exercised with an approved
  identity and a denied identity: workspace GET/POST, accounts GET/POST, account
  PATCH and postings GET. HTTP create/replay returns 201/200, versioned management
  persists, and opening history retains exact string amounts.
- Supabase SSR cookie login for allowed/denied users; private server page and
  denial rendering; signed-out redirect (including streaming meta redirect).
  Private page responses in production mode include no-store; API denials are
  private/no-store. No browser JavaScript execution or visual/layout claim.
- Non-pilot shop owner keeps shop access. Two ordinary owners cannot read or
  create customers across the shop boundary. Existing invitation activation and
  replay still work and do not enrol the invitee in the personal pilot.
- Revoking the allowlist denies a previously issued JWT without refreshing it:
  Auth still verifies that token, but REST and Next deny personal access and
  even replay of a previously successful financial command. Fresh ban, soft
  deletion and suspended workspace also block personal reads/RPCs.
- Original synthetic personal records, exact sums and both synthetic shops and
  customers remain consistent after negative attempts and permitted operations.

## Isolation and cleanup

- Supabase CLI **2.75.0**, PostgreSQL 17 local stack; Auth, REST, gateway and DB
  only. No CLI upgrade, new npm package, hosted connection or production API call.
- Dedicated mktemp CLI directory: no linked project reference. The runner checks
  the exact loopback API, project/container labels, loopback Docker bindings,
  zero Auth users and absence of a prior application schema before any mutation.
- Docker and Mac-host bindings were verified at 127.0.0.1:54321/54322. The network
  is a separate ordinary bridge with loopback bindings, not network-none; an
  internal bridge was incompatible with Colima host-port forwarding. Do not
  claim the whole Supabase stack has network-none isolation.
- Next sources are copied mechanically into a runner-owned temporary directory,
  with no dotenv/.git/existing build and only a symlink to installed dependencies.
  The child receives an allowlisted environment and explicit loopback Supabase
  settings. Its production build uses webpack; no original worktree build state
  or dotenv files are used by that child. It serves only 127.0.0.1:4389.
- Keys, passwords, session cookies and JWTs remain in memory and are not printed
  in the acceptance log or this document. HTTP requests use the local public API
  key and user tokens, never a service-role token.
- The final runner stopped its exact verified disposable CLI project with
  --no-backup, removed only that synthetic DB's volumes and the owned staged app,
  and exited 0. It does not reset any pre-existing database. Downloaded official
  Docker images remain cached; unrelated images/projects are not removed.
- Initial pre-isolation dev probing regenerated next-env.d.ts route-type paths;
  those two generated lines were restored to the verified starting version.
  The final production-mode test used only the staged copy. Task-created empty
  Docker bridges and the startup log containing local development keys were
  removed; the credential-free acceptance log and temporary CLI config remain.

## Issues discovered and resolved during the tests

1. Fresh real CLI replay failed on the historical hardening migration's assumed
   public.rls_auto_enable() platform function. The old revoke is now conditional
   on to_regprocedure: hardening remains when present and absent local installs
   do not need a fabricated stub. This is an uncommitted source compatibility
   patch to an older migration, not a rewrite of production migration history.
   Both the real CLI absent-function path and the SQL-fixture present-function
   path were rerun successfully; explicit review remains required before commit.
2. Test-only page assertions initially assumed redirect always means HTTP 307
   and dev-mode cache headers mirror release behavior. Streaming redirect can
   be HTTP 200, so redirect content is checked; final cache assertions run against
   an isolated production build. No cache policy was silently weakened in app code.
3. An initial unfiltered mutation test did not reach the intended row boundary;
   the final matrix attacks known existing rows and requires explicit 403 results.

## Other checks rerun

- API unit/contracts: 235 passed (14 files).
- G01 PostgreSQL suite: 137 PASS assertions.
- G02 PostgreSQL suite: 241 PASS assertions, including concurrency cases.
- Lint, TypeScript, Node runner syntax and git diff --check: passed.
- Independent static review performed; manager verified actual runtime results.
  A review report alone is not runtime proof.

## Remaining gates

No production deployment, config/allowlist change, real-user data test, commit,
push, PR/issue mutation or merge occurred. The pilot remains deny-by-default in
the migration. This local backend matrix is not production acceptance or a claim
that every roadmap group is implemented. Actual Google login, email-code/link
delivery, browser/mobile interaction and visual QA, platform advisors, and any
ordinary sign-out/session-revocation guarantee remain separate checks. Do not
claim auth.sessions invalidation from the allowlist/ban tests.

## Reproduction

Use a new temporary CLI project with the basename pattern
creditbook-g01-supabase.<random>, CLI 2.75.0, no linked ref, local API port 54321
and database 54322. Enable anonymous sign-in in this disposable config only.
Create a task-owned Docker bridge with host_binding_ipv4=127.0.0.1 and start
the CLI project on it, excluding realtime, storage-api, imgproxy, mailpit,
postgres-meta, studio, edge-runtime, logflare, vector and supavisor. Check that
no existing service uses these ports. Then from the actual repo run:

    node scripts/test-personal-supabase-http.mjs /private/tmp/creditbook-g01-supabase.<random>

The runner refuses non-local/linked/non-fresh targets. After an attempted run
that passed the fresh-target guards, it cleans only that test project on success
or failure; start a fresh empty instance before retrying. Never substitute the
production project/DSN or reuse an existing database.

Evidence log: /private/tmp/creditbook-g01-real-http-test.log (PASS labels only).

## Primary references

- https://supabase.com/docs/guides/local-development/cli/getting-started
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/reference/javascript/auth-signinwithpassword
