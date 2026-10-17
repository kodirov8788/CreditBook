# G02-S1 / G03 shared money contract

Status: local contract foundation; NOT completed G02/G03 and NOT a persistence
implementation. Based on G01 commit `8c450f1` / draft PR #104. This branch is
stacked on G01; a future G02 PR must not accidentally duplicate the G01 diff.

## Approved local slice

Only these four new files are included:

- `lib/personal-finance/money.ts`
- `lib/personal-finance/types.ts`
- `tests/api/personal-money.test.ts`
- `docs/personal-account-contract.md`

No routes, UI, tables, migrations, RLS, financial writes, installs, production
changes, commits, pushes or PR changes are authorized by this local scope.
Existing shop `payment_method` labels remain labels, not funded accounts.

## Exact money

- Supported product currencies: UZS (default, scale 2), JPY (scale 0), USD (scale 2).
  No conversion or mixed-currency grand total. Group totals by currency and scale.
- Transport uses `{currencyCode, scale, amountMinor}` with minor units as a string.
  UZS `100000.00` becomes `"10000000"`; JPY `100000` becomes `"100000"`.
- Arithmetic uses bigint, never floating-point money or JSON number input.
  A native BigInt-capable runtime is required. `BigInt(...)` avoids bigint-literal
  syntax errors with the existing ES2017 TypeScript target; it does NOT polyfill
  BigInt or promise ES2017 runtime support. Browser compatibility must be checked
  before wiring this pure module into UI; the existing tsconfig remains unchanged.
- Decimal grammar: ASCII digits, optional leading minus, optional fractional
  digits separated by `.`. No whitespace, grouping, exponent, plus sign, leading
  zero padding, missing integer/fraction component or silent rounding.
- Minor-unit grammar: canonical signed integer string; `-0` normalizes to `0`.
  Formatting produces exactly the configured fractional precision.
- The pure helper accepts an explicit nonnegative `maxAbsMinor` from its caller.
  Tests use a fixture-only limit, NOT an approved financial product cap. Final
  per-entry/account/aggregate bounds and PostgreSQL storage remain a decision gate.
- Raw parsing is capped at 96 characters and scales at 0..18 as technical safety
  limits, not an expansion of the three supported currency scales. Locale-specific
  keyboards/separators need a separate explicit UI normalization step.
- Caller limits must fit that raw cap in their longest signed fixed-scale spelling.
  Incompatible limits are rejected even for zero input, so every accepted value
  round-trips through the formatter and both parsers within an accepted limit.
- Signed opening values (including zero) are representable. Future income/expense
  commands must enforce positive magnitudes separately; parsing is not authorization.

## Future account and ledger invariants (not implemented)

1. Account creation atomically creates the account and exactly one immutable
   `opening` posting, including zero. No independently mutable balance column.
2. Current balance is the sum of all posted signed entries, INCLUDING opening
   exactly once. Opening is not income; transfers are not income/expenses.
3. Account ownership, currency and scale cannot be reassigned. Every account and
   posting must resolve to the authenticated owner's active personal workspace.
   Platform roles do not grant blanket personal-data access.
4. Rename/icon/color/include-in-total/default/archive actions create no financial
   postings. Preferences must reference an accessible active account or null.
5. Archive preserves history and prohibits new postings. Explicitly unarchive
   before any correction; no implicit correction bypass. Archive and posting must
   serialize consistently, with the selected default repaired atomically if needed.
6. Correction appends an exact inverse reversal and replacement atomically with
   required audit. Link each to the original; disallow duplicate active reversals,
   cross-account/currency/scale links and cycles. Preserve recorded timestamps;
   effective date and recorded time are distinct.
7. Unique idempotency identity is `(workspace, actor, operation, clientKey)`.
   Store the canonical-command fingerprint separately, NEVER in the unique key.
   Same identity/same input replays the original result; changed input returns
   conflict with no new writes. Required audit and result commit together.

## Decisions required before persistence or API guarantees

- Exact monetary storage/range and aggregate overflow behavior; overdraft policy.
- Client-key grammar/length, fingerprint canonicalization, retention, failure/race
  handling and replay after archive. No idempotency service exists in this slice.
- Archive inclusion in totals, unarchive permission, default-selection behavior,
  name/icon/color constraints and effective-date/timezone policy.
- Deployment order and usable personal onboarding/navigation. G01's production
  release block remains in effect; do not apply its migration independently.

## Validation scope

Pure tests cover grammar, sign/zero, precision, bounds, values beyond JS safe
integers, string transport and exact reconciliation. These are NOT API, RLS,
database, idempotency, mobile or production acceptance tests. Account persistence,
concurrent mutations, default/archive behavior and statements require later slices.

## Primary references

- [PostgreSQL 17 numeric types](https://www.postgresql.org/docs/17/datatype-numeric.html):
  exact integer/numeric arithmetic, range and rounding behavior.
- [SIX ISO currency maintenance](https://www.six-group.com/en/products-services/financial-information/market-reference-data/data-standards.html)
  and its current List One XML: UZS 2, JPY 0, USD 2 verified on 2026-10-17.

## Local validation (2026-10-17)

- Pure-money suite: 75 tests passed in the final full run (initial focused run: 72).
- Complete `test:api` command: 134 tests passed (59 existing endpoint tests plus
  75 new pure-money tests; the directory name does not make these new API tests).
- `npm run typecheck` and `npm run lint`: passed without errors or lint warnings.
- Initial focused run failed during test discovery because a `%j` test label
  attempted to serialize a bigint. The label was corrected; no production logic
  or global JSON serialization was changed to suppress the failure.
- Independent review identified a runtime-support documentation overstatement and
  incompatible caller limits at the 96-character boundary. Both were corrected;
  signed boundary round-trips now cover scales 0, 2 and 18. Types/lint/full tests
  were rerun successfully. Local Node v26.0.0 provides native BigInt and preserved
  the exact value `9007199254740993`; this is NOT Vercel/browser runtime acceptance.
- The independent reviewer rechecked the two corrections and reported no further
  findings in that bounded source review. Test results were verified by the manager.
- The existing Vite configuration advisory remains visible during test execution;
  no unrelated tooling/configuration change or warning suppression was added.
- No new dependencies, database tests, build, browser/E2E checks, deployments or
  production verification were run. Existing expense fixes remain untouched in
  their separate worktree. G02 and G03 remain incomplete.
- Issue #89 was assigned to `kodirov8788` with explicit approval. At validation
  closeout the four-file patch was local and uncommitted; no push, new PR, merge
  or #104 change occurred. Publishing requires its own fresh approval.
