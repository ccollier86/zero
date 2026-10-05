---
id: zero.platform-tokens.roadmap
type: roadmap
audience: [developer, agent, operator]
owner: platform-tokens
status: draft
visibility: internal
system: platform-tokens
feature: future-direction
maturity: planned
applies_to: ["2.1.1 development source; not package-qualified"]
modes: [managed-server, standalone-server]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Platform Tokens Roadmap

[Platform tokens index](./index.md) · [Documentation index](../../index.md)

No additional generic-token feature commitment was established by the inventory.
Keep Guardian API keys, native clients and workflow interactions under their
respective owners; a shared token primitive does not automatically implement
each product protocol.

- [ ] Keep examples/release evidence aligned with generic versus account-specific token semantics.
- [ ] Evaluate new action/continuation use cases only with explicit authority, lifetime and transaction contracts.

No proposed helper, distributed token store or new public route is implied.
[Current configuration](./configuration.md) and [integration](./integration.md)
describe the implemented boundaries.
