# Personal pilot access — application and database boundaries (G01)

## Scope and rollout status

This local slice guards `/personal`, all six existing personal HTTP handlers and
the underlying personal SQL/RLS/RPC paths. Migration
`20261019055603_personal_pilot_access.sql` was exercised only in disposable,
network-disabled PostgreSQL containers. No production configuration or data was
changed. G01 is not production-accepted: browser/mobile verification and release
approval remain separate gates. Existing shop routes and general authentication
are unchanged. Real local Auth/REST/HTTP acceptance has since passed; see
`personal-pilot-http-acceptance.md` for the final 122-assertion matrix and limits.

## Database contract required before rollout

`public.has_personal_pilot_access()` returns a scalar boolean for the current
session UUID only, without a user argument. It is a security-invoker wrapper around
the existing private personal predicate `is_current_account_active()`. This predicate
now joins a protected UUID allowlist and checks enabled, banned, anonymous and
soft-deleted status from current database rows. Its current callers are personal-only:
workspace SELECT/INSERT policies and provisioning, account read/create/manage RPCs,
and the owner helper behind every personal account/posting/preference/audit policy.
Direct private financial helper calls perform the same check independently.

The allowlist is in `creditbook_private`, with RLS enabled, no client policies and
no client/service API table grants. The narrow definer lookup has an empty search
path; the public wrapper has authenticated-only execution. No user is enrolled by
the migration, no metadata/email grants authority, and no real person's UUID or
address is committed. The generic old predicate name is retained for compatibility;
new shop code must not use it as a general account-status helper.

Only an explicitly approved database-admin operation may enrol the independently
verified intended Auth UUID. Disable the row to revoke access without deleting
records. Revocation/ban checks apply at the next SQL statement/snapshot; this is
not a promise to cancel an already-running statement. Normal logout/session
revocation is not checked against `auth.sessions` in this slice; do not claim that
all unexpired JWTs stop working after sign-out alone.

Until that migration and configuration are approved, applied and verified, missing
RPC, malformed result and transport/query failures deny access. HTTP API responses
are explicitly private/no-store: policy outages return 503 and explicit false
returns 403. Only boolean true grants access. Anonymous sessions are rejected
before the policy query. Authorization is rechecked per request.

The server-rendered `/personal` page instead renders a non-financial denial/retry
view (normal page HTTP 200, not an API-style 403/503). It remains force-dynamic and
never renders private controls or queries shops on policy failure. A rendered
HTTP 200 page must not be interpreted as an authorized session or healthy policy
service. Page transport/cache headers have not been verified with a live browser;
no API-style response-header guarantee is claimed for this server component.

The application check is defense in depth, **not a substitute for RLS**. Do not
release or mark G01 complete until real Data API/RPC access is independently
tested for permitted/non-permitted/banned identities, including stale JWTs, and
existing shop login/invitation/tenant flows remain intact. Existing workspaces
are hidden from non-pilots, not deleted. Signup trigger definitions are unchanged:
new normal signups can still receive an empty workspace, but cannot access it
without approval. This slice does not change signup/shop provisioning policy.

## Evidence

`tests/api/personal-access.test.ts` exercises the real guard and all six route
denial paths with mocked Auth/database transport, including a permitted provisioning
path. `tests/api/personal-page-access.test.ts` checks server-page rendering with
fixture clients. Existing personal route tests mock an allowed guard to isolate
their original command/validation contracts. These are not live Auth/RLS evidence.

Both `scripts/test-personal-workspace-db.sh` and
`scripts/test-personal-account-db.sh` first check the historical foundation at the
pre-pilot boundary, then apply the pilot and any later migrations in timestamp
order, and check final-state authorization. No future migration is run before
the gate. The before/after fixtures compare exact existing application rows and
function/policy/trigger definitions; authorized synthetic writes are separate.

`tests/database/personal-pilot.sql` covers raw authenticated SQL reads/writes,
direct private helpers, two approved owners, non-pilot platform admin, metadata
spoofing, missing identity/anon/service grants, revocation/replay, fresh ban,
soft-deletion, suspended workspace, approved exact writes/retries, and preserved
shop access, cross-shop isolation, invitations and SQL signup trigger behavior.
Role/JWT-sub fixtures are not real JWT verification, GoTrue signup or HTTP
PostgREST coverage. The Auth event-trigger stub is unrelated to the real local
`on_auth_user_created` SQL trigger, which is attached and exercised.

No Supabase platform advisor was run against production or claimed from these raw
PostgreSQL containers. Privilege/search-path/RLS catalog assertions are local
checks, not a replacement for platform advisors and integration acceptance.

## Next gate

The isolated full-Supabase Auth/PostgREST matrix and production-mode HTTP
page/cache checks passed locally. Browser/mobile interaction and visual QA,
provider email/OAuth flows and production acceptance remain separate. Keep the
production pilot allowlist unconfigured until exact release/configuration
approval. Preserve the draft PR stack and do not deploy the application before
the matching DB contract. See `personal-pilot-http-acceptance.md` for reproduction.

## Primary references

- [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Function security](https://supabase.com/docs/guides/database/functions)
- [Auth user model including soft deletion](https://github.com/supabase/auth/blob/master/internal/models/user.go)
