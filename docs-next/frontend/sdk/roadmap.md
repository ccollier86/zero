---
id: zero.frontend.sdk.roadmap
type: roadmap
audience: [developer, agent, maintainer]
owner: frontend-sdk
status: draft
visibility: internal
system: frontend-sdk
feature: roadmap
maturity: planned
applies_to: [future proposals]
---

# Client SDK Direction

[SDK index](./index.md) · [Documentation index](../../index.md)

The integrated SDK already has shared authenticated transport, collections,
accepted mutation receipts, resource CRUD and scoped platform facades. Future
work should reuse those foundations instead of presenting existing services
as missing or creating parallel auth/query contracts.

- [ ] Improve coding-agent capability discovery, examples and configuration
  orientation as recorded platform product direction. Any catalog must be
  derived from supported public exports and exact installed versions.
- [ ] Evaluate future transport/service ergonomics through focused app use cases
  while preserving lifecycle ownership, accepted-write semantics, tenant scope
  and logical/wire distinctions. This is an idea, not an approved new SDK API.

Automatic table-string-to-row inference is not currently a Register behavior;
the [registry guide](../../backend/schema/registry.md) explains explicit aliases.
The documentation audit's confirmed type/default/acceptance fixes are corrections,
not roadmap limitations or a promise of unrelated runtime feature expansion.

## Related Guides And Next Steps

- [Client lifecycle](./client-lifecycle.md) explains today's ownership.
- [Configuration](./configuration.md) is the current options reference.
- [Resources](./resources.md) and [collections](./collections.md) describe existing data paths.
