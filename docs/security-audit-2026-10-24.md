# Security dependency patch — 2026-10-24

## Problem and minimal fix

The deployed dependency lock reported six findings: critical Next.js, moderate Vitest/mocker, and high Zod findings propagated through Neon Auth/Auth UI.

- Next.js `16.3.8` → `16.4.3` (including its matching env/SWC packages).
- Vitest `4.1.11` → `4.1.12` (including its matching Vitest packages).
- Override transitive Zod `4.5.4` with `4.6.6`. This is a same-major minor upgrade, not an SDK upgrade.

Neon Auth remains `0.6.0-beta`. Auth handlers, cookies, owner checks, financial code, database schema, environment and provider settings are unchanged. Keep the existing vendored ESLint plugin and all lint rules.

The lock contains exactly 19 changed package-version nodes, limited to these families. Unnecessary npm re-resolution of Rolldown, Chai, Tinyrainbow, NanoID, PostCSS and Picomatch was reverted to the previous lock records. No audit force-fix, SDK major upgrade or disabled audit/rule was used.

## Verification before commit

- Minimal lock reproduced with `npm ci --ignore-scripts --no-fund`: passed, zero vulnerabilities reported.
- `npm run test:api`: 696 tests across 39 files passed, including the three added synthetic Auth/SDK regression suites.
- `npm run typecheck`: passed.
- `npm run lint`: passed without rule/configuration changes.
- Effective lint rules, severities and options matched the baseline for the wallet, auth server and draft route: 113 configured rules / 86 active in each sample.
- Local production Next.js 16.4.3 webpack build: passed with scrubbed environment and no hosted Auth/DB/AI access.
- Exact 167-file production artifact build: passed; only package.json and package-lock.json differ from the prior release artifact.
- Independent read-only lock/SDK review: no remaining scope blocker. Reviewer did not independently run these checks.

The three SDK suites exercise public SDK calls with synthetic upstream responses, A/B session separation, uncached session queries, malformed/mismatched identity rejection, origin/body validation and failure behavior. Password operations use mocked fetch only: no reset email, real password or provider account changes occur.

## Sources

- https://github.com/vercel/next.js/releases/tag/v16.4.3
- https://github.com/advisories/GHSA-673q-mjm6-r5xr
- https://github.com/advisories/GHSA-2464-fhr4-w9xw
- https://github.com/advisories/GHSA-mrhx-c7xc-m3w5
- https://github.com/advisories/GHSA-qxg6-89mg-rqv8

## Release boundary

Target a PR to `codex/issue-89-single-book`, then only the existing `creditbook-personal` Vercel project. Do not merge the historical PR stack or change `main`. No migration, financial/category write, Auth configuration, environment update or billable AI test is included. Compare the authenticated QA B record fingerprint and totals before and after release. Hosted acceptance and release identifiers belong in the separate local release receipt; this report records the pre-commit local evidence.

Existing npm peer-dependency/deprecation warnings and the Vite native-config-loader future-compatibility notice remain visible; they are not reported as resolved by audit zero. Automated browser/device tests are not part of this patch; hosted read-only checks are separate from the synthetic local tests.
