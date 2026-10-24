# Voice-first UI implementation — 2026-10-24

## Scope and provenance

Applied the approved compact mock to the real local Neon wallet, not to the standalone HTML mock. Repository baseline remains `3822829684e480510392e0037bb273b1ba7531ae`, branch `codex/issue-89-single-book`; the pre-existing dirty/recovered tree was preserved. No commit, push, PR, merge, deployment, dependency installation, hosted configuration or hosted database change was performed.

## Runtime changes

- `components/personal/neon-wallet.tsx`: compact balance, inline voice-first entry, manual/receipt shortcuts, category navigation and independent input defaults. Defaults are stored per authenticated account in this browser, with a safe voice fallback when storage is unavailable. One-time mode changes do not write preferences. Existing owner-bound writes, snapshot refresh, pagination, rename and archive remain in use.
- `components/personal/neon-wallet.module.css`: compact home, shortcuts, accessible native settings disclosure and narrow layouts.
- `components/personal/voice-entry.tsx`: reusable category-name recording/review with editable confirmation, duplicate-name feedback and cancellation. Financial text-source button removed from this UI; the existing financial text API remains compatible. Recording starts only on an explicit button press; existing 30-second safety cap remains. No money is saved by category confirmation.
- `lib/personal-finance/input-preferences.ts`: bounded preference parsing and normalized category-name validation. Duplicate-name feedback is a client-side guard, not a new database uniqueness guarantee.
- `lib/personal-finance/voice-contract.ts` and `lib/ai/voice-provider.ts`: optional audio-only `purpose: category`, strictly empty financial entries and a bounded category-name field. Existing provider, consent, owner checks, idempotency and budget settlement are reused. No new provider, schema or migration.

## Tests and fixtures changed

- `tests/api/input-preferences.test.ts`
- `tests/api/voice-entry.test.tsx`
- `tests/api/voice-provider.test.ts`
- `tests/e2e/voice-entry.spec.ts`
- `tests/e2e/wallet-file-picker.spec.ts`
- `scripts/lib/neon-voice-provider-stub.mjs`
- `scripts/test-neon-voice-http.mjs`

## Executed verification

- `npm run test:api`: **1,134 / 1,134**, 66 files passed.
- `npm run typecheck`: passed.
- `npm run lint`: zero errors; one pre-existing unused `statements` warning in `tests/api/neon-personal-ledger.test.ts` remains.
- `CREDITBOOK_BUILD_MINIMAL=1 node scripts/test-recovered-build.mjs`: clean staged Next.js webpack build passed; owned build directory removed. No provider secrets copied.
- `node scripts/test-neon-voice-http.mjs` against the owned localhost runner: **126 assertions passed** using two synthetic Auth accounts, a synthetic AI provider, and real disposable networkless PostgreSQL. Verified category audio returns only a name; neither category nor money is auto-saved; explicit category confirmation is idempotent; wrong-owner requests and inference replays fail; original financial/receipt saves remain atomic and idempotent; logout blocks inference.
- Independent read-only review: no newly introduced blocker identified. Reviewer did not independently execute the tests above.

## Browser verification

Real application at `http://localhost:4186/personal`, using synthetic Auth/AI and disposable SQL, not hosted Neon:

- Voice is selected on the home screen without starting the microphone automatically.
- Category defaults to voice; text is available as the alternative.
- `  SPORT  ` is rejected when Sport exists; confirmation remains disabled.
- A new text category appears only after the review/confirmation action.
- Category voice/text one-time switching preserves the saved default.
- Receipt entry default and category text default survive page reload for A.
- After logout and login as B, B still has voice defaults; A's new category is absent.
- Home layout has no horizontal overflow at actual 320 and 390 CSS-pixel viewports. Native browser viewport restored after testing.
- Browser console error scan returned none.
- Screenshots: `qa/voice-first-ui-2026-10-24/home-local.png` and `categories-local.png`.

## Limits and follow-up

- No live OpenRouter inference or real microphone/device acceptance was executed. Synthetic WAV HTTP/provider tests do not establish recognition quality. The attempted browser fake-microphone setup was unsupported and made no browser change.
- Automated Playwright browser specs were updated but not executed in this turn; browser interaction above used the browser-control tool.
- Existing semantic duplicates in financial AI suggestions remain a separate concern: retry idempotency does not detect two identical suggestions within one batch. This behavior predates this UI package; no silent financial deduplication was added.
- Vite emits its existing future native-config-loader compatibility notice. No dependency/configuration change was made to suppress it.
- Local QA remains running for inspection; its runner owns the disposable database and removes it on termination. It uses no hosted database, real credentials or billable AI.
- The earlier missing Git baseline and stacked PR reconciliation remain separate release prerequisites. This local implementation is not a production release claim.
