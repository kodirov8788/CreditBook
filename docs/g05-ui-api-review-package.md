# G05 category UI/API package — 2026-10-20

## Boundary

Reviewed baseline: `8ecc4bec0f4044a5ca484308b0b5bb41a828772a`, branch
`codex/issue-89-single-book`. Local only: no commit, index staging, push, PR
mutation, merge, hosted schema/data change or deployment was performed.

The category UI/API existed as uncommitted work. This review changed only
`components/personal/categories.tsx`, its CSS module, and added the initial-markup
regression test below. Controls now have a separate wrapping toolbar with spacing;
the empty active list no longer repeats the creation button. No API or database
defect was reproduced, so their contracts were not unnecessarily rewritten.

## Exact package manifest

This overlay targets the baseline above; it is not a complete checkout or a
deployment. The only `book.tsx` delta is the category navigation link.

```text
app/api/personal/categories/route.ts
app/personal/categories/page.tsx
components/personal/book.tsx
components/personal/categories.tsx
components/personal/categories.module.css
components/personal/category-editor.tsx
components/personal/category-editor.module.css
lib/personal-finance/category-command.ts
lib/personal-finance/category-list.ts
lib/personal-finance/category-mutation.ts
tests/api/personal-category-command.test.ts
tests/api/personal-category-list.test.ts
tests/api/personal-category-mutation.test.ts
tests/api/personal-category-page.test.ts
tests/api/personal-category-routes.test.ts
tests/api/personal-category-ui.test.tsx
docs/g05-ui-api-review-package.md
```

Requires the baseline's already committed G01/G02 and
`20261019081156_personal_categories.sql` migration. The package does not carry or
apply migrations. Excludes G03 entry files, generated `next-env.d.ts`, mixed HTTP
runner/helper/checkpoint changes, category attribution helpers not imported by
this UI, and other unrelated dirty files. Test fixtures used during this review
are not silently included as release changes.

## Verification actually performed

- Category unit/mocked tests: 186 passed across 7 files, including the separate
  attribution helper tests. Whole worktree API/unit suite: 698 passed / 34 files.
  These are local worktree results, not PR CI or production acceptance.
- `npm run typecheck`: passed. Targeted ESLint: passed. `git diff --check`: passed.
- Two fresh isolated Supabase/Next production-build fixtures: each completed 303
  real local Auth/JWT/REST/Next assertions, including 50 explicitly labelled G05
  checks. Existing shop/financial fixture records remained unchanged. The runner
  never reads hosted credentials or `.env`; its hosts are loopback-only.
- Real Chrome, first fixture: QA-A creates a category, renames it to Unicode
  `QA Taom 食事`, reloads, cancels then confirms archive, and sees it only in the
  archived list. QA-B sees neither A's active nor archived category and creates
  its own category. A login from another tab clears B's unsaved category editor.
- Real Chrome, final compiled UI: create, Unicode rename, refresh, archive and
  archived listing passed. Competing edits in two tabs reject the stale version;
  retry retains the conflict and cannot overwrite the newer name. Confirmed
  local-intent discard refreshes the newer server name and unlocks controls.
- Responsive proof: measured mobile viewport 390x844, no horizontal overflow;
  desktop 1512x827, no horizontal overflow. Mobile is emulation, not real hardware.
  Browser viewport override was cleared after the check.
- Independent read-only reviewer found no proven category API/RLS defect.

Evidence outside the source tree (synthetic records only):

```text
/private/tmp/creditbook-g05-review-http.log
/private/tmp/creditbook-g05-final-http.log
/private/tmp/creditbook-g05-final-unit.log
/private/tmp/creditbook-g05-all-api.log
/private/tmp/creditbook-g05-package-unit.log
/private/tmp/creditbook-g05-typecheck.log
/private/tmp/creditbook-g05-lint.log
/private/tmp/creditbook-g05-before-mobile.png
/private/tmp/creditbook-g05-active-mobile.png
/private/tmp/creditbook-g05-final-desktop.png
/private/tmp/creditbook-g05-conflict-mobile.png
```

The first attempt to start the second fixture refused an occupied loopback port
while the first runner was cleaning up. After verified cleanup it was rerun;
no existing instance was adopted or stopped. Browser viewport control briefly
stalled; the desktop dimensions were subsequently read from the actual DOM,
rather than inferred from the requested dimensions.

## Limits and recovery

No dropped-response or network-failure injection was executed in Chrome; helper
unit/mocked tests cover retry/cancellation paths. No real-device, preview or
production authenticated category acceptance is claimed. G05 as a whole remains
open: defaults, entry/budget/AI integrations and full release acceptance are not
part of this bounded package. The session journal is not a durable offline queue.

The broader local HTTP runner includes existing G03 tests; its aggregate count
must not be represented as 303 category-only checks. Its manual completion marker
is coordination only, not browser proof; the observations above and screenshots
are the browser evidence. Owned runners clean only their freshly created fixtures.

Local rollback should restore only the two category presentation files and remove
this review's added markup test/document if desired. Do not reset the worktree or
remove the pre-existing category/G03 work. Publication and any hosted migration
require separate fresh approval and a reviewed scoped diff.
