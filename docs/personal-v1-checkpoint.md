# Personal V1 continuation checkpoint

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
