---
id: zero.schema.roadmap
type: roadmap
audience: [developer, agent, maintainer]
owner: schema
status: draft
visibility: internal
system: schema
feature: roadmap
maturity: planned
applies_to: [future proposals]
---

# Schema Roadmap

[Schema index](./index.md) · [Documentation index](../../index.md)

This is future direction, not a list of available options or dated commitments.
The current contract remains the linked declaration/codec/reference guides.

- [ ] Research schema-declared AI behaviors, such as automatic embedding of a
  selected column. This is a product idea recorded in the platform roadmap;
  there is no supported `embedded: true` field option today.
- [ ] Evaluate richer advanced schema behavior with clear ownership of
  transactions, derived values and configuration. Database automation is a
  separate integration, not a promise of PostgreSQL stored functions or SQL
  CREATE TRIGGER behavior in the schema builder.
- [ ] Improve how declaration options are discovered and organized for coding
  agents without creating a second configuration contract or weakening type
  safety. Future tooling must derive its catalog from public supported APIs.

Preserve one declaration across server/client consumers, explicit data versus
authority separation, and stable row identity when evaluating these ideas.
No migration or feature is enabled by adding an item to this roadmap.

## Related Guides And Next Steps

- [Tables](./tables.md) explains today's full-stack declaration.
- [Configuration](./configuration.md) lists current accepted options.
- [Guardian references](./guardian-references.md) explains storage anchors,
  which must not become a second authentication system.
