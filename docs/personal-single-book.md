# G02 first single-book slice — 2026-10-19

Work based on G01 commit 42f7ac0 / draft PR #109. User approved commit/push and
requested production merge on 2026-10-19. Publishing this bounded draft does not
waive the outstanding acceptance and database rollout gates below. No merge or
cloud migration/configuration change has occurred.

## Implemented locally

- New public personal_books mapping: one immutable workspace/account relationship,
  composite same-workspace JPY/scale-0 FK, owner/pilot RLS, no client/service DML.
- New insert triggers protect EVERY account creation path, including the legacy
  public and private helpers. They serialize on the existing workspace lock,
  refuse additional accounts even after archive, and atomically register a fresh
  JPY/Asia-Tokyo book. Existing account currency/history is never changed.
- Existing same-key create receipts still replay without another INSERT. A changed
  payload conflicts; fresh distinct keys cannot create another book.
- No mapping backfill. Existing accounts produce LEGACY_SETUP_REQUIRED. Explicit
  adoption/start-fresh is intentionally not implemented here; no money is guessed,
  converted or combined. Legacy read/management APIs remain available to owners.
- GET/POST /api/personal/book use the G01 verified-session/pilot gate. Initialization
  delegates existing atomic opening/audit/receipt handling, uses JPY and Tokyo,
  and accepts only an exact signed opening string and effective date.
- The personal page now displays one balance and a zero-default signed-opening
  confirmation form. Tokyo today is captured in the owner-scoped retry payload;
  retry preserves key/date/amount. New read requests supersede stale responses.
  Cash and expense are displayed defaults, not extra funded accounts.
- Old account-command session data is not deleted or silently resubmitted. The
  new form blocks on an unresolved older command and requires reconciliation.
- DEFAULT_CURRENCY is JPY; supported currency scales and legacy balances remain
  unchanged. USD/UZS original entries and historical FX are NOT implemented here.

## Verification

- API/pure suite: 15 files, 271 tests passed, including 34 new book cases and
  two compatibility-route conflict cases. These are mocked HTTP / pure tests.
- Typecheck, lint and diff whitespace checks passed.
- Production-mode LOCAL Next build passed after allowing the existing Google
  font download. The first sandboxed attempt failed only at that network fetch.
- Account SQL harness: 295 PASS assertions (241 historical/G01 + 54 G02).
  Includes same-key and different-key parallel initialization, zero/signed exact
  openings, public/private legacy bypass denial, post-archive single-slot behavior,
  composite FK, grants/RLS, revocation, audit-failure rollback and same-key recovery.
- Workspace SQL harness: 181 PASS assertions (137 historical/G01 + 44 G02).
- A third SQL session observed two live contender sessions and an actual lock
  wait in BOTH same-key and distinct-key rounds; it fails if overlap is not seen.
- Fixed a test-runner startup race: wait for the final in-container TCP server,
  not the temporary Unix-socket bootstrap server that restarts during setup.
- Independent source review found a restored terminal-conflict retry trap; it
  was fixed with typed conflict handling and six additional pure regression cases.
- Final bounded re-review found no open P1/P2 in G02 core code or the deterministic
  overlap proof. The reviewer did not run the tests; the manager verified exit 0
  and final assertion counts directly. G01 runner ownership remains unresolved.
- SQL runs create their own unique network-none containers, no env file/cloud DSN
  or host ports; only that created container is removed by EXIT cleanup.
- No new dependency or GitHub Actions. Supabase CLI 2.75.0 cannot run advisors;
  no cloud advisor was substituted. The migration filename was CLI-generated.

## Remaining acceptance boundaries

The earlier 122-check real Supabase HTTP evidence belongs to G01, NOT G02.
That runner currently has an independent ownership-safety finding; do not run it
until fixed. It also still expects the historical multi-account flow and must
be updated deliberately for G02. Existing personal journey E2E tests describe
the historical account UI and must be replaced with book scenarios before use.

No interactive mobile/browser screenshot, device test, real G02 GoTrue/PostgREST
HTTP acceptance, Google/email delivery or hosted configuration acceptance in this
slice. A successful build is not any of those checks.

Income/expense posting, monthly totals and opening exclusion from monthly income
need G03; do not present fabricated monthly zeroes. Original-currency entries and
JPY valuation need G17. This slice does not complete #89 or personal V1. Base
currency settings after first use, explicit legacy setup and full legacy-history
navigation also remain unimplemented. No issue was closed.

## Primary source reviewed

https://supabase.com/docs/guides/database/postgres/row-level-security
Use explicit grants AND RLS; invoker read RPCs preserve row policies. No new
SECURITY DEFINER function is introduced in this slice.

## Changed-file inventory (21 local files)

- app/api/personal/accounts/route.ts
- app/api/personal/book/route.ts (new)
- app/personal/page.tsx
- components/personal/book.tsx (new)
- docs/personal-pilot-http-acceptance.md
- docs/personal-single-book.md (new)
- docs/personal-v1-checkpoint.md
- lib/personal-finance/book.ts (new)
- lib/personal-finance/types.ts
- scripts/test-personal-account-db.sh
- scripts/test-personal-workspace-db.sh
- supabase/migrations/20261019063444_personal_single_book.sql (new)
- tests/api/personal-accounts.test.ts
- tests/api/personal-book.test.ts (new)
- tests/api/personal-money.test.ts
- tests/api/personal-page-access.test.ts
- tests/database/personal-book-before.sql (new)
- tests/database/personal-book-concurrent-check.sql (new)
- tests/database/personal-book-concurrent-observe.sql (new)
- tests/database/personal-book-concurrent.sql (new)
- tests/database/personal-book.sql (new)
