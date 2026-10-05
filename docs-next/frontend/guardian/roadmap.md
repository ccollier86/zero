---
id: zero.frontend.guardian.roadmap
type: roadmap
audience: [developer, agent]
owner: guardian
status: draft
visibility: internal
system: guardian
feature: frontend-roadmap
maturity: planned
applies_to: ["2.1.1 source; new documentation under review"]
modes: [single-simple, single-advanced, multi-simple, multi-advanced]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Guardian Frontend Roadmap

[Guardian frontend index](./index.md) · [Documentation index](../../index.md)

The current component/hook contracts are in the
[feature index](./index.md). These unchecked entries are direction/ideas, not
promises that an implementation, release or server capability exists.
Backend expansion remains owned by the
[Guardian roadmap](../../backend/guardian/roadmap.md).

## Known Direction

- [ ] Continue refining the adaptable list/detail/action control plane without
  replacing it with disconnected one-action cards.
- [ ] Expand organization-aware convenience gates where they remove repeated
  composition; keep backend permission declarations authoritative.
- [ ] Add optional account/organization controls alongside future verified
  social OAuth, SSO, passkey and machine-security features only when their
  server contracts actually exist.
- [ ] Make mode-specific onboarding/error/recovery guidance easier to discover
  while preserving one shared SDK transport.

## Verification And Design Ideas

- [ ] Add representative browser journeys for all four Guardian profiles and
  app-only/mixed-role Administration members.
- [ ] Exercise keyboard/screen-reader behavior across nested management dialogs
  and expected scope remounts.
- [ ] Offer richer saved views/history presentation using existing table/control
  extension contracts rather than a separate admin design system.
- [ ] Improve component composition examples for app-owned branding and native
  browser ceremonies without moving secrets into the UI.

These are optional polish/expansion ideas. Confirmed correctness defects belong
in fixes and regression evidence, not this roadmap.
