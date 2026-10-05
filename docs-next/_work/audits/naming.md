---
id: zero.documentation-naming-candidates
type: reference
audience: [maintainer, agent]
owner: zero-documentation
status: draft
visibility: internal
---

# Informal System Names

[Audit index](./index.md) · [Documentation index](../../index.md)

The user requested informal names for more systems during the rebuild.
Aliases do not change exports, APIs, configuration keys, routes, tables or
stable documentation IDs.

## Approved Existing Names

| Name | Technical system |
| --- | --- |
| Guardian | Authentication, tenancy and authorization |
| ReactiveDB | Tracked reactive SQLite database |
| Fabric / ReactiveDB Fabric | Multi-database execution and placement |
| Torrent | Durable workflow engine |

## Candidates, Not Decisions

| Candidate | Technical system | Why it fits |
| --- | --- | --- |
| Relay | Sync / realtime delivery | Carries admitted changes to participants |
| Depot | Storage | Durable home for files and managed drives |
| Beacon | Observability | Makes operational state/failures visible |
| Pulse | Scheduler | Timed recurring and immediate work |
| Prism | AI gateway | One coherent interface across provider capabilities |
| Atlas | Data Studio | Navigates logical tables, schemas and records |

These are suggestions, not approved branding or trademark clearance.
Keep technical headings until chosen; no release/API work follows from this list.

## Documentation Convention

Pair an approved alias with its technical term at entrances—for example,
“Relay (Sync).” Teach actual import/member/config names in examples.
Navigation/search should recognize both names, so readers do not learn a second
API vocabulary. Prefer a few major identities rather than branding every
primitive; Schema, Resources, middleware and hooks can remain descriptive.
