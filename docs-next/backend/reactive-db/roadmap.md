---
id: zero.reactive-db.roadmap
type: roadmap
audience: [developer, agent, operator]
owner: reactive-db
status: draft
visibility: internal
system: reactive-db
feature: roadmap
maturity: planned
applies_to: ["2.1.1 source; new documentation under review"]
modes: [managed-server, standalone-Bun, Fabric-actor]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# ReactiveDB Roadmap

[ReactiveDB index](./index.md) · [Documentation index](../../index.md)

These are known user proposals and inferred design directions, not
current SQL features or a release commitment.

- [ ] Explore additional PostgreSQL-like database function/trigger conveniences.
- [ ] Design database branching/snapshot lifecycle and safe environment workflows.
- [ ] Improve developer/agent discovery of schema, functions and triggers.
- [ ] Expand operational inspection without exposing raw privileged data planes.

Current named functions/logical AFTER triggers are implemented by the
database-automations layer; they are not future-only. More SQL compatibility,
arbitrary SQL CDC, a distributed message bus and branch/deploy control planes
must not be inferred from those existing features.

Future work should preserve tracked row/event atomicity, explicit live authority,
bounded file/actor ownership and truthful failure/outcome reporting. A new
convenience should not create an unlogged write path.

## Related Guides And Next Steps

- [Automation integration](./automation-integration.md) describes the current bridge.
- [Trusted SQL](./trusted-sql.md) defines today's escape hatch boundaries.
- [Data planes](../../concepts/data-planes.md) preserves canonical authority separation.
