# G01: personal workspace foundation (not a production release)

This patch is the first slice of issue #88, not completion of G01 or the
16-group roadmap. Do not close #88 from a PR containing only this slice.

## Contract

- One personal workspace per authenticated, non-anonymous account.
- New non-anonymous, unbanned signup creates a profile and personal workspace,
  never a shop, membership, or platform role. Initially anonymous or banned
  accounts get no personal workspace; later verified/unbanned users can provision
  lazily. User-editable metadata does not grant authority.
- Existing users provision their workspace lazily through an idempotent,
  no-argument RPC. Reads never provision or modify data.
- Existing shops, memberships, and shop permission functions remain unchanged.
  A valid pending invitation still requires explicit activation.
- Owners can read their active workspace and insert only their own owner ID.
  No authenticated UPDATE or DELETE grant is provided in this foundation.
- Platform administrators receive no blanket access to personal workspaces.
  Banned/anonymous accounts and suspended workspaces are denied. Service-role
  access remains a trusted-server capability, not an app-user permission.
- GET `/api/personal/workspace` returns the active workspace or 404.
  POST accepts an empty body or `{}` only and returns 200 on creation or reuse.
  The API never accepts an owner ID, workspace status, shop ID, or financial data.

## Release blocker

**Do not apply this migration to production independently.** The current main
dashboard still expects a shop. Personal-only onboarding, financial accounts,
the ledger and navigation must be implemented and acceptance-tested before
removing forced shop bootstrap in a deployed environment. No production data or
settings are changed by preparing this patch.

Creating an optional shop, financial records, workspace rename/archive UI,
budgets, voice input and all subsequent work groups are out of this patch.

## Reproducible local checks

Run `bash scripts/test-personal-workspace-db.sh` with Colima available. It starts
a fresh PostgreSQL 17 container without published ports, applies `supabase/schema.sql`
followed by every ordered migration, inserts a legacy-account fixture before
the new migration, then exercises row policies and privileges under actual
PostgreSQL roles. It deletes only its own disposable container on exit. No
environment file, production URL, or cloud credential is read.

The auth fixture approximates `auth.users` and `auth.uid()`; this is a real SQL/RLS
test, **not** a GoTrue/PostgREST/browser/email end-to-end test. Such acceptance
tests and Supabase advisors remain required before release. The installed CLI
does not support the newer `db advisors` command; it is not silently upgraded.

The baseline schema is intentionally not duplicated with the new table. The
canonical setup for these tests is baseline plus ordered migrations. Never
reapply the old baseline over an already-migrated production database.

## Local evidence (2026-10-17)

- API suite: 59 tests passed, including 20 new personal-workspace cases.
- PostgreSQL 17: 38 assertions passed, including concurrent lazy creation,
  existing financial-row preservation and real role/RLS denials.
- Type checking passed. Lint passed after correcting one new test warning.
- Independent review identified initial anonymous provisioning and insufficient
  legacy-state coverage. Both were corrected; SQL tests now compare exact
  memberships (including a pre-existing pending invitation) and current-shop
  selections, and reject initial anonymous/banned provisioning.
- The reviewer rechecked those corrections without finding a concrete regression.
  The manager independently reran the PostgreSQL harness: all 38 assertions passed.
- Existing expense fixes in the separate review worktree were not included.
- Production migration, deployment, browser acceptance, GoTrue/PostgREST
  integration, Supabase advisors and full application build were not run.
- These validation results were recorded before committing. Publishing, PR,
  merge and production changes require their own fresh approvals.

## Changed-file inventory

All are new files in `codex/issue-88-personal-workspace`:

1. `app/api/personal/workspace/route.ts`
2. `tests/api/personal-workspace.test.ts`
3. `supabase/migrations/20261017011017_personal_workspace_foundation.sql`
4. `scripts/test-personal-workspace-db.sh`
5. `tests/database/auth-fixture.sql`
6. `tests/database/personal-workspace-before.sql`
7. `tests/database/personal-workspace.sql`
8. `tests/database/personal-workspace-concurrent.sql`
9. `tests/database/personal-workspace-concurrent-check.sql`
10. `docs/personal-workspace-foundation.md`

The untracked `node_modules` link is a local reuse of existing dependencies,
not source and must not be staged or committed. Colima was started for local
testing; disposable test containers are removed by the harness. The downloaded
PostgreSQL image and local VM remain available for repeat tests.
