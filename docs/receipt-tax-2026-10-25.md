# Receipt tax allocation — 2026-10-25

Scope: four runtime files plus `tests/api/receipt-tax.test.ts`; no dependencies,
Auth settings, schema migrations or existing ledger writes. Validation did not
perform Git publication; publication is tracked by the PR containing this file.

The provider reports explicitly printed exclusive tax and per-product 8%/10%
rates. Only complete JPY receipts with uniform non-exempt rates and consistent
printed totals are allocated automatically. Integer BigInt largest remainders,
with stable printed-order ties, preserve the exact total. Tax-inclusive,
ambiguous, mixed/exempt rates and unexplained differences remain manual review.

Allocation evidence is structured per item. Changing any amount, currency, kind
or receipt total clears evidence across all items. Confirmation either accepts
no computed evidence (manual correction) or validates the whole recomputed
allocation before constructing base/tax audit notes. Free product notes remain
editable and repeated allocation does not duplicate annotations.

Verification executed:
- 715 tests / 40 files passed; includes exact 558+44=602, rounding invariants,
  unknown/mixed/exempt tax rejection, no double application, collective evidence
  validation and edited-note regressions.
- TypeScript, lint, diff checks and isolated webpack build passed.
- Loopback-only synthetic UI (no DB/Auth/external provider): auto 323/279,
  save-enabled callback without a write, manual tax button and edited metadata
  invalidation passed.
- Independent read-only review found and verified fixes for rate evidence and
  collective stale metadata; no final blocking findings.

Hosted release and unsaved synthetic receipt evidence are recorded separately
in the local `qa/security-2026-10-24/receipt-tax-release.json` receipt. A build
passing is not equivalent to a successful hosted inference or saved-record test.

Hosted acceptance: deployment `dpl_B93r44uacQEBKfdNTd5rZEEhWnDK` returned
HTTP 200 for the synthetic 558 + 44 JPY receipt. The two editable cards were
323 and 279 JPY, total 602 JPY, with confirmation enabled and no clarification.
The production save button was not pressed; before/after record hashes matched.
