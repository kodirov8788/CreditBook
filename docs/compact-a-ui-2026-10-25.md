# Compact A mobile UI — 2026-10-25

Approved scope: layout/copy/CSS in four personal-wallet/voice-entry files.
Owner/session validation, callback wiring, money confirmation, receipt tax math,
Auth configuration, dependencies and DB schema are unchanged.

- Existing default-input settings now use a keyboard-accessible native header
  disclosure. Settings controls retain their prior per-owner local behavior.
- Mobile balance, title and gaps are reduced; mode shortcuts remain at least
  44px high, voice action 60px. The negative-balance hint remains visible.
- Provider/retention disclosure remains visible above consent. Additional privacy
  details are expandable; consent remains required, never bypassed.
- The settings menu aligns with the header's right edge at narrow widths.

Executed local evidence:
- 715 tests / 40 files; TypeScript; lint; diff check; webpack artifact build pass.
- Actual components with isolated synthetic session/snapshot endpoints (no real
  Auth, DB or AI): at content widths 318/373 and height548, voice button ends540;
  width388/height632 also passes. Desktop1022/766 ends709. No horizontal overflow.
- Settings menu bounds at width318: left16,right302. Consent gating, manual modal
  open/close, receipt-mode chooser and expandable privacy details pass.
- Independent bounded review found no blocking callback/security/layout issues.

These are browser-size tests, not physical iPhone hardware acceptance. No
microphone, AI inference or financial save was executed. Production deployment,
record-preservation comparison and screenshot are tracked separately in local
qa/security-2026-10-24/compact-a-release.json.

Local fixture and release stage are separate directories; the fixture is not
part of the uploaded artifact. This document records pre-publication validation; Git publication is tracked by the PR containing this file.

Hosted acceptance: deployment `dpl_7kYwWxvKvXWsfehsrizkpbwy5ttN` on
`creditbook-personal` showed the voice action ending at y538 in a 634px viewport.
The before/after record comparison matched. No financial save was executed.
