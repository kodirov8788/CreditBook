# G02-S2a: local account/opening foundation

This is a local, uncommitted slice stacked on `2216d7d` (G02 contract / draft
PR #105). It does not complete G02/G03. G01's production/UI release blocker
remains in force. Do not independently deploy or apply these migrations.

## Scope and approved decisions

- Create a personal account and exactly one signed opening posting, including zero.
- Maximum absolute opening/account balance: one trillion major currency units.
  UZS/USD scale 2: `100000000000000` minor units. JPY scale 0:
  `1000000000000`. These are not the older fixture-only limits in G02-S1.
- No future opening dates. A valid ISO calendar date is checked against the
  workspace's stored time zone, never the server's UTC/current_date setting.
- Owner-only reads; no implicit access for platform administrators.
- Atomic account, opening, first-default selection, audit and idempotency receipt.
- No authenticated direct table INSERT/UPDATE/DELETE. No service-key mutation path.

No HTTP route, account UI, archive/unarchive/default-change endpoint, income,
expense, correction, transfer or financial reporting is implemented in this slice.
Those remain separately scoped work. `status` and default-account constraints
prepare for later archive handling but are not a working archive feature.

## RPC contract

`public.create_personal_account(p_command jsonb, p_client_key uuid)`

Required command fields: `name`, `currencyCode` (UZS/JPY/USD),
`openingAmountMinor` (canonical integer STRING), `openingDate` (YYYY-MM-DD),
`timeZone` (a named zone recognized by PostgreSQL). The caller submits an explicit
date; a later UI will prefill the user's local today and preserve it across retries.

Optional: `icon` (cash/card/bank/wallet, default wallet), `color` (#RRGGBB, default
#18794E), `includeInTotal` (boolean, default true). Names are trimmed, 2..80
characters and cannot contain control characters. Unknown fields, client owner/
workspace IDs, JSON number amounts, exponent/decimal money and malformed dates
are rejected. Minor `-0` normalizes to `0`; names and color are canonicalized.
The command has a 4096-byte JSONB text cap; future HTTP code needs its own bounded
streaming body parser. The key must be a UUID v4.

The first account establishes the workspace time zone and becomes default.
Later account creation must use that same time zone. This is a stored preference,
not proof of the user's physical location. Changing it belongs to an explicit
future settings command, not a hidden side effect of creating another account.

Return: `{commandId, accountId, openingPostingId, accountVersion,
preferencesVersion, replayed}`. First default assignment increments preference
version from 1 to 2; a second account preserves the current default/version.
The result is an immutable command outcome, not a current account/balance snapshot.
Future HTTP handlers should fetch current state separately after confirmation.

SQLSTATE: 22023 invalid input, 42501 denied, 23505 changed payload for an existing
idempotency key. No HTTP error/status mapping exists yet.

## Integrity and security

The public SECURITY INVOKER wrapper delegates to a private SECURITY DEFINER helper
because callers have no financial table DML. Every direct helper call performs
the SAME full authentication, ban/anonymous status, owner, active-workspace and
JSON validation checks; wrapper origin is never an authorization assumption.
Search paths are empty and execute grants are explicit. Current ownership is
required even when replaying a previously successful command.

Every mutation locks the owned workspace before looking up its receipt. The
unique identity is workspace + actor + operation + UUID key. SHA-256 of the
normalized JSONB command is stored separately. Same identity/input replays the
original IDs; changed input conflicts. Mutable time-zone/future-date state is
checked only for new commands. No error consumes the key permanently.

Postings have a composite FK to the same workspace/account/currency/scale and a
partial unique opening index. A deferred constraint requires an opening before
account creation can commit. UPDATE/DELETE triggers protect postings, audit and
receipts, including ordinary privileged service operations. Account identity and
currency are immutable. Default pointers must remain in the same workspace and
active, including after account status updates.

Balances derive from exact postings; no mutable balance column is introduced.
Cross-account totals must be grouped by currency/scale and serialized as text.
An aggregate across accounts may exceed the per-account cap without changing any
individual account limit. Future G03 commands must enforce final per-account
bounds under the same locking discipline; no debit/overdraft behavior exists here.

Financial FKs use RESTRICT: archive is not deletion, and parent/user deletion
requires a separate retention/cleanup design rather than silently erasing history.

## Verification and deployment boundaries

The disposable harness uses existing Colima and a pinned PostgreSQL image. It
reads no environment file, opens no host database port, disables container
networking and uses synthetic users. SQL runs only through local container exec.
Its Auth fixture is not GoTrue, PostgREST or real JWT verification. Full local
Supabase/direct-REST acceptance and advisors are still required before release;
the old CLI is not silently upgraded. Existing shop/expense code is untouched.

The results below describe verification before committing. Publishing, GitHub/PR
changes, merges and production operations require separate fresh approval.

### Verified local results — 2026-10-17

- G02 PostgreSQL harness: **99 assertions passed**, plus its final success marker
  (100 PASS lines total). It ran with container networking disabled.
- G01 PostgreSQL regression harness with the new migration present: **38 assertions
  passed**, including exact old shop/membership/current-shop/financial preservation.
- Existing application suite: **134 tests passed**. `npm run typecheck`,
  `npm run lint` and shell syntax checks passed. The existing Vite configuration
  advisory remains visible; no unrelated warning suppression was added.
- A separate worker authored the initial SQL suite. The manager independently
  reran it and added exhaustive anon/authenticated denied-DML checks and the
  conflicting-payload race requested by independent review.
- The independent reviewer rechecked both test additions and reported no remaining
  findings in the bounded source review. Runtime results were verified by the manager.
- Same-key/same-input and same-key/different-input concurrent calls were checked;
  the latter produced one successful command and one conflict with no extra rows.
- Audit failure injection rolled back account, posting, audit, preferences and
  receipt; retrying the same key then succeeded. No production failure hook exists.
- 100000 UZS plus 50000 UZS reconciled to 150000 UZS (15000000 minor units).
  Kiritimati/Pago Pago date-boundary checks passed against stored workspace zones.
- Browser/HTTP, GoTrue/PostgREST, Supabase advisors, full build and production
  acceptance were not run. These results are not substitutes for those checks.
- At verification time the patch was uncommitted. No push, PR change, merge or
  production mutation was performed under the local testing approval.

## Changed-file inventory

All six are new files on `codex/issue-89-account-foundation`:

1. `supabase/migrations/20261017031547_personal_account_opening_foundation.sql`
2. `scripts/test-personal-account-db.sh`
3. `tests/database/personal-account.sql`
4. `tests/database/personal-account-concurrent.sql`
5. `tests/database/personal-account-concurrent-check.sql`
6. `docs/personal-account-foundation.md`

The local `node_modules` symlink is not part of this patch. Older uncommitted
expense fixes remain in their original worktree. No package/configuration file
or prior migration is changed. Test-only fixture helpers and injected failure
triggers live only inside the disposable container, never in the migration.

## Primary references

- [Supabase functions](https://supabase.com/docs/guides/database/functions)
- [Supabase grants and RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [PostgreSQL constraints](https://www.postgresql.org/docs/17/ddl-constraints.html)
- [PostgreSQL binary hashes](https://www.postgresql.org/docs/17/functions-binarystring.html)

The migration uses built-in SHA-256, not legacy pgcrypto encryption. Relevant
Supabase changelog notices were reviewed; no server/extension/client upgrade is
performed by this local work. A production server audit remains outside scope.
