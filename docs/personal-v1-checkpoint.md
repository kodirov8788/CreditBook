# Personal V1 continuation checkpoint

## Latest verified release — 2026-10-25 bug audit

This section supersedes the historical implementation/release state below.

- Scope: user-authorized read-only audit, focused local fixes/tests, and deployment
  only to `creditbook-personal`. Auth configuration/credentials, existing records,
  hosted schemas, Supabase, old shop production and QA project were not changed.
- Baseline: `codex/personal-compact-a-receipt-tax`, HEAD `b20e428b97092d5fb0d6078ac758ad35eddb5480`;
  same source tree as merged `49db751c6617524ce317961529b393a1c4815ff4`.
  At audit completion the bug fixes were uncommitted. Follow-up publication is
  explicitly authorized on `codex/personal-reliability-fixes`, targeting
  `codex/issue-89-single-book`; merge is outside this follow-up scope.
  The runtime below is unchanged for the commit-backed redeployment.
- Verified defects fixed: old Home Screen `/dashboard` launch returned404;
  missing manifest icons; disabled pinch zoom; cross-tab read owner could remain
  bound to the previous account; cursor JSON aggregation lacked explicit ordering;
  provider credential/credit/rate failures were reported as unreliable model output.
- Runtime files: `app/layout.tsx`, `app/manifest.ts`, `proxy.ts`,
  `components/personal/neon-wallet.tsx`, `components/personal/voice-entry.tsx`,
  `lib/ai/voice-provider.ts`, `lib/api/neon-voice.ts`,
  `lib/data/neon-personal-ledger.ts`, and three `public/icons/*.png` assets.
  Tests: updated `voice-provider.test.ts`; added `personal-launch.test.ts`,
  `personal-ledger-order.test.ts`, `neon-voice-errors.test.ts` under `tests/api/`.
- Verification actually run:729 unit/API tests in43 files passed; TypeScript and
  lint passed; isolated webpack production build passed; full npm audit0.
  Build retains known transitive Better Auth peer/deprecation warnings, and local
  multi-lockfile workspace-root and Vite future-loader warnings; these are not
  represented as security findings or silently suppressed.
- Two independent read-only reviewers checked the frontend owner reset and SQL/
  provider changes. Frozen write intents retain their original owner; generation
  checks and cancellation remain intact. No blocking issue found in those hunks.
- Local browser evidence uses the actual components with synthetic Auth/API:
  A→B without reload, rapid A→B with delayed A snapshot, logout private-data removal,
  and actionable provider503 without user logout passed. No real Auth/DB/AI calls
  were made by that fixture. Mobile frames318×548 and388×632, desktop1022×766:
  no horizontal overflow; voice button within first viewport. Physical iPhone,
  microphone/audio capture and paid AI analysis were NOT tested this turn.
- PostgreSQL integration was attempted but not run: installed libpq has no
  postgres server binary; existing Docker daemon is stopped. No image/dependency
  was downloaded and no existing DB was started/reset. Pagination proof is the
  generated-SQL contract test plus review, NOT a fresh1000-row DB acceptance.
- Deployment: `dpl_CEgT4TCW43vFJcqh9eRGi9cKhc3C`,
  `https://creditbook-personal-nis8zdvj5-kodirov8788s-projects.vercel.app`,
  aliased `https://creditbook-personal.vercel.app`.
  170-file artifact SHA256:
  `9193d071d2f4a61b7856cddb3523c46d3082b4401431cf51c9db0b3e5f914dab`.
  Manifest includes source hashes; source-stage drift after build/deploy: none.
- Live HTTP proof: manifest starts `/personal`;192/512/180 PNGs200 and correct
  dimensions; old `/dashboard`307→`/personal`, private/no-store; admin and QA gates404.
  Authenticated wallet and category views loaded; rapid month changes returned to
  selected October; console error count0. Voice button bottom538 at418×634.
- Record preservation: visible11 October entries, balance and monthly totals had
  identical before/after hashes; zero financial saves, zero external AI requests.
  This is UI/history preservation proof, not a fresh authoritative whole-DB count.
- Evidence in sibling recovered checkout `qa/security-2026-10-24/`:
  `bugfix-2026-10-25-manifest.json`, `bugfix-2026-10-25-acceptance.json`,
  `bugfix-provider-error-local.png`. Evidence contains hashes/counts, no credentials
  or raw financial histories. Local fixture: sibling `creditbook-bugfix-local-2026-10-25`.
- Remaining next action: run exact SQL pagination over50/1000+ synthetic rows once
  an approved disposable local PostgreSQL runtime is available. Review remaining
  product acceptance separately; no claim that every possible bug is eliminated.
- Rollback: only this Vercel project can return to preceding deployment
  `dpl_FqCzEfVPcycPou35C8xphVnTERDr`; no schema or business-data rollback is needed.

## Historical checkpoint

Updated: 2026-10-19 (Asia/Tokyo), G02 publication approved; production readiness review.
This checkpoint supersedes the earlier G01 pre-commit handoff.

## Current state
- Roadmap #87 / G01 #88; historical FX #108.
- Actual checkout: /private/tmp/creditbook-g01; current local working branch
  codex/issue-89-single-book, based on G01 commit 42f7ac0.
- G01 is committed and pushed on codex/issue-88-pilot-access in draft PR #109,
  stacked on #107. Do not reapply or recommit the original 23-file G01 batch.
- Draft stacked PRs #104–#107 remain unchanged. G02 changes are local/uncommitted.
- User explicitly approved this local allowlist/RLS implementation and tests;
  production and existing shop data must remain untouched. Fresh-action gates
  still apply to concrete external mutations.
- Latest user explicitly requests push and production merge. Publish the bounded
  reviewed G02 slice; do not bypass readiness, authoritative count-only preflight,
  backup/recovery or separately required exact schema/data approval gates.

## Local implementation
The previous application slice guards the personal page and all six HTTP handlers.
Only the no-argument scalar boolean permission RPC grants access; metadata/email
never grant authority. API errors are private/no-store 503, explicit denial 403.
The force-dynamic page renders a non-financial denial/retry view (normal HTTP 200),
not an authorized session/health signal.

CLI-created migration 20261019055603_personal_pilot_access.sql adds a private UUID
allowlist with RLS and no client/API-service table grants. It tightens the existing
personal-only is_current_account_active() predicate with allowlist enabled status
and current ban, anonymous and soft-delete checks; existing personal RLS policies
and direct private create/manage/read helpers already use that predicate. A public
authenticated-only invoker wrapper supplies the application contract. No real user
identity is enrolled. No shop/signup/invitation function, policy or trigger is changed.

Both DB runners verify historical contracts at the pre-pilot boundary, then apply
the gate and any later migrations in timestamp order before final-state security
tests. New fixtures compare exact existing application rows, role permissions,
audit logs, personal audit/receipts and existing public function/shop-policy/trigger
definitions. They test approved/denied owners, platform admin without permission,
metadata spoofing, direct table/private RPC paths, revocation and replay, same
subject after ban/soft deletion, anonymous/missing identity, workspace suspension,
exact writes/idempotency, preserved shop access/cross-shop boundaries/invites and
the real SQL auth insert trigger. Only disposable synthetic records are mutated.

## Historical G01 verification (before commit 42f7ac0)
- `node scripts/test-personal-supabase-http.mjs <disposable-local-workdir>`:
  **122 assertions passed**, final process exit 0 and scoped cleanup succeeded.
  Real GoTrue signup/password login, signed ordinary/anonymous JWTs, PostgREST,
  all six Next personal handler methods, SSR cookie sessions and production-mode
  page cache headers were exercised without mocks. Detailed matrix and isolation:
  `docs/personal-pilot-http-acceptance.md`.
- npm run test:api: 14 files / 235 tests passed.
- npm run typecheck, npm run lint and npm run build: passed.
- bash scripts/test-personal-workspace-db.sh: passed, 137 PASS assertions
  (46 foundation + 91 final pilot).
- bash scripts/test-personal-account-db.sh: passed, 241 PASS assertions
  (150 account/read/management/concurrency + 91 final pilot).
- bash -n for both runners and final git diff --check: passed.
- Pinned PostgreSQL image ran in fresh --network none containers without host
  ports, volumes, cloud DSN or env-file access. EXIT cleanup completed: only these
  temporary synthetic databases were removed, not existing databases.
- Independent static review: no critical bypass found. Runner-order fragility
  and omitted permissions/audit snapshots were corrected and both suites rerun.
  A focused follow-up reviewed the added soft-delete guard with no new issue.
- An expanded fixture initially used nonexistent customers.read; corrected to
  the actual customer.read contract and reran successfully. Existing Vite
  config-loader warning remains; no dependencies or Actions were added.
- Real CLI fresh replay exposed absent platform-only rls_auto_enable(). Narrow
  conditional revoke now handles both absent real-local and present SQL-fixture
  cases. Historical migration source changed locally only; no applied production
  history was rewritten. Independent static review approved that bounded fix.
- HTTP test process has allowlisted env and stages source without dotenv files;
  uses installed dependencies, local public key and Auth-issued tokens only.
  Real CLI requires a separate loopback-published bridge (not network-none).
- Independent reviewer found no critical source-level defect. Its final runtime
  caveat and suggested anonymous Next case were resolved by the manager's final
  exit-0 run: the script includes the real anonymous Next request and it passed.

## Evidence limitations / release gates
The PostgreSQL-only suites still use a subject/role fixture. The NEW 122-check
matrix independently covers real local GoTrue login/JWT verification, REST and
production-mode Next HTTP/cookie behavior. No interactive browser/mobile/device
test, real Google OAuth or delivered email-code/invite-link test was run. Real
local SQL signup/invite RPCs passed, not external provider/email delivery.
No platform advisor/cloud configuration call was made. Local catalog assertions
do not replace platform advisors. Ordinary logout/session revocation is not
validated against auth.sessions; no instant invalidation of every unexpired JWT
after sign-out is claimed. Gate revocation applies at subsequent SQL snapshots,
not retroactively to an already-running statement.
Production contract/configuration was not checked or changed in this run. The migration defaults to
denying everyone until an approved DB-admin operation enrols the intended verified
Auth UUID. Empty non-pilot workspaces are hidden, not deleted. Do not deploy the
application alone, mark G01 fully accepted or silently alter signup/shop policy.
No commit/push/PR mutation occurred during those tests. Subsequent user-approved
publication produced commit 42f7ac0 and draft #109; no merge or production action.

## Files touched in the previous database slice
- supabase/migrations/20261019055603_personal_pilot_access.sql (new)
- tests/database/auth-fixture.sql (soft-delete field matching upstream Auth)
- tests/database/personal-pilot-before.sql (new)
- tests/database/personal-pilot.sql (new)
- scripts/test-personal-workspace-db.sh
- scripts/test-personal-account-db.sh
- docs/personal-pilot-access.md
- docs/personal-v1-checkpoint.md

## Files touched in this HTTP acceptance slice
- scripts/test-personal-supabase-http.mjs (new)
- supabase/migrations/202608150010_security_hardening.sql (conditional platform-function revoke)
- docs/personal-pilot-http-acceptance.md (new)
- docs/personal-pilot-access.md
- docs/personal-v1-checkpoint.md

Temporary CLI configuration enabled anonymous sign-in only for synthetic tests.
Its test containers/volumes and owned staged Next app were cleaned; Docker images
remain cached. The sanitized acceptance log is /private/tmp/creditbook-g01-real-http-test.log.
The initial dev probe temporarily regenerated next-env.d.ts imports; restored
those two generated lines to the starting version. It has no remaining diff.
Both task-owned empty bridges and the local-key startup log were removed.

Local synthetic logs:
- /private/tmp/creditbook-g01-pilot-workspace-test.log
- /private/tmp/creditbook-g01-pilot-account-test.log

## Next ready work
### Stack reconciliation: 2026-10-19 continuation
- Live GitHub file lists confirm draft dependency order #104 -> #105 -> #106
  -> #107. The current G01 guard targets routes introduced across this stack;
  it is not a standalone patch against main. No GitHub mutation was performed.
- Current local source still defaults to UZS in lib/personal-finance/types.ts
  and components/personal/accounts.tsx, and exposes multiple account creation.
  G02 must reconcile this with the accepted one-visible-book / JPY default
  without rewriting or combining legacy records. Do not merge the draft stack
  as a finished personal V1 release.
- The complete pending G01 batch is 23 files (13 tracked modifications and
  10 new files), including the guarded historical compatibility revoke and
  real-local test runner. No implementation change was made during this review;
  only this checkpoint was updated. git diff --check passed again.
- Existing sanitized HTTP evidence was read back: 122 passed, exit-success
  result and scoped cleanup recorded. Tests were not rerun without code changes.
- Completed with separate explicit user approvals: G01 commit 42f7ac0, push and
  draft PR #109 targeting codex/personal-account-journey (#107). These approvals
  do not authorize another commit/push or any merge/production operation.

1. Real local Auth/PostgREST and production-mode Next HTTP/page/cache coverage is
   complete for the documented 122-check matrix; do not repeat the whole setup
   without a source change or missing evidence. Interactive browser/mobile flows
   and external provider/email acceptance remain separately scoped checks.
2. Independent review of committed #109 found no current guard/RLS bypass, but
   found two P2 issues: a caller-supplied fresh HTTP-test target is not proven
   runner-owned, and stale handoff wording. The docs are corrected locally;
   the HTTP-runner ownership issue remains a blocker. Do NOT run that script.
3. User approved local G02 work after review. New book mapping/trigger, guarded
   book API and single-book JPY/Tokyo UI are implemented locally. Preserve all
   dirty G02 changes; see docs/personal-single-book.md for files and proof.
4. G02 API/pure suite: 271 passed; typecheck/lint passed; final local Next build
   passed after an initial font-fetch permission retry. Account SQL harness:
   295 PASS assertions, including two observed actual lock-contention rounds;
   workspace SQL harness: 181 PASS assertions. Fixed bootstrap readiness race
   in both runners and reran. Independent G02 review found a restored terminal
   conflict retry trap; fixed locally and covered by six additional cases.
   Final bounded source re-review found no remaining G02 P1/P2; the manager
   verified completed runner exit codes/counts, not just the reviewer's report.
5. Next: fix the G01 HTTP-runner ownership issue before real HTTP reruns, adapt
   HTTP/E2E scenarios to the book UI, then verify G02 real HTTP/mobile acceptance.
   Explicit legacy setup and G03 posting/monthly reports remain incomplete.
   G02 commit/push and stacked draft PR publication are now user-approved.
   Production merge was requested, but remains gated by unresolved real HTTP /
   mobile proof and database rollout prerequisites. No schema/data operation or
   merge has been performed under this publication step.

Resume from the G02 dirty worktree, NOT by repeating the already-published G01
commit. No concurrent writer should edit this slice.
No secrets, real account identity or raw private transcripts belong here.

### 2026-10-19 — Bounded dashboard/report page-capacity performance slice

- User authorized local performance changes and >1000-row HTTP/Chrome checks;
  expressly prohibited commit, push and production. Baseline branch remains
  codex/issue-89-single-book, HEAD c1b4c9af588b2f1fe17357cac9b645f3281d79a0.
  All pre-existing dirty changes were preserved; no hosted service was used.
- Root cause: the client fetched100-row keyset pages serially, recomputing full
  tenant SQL aggregates12 times for1105 rows. The client now requests bounded
  1000-row pages (two calls for1105; pagination continues beyond2000). Global
  numeric totals still come from SQL, never sums of truncated client pages.
  No cache, RLS bypass, policy/index/table/data change or dependency was added.
- New CLI-generated additive migration20261019140721 replaces the two read
  functions with max1000 instead of200. Defaults100, permission predicates,
  SECURITY INVOKER, explicit search_path, grants and every financial formula
  remain unchanged. Original20261019132245 checksum stays
  7036d2a9708bbbf8a711dd90b3cee72468e66edc7045452745ac40628b46ffaa.
  Forward order: migration first, app second. Rollback: old client100 first,
  then original definitions with CREATE OR REPLACE, preserving grants/records;
  never replay original CREATE FUNCTION or drop functions. Only NEW owned
  disposable local databases received migrations.
- Full685 unit/API assertions in32 files passed, including exact1000,
  1105/two calls,2105/three calls, oversized1001 rejection, old error/metadata/
  tenant/deadline contracts. Types and full lint passed. Real PostgreSQL35
  assertions passed, including cap1000/reject1001 for both functions and
  non-destructive rollback200/roll-forward1000 rehearsal. Fixture-security
  helpers15/15 passed after approved loopback-listen escalation; first sandbox
  attempt was14/15 with EPERM on127.0.0.1:4390, not a feature failure.
- Paired real HTTP benchmark uses the SAME fresh schema/data/Auth environment,
  builds one isolated app with PAGE_SIZE100 then PAGE_SIZE1000; three requests
  per endpoint/version, every full response body deep-equal. First run medians:
  dashboard7989→1383ms (samples8965/7958/7989 vs1384/1383/1342), report4445→772ms
  (4460/4445/4433 vs776/746/772). This is observational local smoke evidence,
  not a production SLO: sequential runs and warm database caches affect timing.
  A lower-median gate was added after that run and its two predicates separately
  passed against the captured raw timings; final full-harness rerun below.
- First real Auth/REST/Next run33 assertions passed; >1000 cap confirmed by
  raw REST returning1000, app returned all1105 customers and1105 active expenses.
  Exact dashboard outstanding66289.99/collection44310.01, report collection
  44320.01/expenses2210/net42110.01; void/cancelled/date behavior preserved.
  Two actual JWT tenants isolated; unauthenticated RPC denied. Previous report
  latest-response-wins behavior passed actual HTTP out-of-order test again.
- Chrome manager acceptance: actual password-form login; DOM counts1105
  customer-detail buttons and1105 expense cancel buttons, confirming complete
  rendered lists (AX's500-item presentation cap is NOT app truncation).
  Customer105 search succeeded; full metrics matched rounded UI; rapid
  yesterday range cleared old totals, then showed zero period with retained
  all-time balance; reload retained login and restored current-month report.
  Logged out, logged into second tenant and verified dashboard/report all zero;
  no first-tenant data leaked. Logged out and closed only owned QA tab.
- Manager visually inspected /private/tmp/creditbook-performance-report-1105.jpg;
  other evidence: /private/tmp/creditbook-performance-dashboard-1105.jpg and
  /private/tmp/creditbook-performance-isolation.jpg. Desktop Chrome only, no
  mobile hardware/Safari/production proof. All UI writes avoided. Fixture
  record counts unchanged; first-run cleanup completed and independently
  verified no remaining Supabase containers/volumes or owned app directory.
- Logs: /private/tmp/creditbook-performance-http.log,
  /private/tmp/creditbook-performance-sql.log,
  /private/tmp/creditbook-performance-unit.log,
  /private/tmp/creditbook-performance-helper.log. Existing Vite config-loader
  and native Node typeless-package warnings remain; no suppression/type change.
- Independent critic found ambiguous rollback wording and missing timing gate;
  both corrected/reviewed; no remaining scoped code blocker. Larger tenants
  still require all flat lists in server/client memory and repeat aggregates
  per page, so this does NOT prove unlimited scalability or zero loading time.
- Files touched ONLY in this slice: lib/shop-read-model.ts;
  supabase/migrations/20261019140721_shop_read_page_capacity.sql;
  tests/api/shop-read-model.test.ts; tests/api/routes.test.ts;
  tests/database/shop-read-model.sql; scripts/test-shop-read-http.mjs;
  docs/personal-v1-checkpoint.md. No commit/push/merge/deployment/automation,
  real-user records, hosted configuration, or production schema/data changes.
- Final reviewed-harness rerun: /private/tmp/creditbook-performance-final-http.log.
  Both explicit median gates passed in the full run: dashboard7916→1358ms
  (9023/7916/7831 vs1436/1358/1357); report4350→749ms
  (4350/4438/4312 vs769/744/749). Both are about83% lower latency in this local
  single-machine fixture, not a hosted/device performance guarantee. Rebuilt
  baseline100 and optimized1000 apps successfully with existing dependencies.
  Full685 unit/API, types and lint rerun passed after review corrections.
- Final reviewed HTTP harness35/35 passed, including in-harness lower-median
  gates, exact deep equality, complete1105-row lists, real JWT/Auth/REST tenant
  checks, report-date race, SSR and record-count preservation. Chrome again
  verified1105/1105 DOM rows, correct dashboard/report totals, cleared loading
  state and last-request date result; then logged out/closed owned tab. Final
  screenshots /private/tmp/creditbook-performance-final-dashboard.jpg and
  /private/tmp/creditbook-performance-final-report.jpg. Manager inspected the
  final dashboard screenshot; first-run full report was also inspected.
- Final fixture runner exit0 and ownership-verified cleanup completed. Independent
  Docker inventories showed no remaining Supabase containers/volumes, and the
  final owned app directory was absent. No existing database was reset/deleted.

### 2026-10-19 — Pre-publication review: blocked on shop-date consistency

- User approved review/commit/push to codex/issue-89-single-book only, explicitly
  no merge/production. Prepared a selective27-file index/export excluding dirty
  G03/G05 features/migrations, category navigation, generated next-env changes,
  and unrelated personal HTTP runner work. Exported snapshot:
  /private/tmp/creditbook-publish-review.gL8dTf/snapshot. Working files preserved.
- Exported subset passed376 API tests in23 files, typecheck and full lint;
  11 owned-fixture safety tests and35 isolated SQL/RLS checks passed. Original
  full-working-tree685-test result is not claimed as subset acceptance.
- Independent critic found P1: SQL/dashboard/report overdue aggregate uses UTC
  day, while getCustomerStatus parses a date at browser-local23:59:59. Manager
  reproduced with unchanged code: at2026-10-19T16:00Z, due2026-10-19,
  TZ=Asia/Tokyo row is overdue but SQL UTC overdue=false; sameinstant TZ=UTC row
  is due-soon. This must be resolved before publication. No new source fix yet.
- Proposed smallest next step (requires user approval): keep existing shop SQL
  UTC semantics; align lib/customer-status.ts and add non-UTC midnight-boundary
  regression tests. Personal Tokyo effective-date rules remain unchanged.
- HEAD remains c1b4c9af588b2f1fe17357cac9b645f3281d79a0; no commit/push/merge,
  hosted schema/data action, deployment or GitHub issue/PR mutation performed.
  Vercel project/production alias inspected READ-ONLY; production alias still
  points to dpl_Cxa5axYh9TVJBFkGpiS2RoN1Cp39 at pre-publication inspection.
- Exact exported-subset HTTP harness35/35 passed with unchanged fixture record
  counts, two-tenant isolation, full1105-row API/SSR results, report-order guard,
  and local median gates. Chrome ordinary-date login/dashboard/report counts
 1105/1105 matched; screenshot /private/tmp/creditbook-publish-review-report.jpg.
  These checks do NOT cover/resolve the separately reproduced midnight P1.
  Runner exit0; only newly owned app/Supabase fixture cleaned. Publication
  remains blocked pending the smallest new date-consistency fix approval.

### 2026-10-19 — Approved UTC status correction and branch-only publication

- Fresh explicit user approval: align shop status with existing UTC aggregates,
  add/check midnight tests, retain personal Asia/Tokyo, then commit/push ONLY
  codex/issue-89-single-book. No merge, deployment or production schema/data.
- lib/customer-status.ts now parses due-day end as23:59:59.999Z, not browser-local
  time. Other status rules remain: paid for balance<=0, undated on-track, existing
  seven-day rolling due-soon threshold. No migration/data/math changes here.
- tests/api/customer-status.test.ts adds12 tests: UTC last millisecond and next
  midnight, Tokyo-local midnight before UTC midnight, LosAngeles-local evening
  after UTC midnight, paid/undated/future behavior; separate native Node processes
  in UTC/Asia/Tokyo/Asia/Tashkent/America/Los_Angeles confirm state equals the SQL
  UTC overdue predicate. A personal localDate/BOOK_TIME_ZONE regression verifies
  Tokyo20October while the shop due19October is still not overdue at16:00UTC.
  Initial test passed a Date instead of the existing localDate(timeZone) API;
  corrected the test to use its real signature and mocked clock before final runs.
- Final full working tree697 unit/API tests in33 files passed; isolated selected
  commit388 in24 files passed. These are different scopes, not interchangeable.
  Scoped typecheck/lint passed. Previous exact subset35 SQL/11 fixture-safety and
  35 real local Auth/REST/Next assertions remain applicable to unchanged SQL/HTTP
  code; the new timezone behavior has separate actual-process midnight evidence.
- Publication package remains selective29 files: prior27 plus status helper/test;
  excludes G03/G05 implementations/migrations/navigation, generated next-env and
  unrelated personal HTTP runner changes. No secret/env/provider activation,
  dependency install, issue closure, PR creation or migration execution requested.
  Build runs from exported selected snapshot with scrubbed environment and no
  dotenv/hosted credentials. Commit/push results are recorded only after success.
- Independent reviewer re-ran12/12 targeted tests and found no remaining P1 in
  the approved UTC correction. Personal timezone modules have no diff.
- Scrubbed-environment build initially hit sandbox Google Fonts DNS restrictions;
  an approved network-enabled retry in the reused snapshot then hit an existing
  next/font Google loader error. A NEW clean selected export at
  /private/tmp/creditbook-utc-build.PPSFy4 built successfully with Next16.3.1
  webpack, existing dependencies, no dotenv/hosted credentials. Thus final clean
  build passed; earlier failed attempts are not represented as successful.
  Logs: /private/tmp/creditbook-utc-clean-build.log,
  /private/tmp/creditbook-utc-publish-unit.log (388),
  /private/tmp/creditbook-utc-all-unit.log (697).
