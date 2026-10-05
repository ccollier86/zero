---
id: zero.frontend.app-shell.roadmap
type: roadmap
audience: [developer, agent]
owner: frontend-app-shell
status: draft
visibility: internal
system: frontend-components
feature: app-shell-roadmap
maturity: supported
applies_to: ["2.1.1 source with audited corrections; package qualification pending"]
modes: [browser, SSR, Guardian single, Guardian multi]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# AppShell Roadmap

[AppShell index](./index.md) · [Documentation index](../../index.md)

The current shell is reusable composition, not a generated application sitemap or
an authorization engine. Known user direction favors modern compact control
planes, consistent design tokens and adaptable organization/platform management.
The following are future ideas, not exported behavior:

- [ ] Improve application-level account/admin page blocks as demonstrated by real
  apps, while keeping server authority in Guardian/services.
- [ ] Expand declarative navigation examples and source-copy recipes without
  introducing a second permission system in shell descriptors.
- [ ] Improve public/landing-page composition alongside the separate marketing
  component family.

Current configuration/interaction defects found during this audit are corrected
and tested as defects; they are not deferred product ideas or documented limits.

## Related Guides And Next Steps

- [AppShell configuration](./configuration.md) is the current contract.
- [Guardian interfaces](../guardian/index.md) owns the existing adaptive control plane.
- [Data controls](../data-controls/index.md) owns compact list/detail/action patterns.
