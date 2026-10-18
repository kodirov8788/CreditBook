# Personal account journey — G01/G02 integration

This slice builds on draft PRs #104 → #105 → #106. It does not merge that stack
or claim all roadmap groups are complete. Earlier documents describing G01/G02
as unapplied describe their historical validation stage: versions 20261017011017
and 20261017031547 were applied and tested on production on 2026-10-18.

## User journey

- Root uses the existing verified shop lookup. A successful no-shop result opens
  `/personal`; shop errors remain errors, and explicit shop routes retain their
  existing behavior. Invite activation/callback ordering is unchanged.
- Personal onboarding reuses GET/POST `/api/personal/workspace`; GET never
  provisions, and the explicit POST creates/reuses the owner workspace.
- GET/POST `/api/personal/accounts` reads reconciled accounts or invokes the
  existing atomic opening RPC. PATCH `/api/personal/accounts/:id` invokes the
  new guarded management command. GET `/:id/postings` provides owner-only history.
- The Uzbek form supports UZS/JPY/USD, exact signed opening balances, icon,
  color, inclusion preference and local dates in the stored workspace timezone.
- Account controls rename, change appearance/inclusion, select a default,
  archive/unarchive and view history. No financial delete or arbitrary balance
  edit exists. Opening is counted once in balance and never presented as income.

## Monetary and concurrency rules

PostgreSQL aggregates complete owner-visible postings before account pagination.
Individual balances and same-currency totals are JSON strings; currencies remain
separate. Active included funds and archived funds are shown separately. Archive
does not change the inclusion preference or any financial posting. This is a
presentation split, not deletion or revaluation of money.

The read API pages 50 accounts and reports `paginationLimitReached` rather than
an invalid next link above offset 100000; totals still cover all accounts. The
history API returns 50 entries plus its next offset. This G02 UI currently shows
the first history page; complete filtered personal history remains G07 work.

All management commands lock the same workspace used by account creation, then
verify account and preference versions. A stale command returns 409. Required
account/default changes, immutable command receipt and audit event commit
together. The oldest active account replaces an archived default; the final
archive clears it; unarchive repairs an empty default. Archived accounts cannot
be edited until explicitly unarchived.

## Uncertain requests

Before a mutation, an immutable command and UUID-v4 key are saved in a versioned,
owner-scoped **sessionStorage** journal. Reload and reauthentication in that tab
reuse the key/payload; another signed-in user does not restore that user's draft.
Restoration runs before network requests. Create fields convert minor units back
to decimal form values; management journals never overwrite creation defaults.
No access token, refresh token, password or service key is stored in this journal.

Successful/replayed commands remove the journal. Unknown outcomes and later
401/403 failures preserve it; a definitive validation error allows correction.
An unavailable/corrupt journal blocks a new mutation instead of silently
discarding an uncertain operation. Creation succeeds independently of a later
list-refresh error, which asks for refresh rather than another new submission.

This is an in-tab mutation recovery mechanism, not cross-device/offline sync.
Closing the tab clears browser sessionStorage. Broader durable/offline draft
retention, shared-device privacy and reconciliation remain G15 design work.

## Validation actually performed

- `npm run test:api`: **172 passed**, including existing auth callback/invite
  tests, owner HTTP boundaries, exact string values, invalid UUIDs and routing.
- `npm run typecheck`, `npm run lint`: passed.
- `scripts/test-personal-account-db.sh`: **150 SQL assertions passed** on a
  pinned disposable PostgreSQL image with no network or production credentials.
  Includes real two-owner management denial through public/private functions,
  >JS-safe-integer aggregates, pagination, archive/default reconciliation,
  replay/conflict, same-version concurrency and injected audit-failure rollback.
- `scripts/test-personal-workspace-db.sh`: **38 assertions passed**.
- Five mobile Chrome fixture tests passed: no-shop routing and exact creation;
  commit/lost-response/reload/replay without duplication; workspace network failure
  during journal restoration; management/history; and the two restore regressions.
  Existing dedicated synthetic Auth user was used; account read/write outcomes
  were intercepted fixtures. These are not live personal account API acceptance.
- `npm run build`: passed for the final tree, including account controls and history routes.

Independent review found journal lifetime/restore and pagination defects, a
malformed UUID boundary and missing management isolation/atomicity test coverage.
They were addressed with regressions and bounded re-review. Reviewer observations
do not substitute for runtime verification.

## Production/release gates

Prepared local migrations:

1. `20261018060819_personal_account_read_model`: invoker/owner-only read aggregate.
2. `20261018061919_personal_account_management`: guarded metadata/default/archive
   commands with immutable audit/receipts; no financial record deletion.

The first migration's production application was **denied by automatic approval
review**, which requires explicit approval for that exact schema change. It was
not executed or retried through another surface. The second migration has only
been applied in disposable tests. Both remain pending production approval and
must be applied in dependency order after current history/source checks.

No app deployment or PR merge occurred in this implementation slice. Current
production still serves main; the new HTTP/UI paths are local. After approved
migrations, verify real authenticated local/preview APIs with both synthetic
owners, preserve production fingerprints, then prepare a reviewed source release.
Do not blindly merge the draft stack or close G01/G02 from fixture evidence.

## Remaining decisions and groups

G03's insufficient-balance/overdraft policy is awaiting a user answer. Do not
invent it when implementing expenses or transfers. Audited correction semantics
also require a bounded accepted contract. G03/G05/G04 follow this G02 work in
dependency order. Notification delivery, speech provider/cost/audio retention,
backup restore and offline behavior remain later explicit decisions; no paid
provider or broader credential/access grant was introduced.
