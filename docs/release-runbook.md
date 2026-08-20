# CreditBook release runbook

## Canonical services

- GitHub: `kodirov8788/CreditBook`
- Vercel team: `kodirov8788s-projects`
- Vercel project: `creditbook` (`prj_z24xGwEVMUuLTy26Z9GBR06VWVYi`)
- Production alias: `https://creditbook-kodirov8788s-projects.vercel.app`
- Supabase project ref: `txikcclndkierygbiblu` in `ap-northeast-1`

The older Vercel project named `credit-book` is not the release target and must not be used for PR verification.

## GitHub Flow

1. Create a focused branch from `main` and link the issue in the PR body.
2. Run `npm run test:api`, `npm run typecheck`, `npm run lint`, and `npm run build` locally.
3. For UI changes, run the Playwright smoke suite against the requested local port.
4. Wait for both the required `verify` check and the Vercel check to pass. Do not merge while `verify` fails before its first step; track that condition in issue #64.
5. Apply Supabase migrations only after the PR is merged. Run relationship/null preflights before tenant-integrity migrations and verify the migration history afterward.
6. Smoke-test production after deployment:

   - `/api/health` returns 200 with `supabase: ok` and `customers_table: ok`.
   - `/login` returns 200.
   - unauthenticated `/api/customers` returns 401.
   - an unknown route returns the Uzbek 404 page.

7. Record the deployment ID, preview/production URL, test summary, migration name, and any authenticated QA limitations in the linked issue.

## Database migration order

When the current stacked fixes are ready, apply them in this order: current-shop resolution, tenant relationship integrity, then atomic activity audit. Never apply the audit trigger migration before its tenant relationship prerequisite has been reviewed.
