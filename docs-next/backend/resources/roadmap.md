---
id: zero.resources.roadmap
type: roadmap
audience: [developer, agent]
owner: resources
status: draft
visibility: internal
system: resources
feature: roadmap
maturity: supported
applies_to: ["2.1.1 source; new documentation under review"]
modes: [single, multi, shared-row, tenant-database]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Resources Roadmap

[Resources index](./index.md) · [Documentation index](../../index.md)

## Existing Foundation

Resources already provide per-action policy, logical realms, transport exposure,
field allowlists, generated CRUD, query planning and the shared Sync policy
boundary. Do not schedule these as missing features or introduce a competing
permission DSL merely to document them.

## Known Directions

- [ ] Continue declarative configuration ergonomics while keeping independent
  exposure/realm/loading/authority choices understandable.
- [ ] Improve plugin contributions and task/agent guidance around existing
  app-local extension boundaries.
- [ ] Add further administration/gating UI only when a real use case requires it;
  reusable controls must reflect current permissions rather than grant them.

These are product directions, not new supported settings or promised dates.
Billing/meters and app-defined business policies can compose with Guardian and
resource policy, but are not automatically implemented by this declaration.

## Review And Qualification

Custom JavaScript policies require business/security review beyond shape
validation. Source-backed examples still need installed-artifact qualification
before publication. Keep an explicit distinction between trusted raw code and
the managed policy boundary.

See [definitions](./definitions.md), [Guardian integration](./guardian-integration.md),
[Fabric isolation](../fabric/tenant-isolation.md) and
[configuration](./configuration.md).
