---
id: zero.pdf.roadmap
type: roadmap
audience: [developer, agent, operator]
owner: pdf
status: draft
visibility: internal
system: pdf
feature: future-direction
maturity: planned
applies_to: ["2.1.1 development source; not package-qualified"]
modes: [managed-server, standalone-server, scoped-storage]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# PDF Roadmap

[PDF index](./index.md) · [Documentation index](../../index.md)

No additional PDF feature commitment was established by this system inventory.
Document-reader/editor UI ideas in the product backlog are adjacent frontend
products, not implemented PdfService render methods.

- [ ] Keep exact package/browser/policy fixtures qualified for deployment changes.
- [ ] Evaluate richer document UI/templates without weakening resource or Storage authority.
- [ ] Consider additional renderer adapters only with explicit security/deadline/cleanup contracts.

No schedule, renderer fleet or public anonymous PDF endpoint is implied.
[Current rendering](./rendering.md) and [configuration](./configuration.md)
describe the implemented server feature.
