---
id: zero.database-automations.roadmap
type: roadmap
audience: [developer, agent, operator]
owner: reactive-db
status: draft
visibility: internal
system: database-automations
feature: roadmap
maturity: supported
applies_to: ["2.1.1 source baseline; not installed-package qualification"]
modes: ["pinned application database", "Fabric realm database"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Database Automations Roadmap

[Database automations](./index.md) · [Documentation index](../../index.md)

This file separates verified capabilities from future ideas. It is not a
release schedule or permission to change public APIs during a documentation
audit.

## Implemented Foundation

- [x] Immutable versioned functions, triggers and canonical manifests.
- [x] Same-transaction tracked functions and bounded deterministic cascades.
- [x] Source-local atomic durable outbox with lease-fenced at-least-once delivery.
- [x] Pinned/Fabric registry admission and source routing.
- [x] Source-bound service authority and exact Torrent event delivery.
- [x] Standard safe errors/events and Doctor integrity/readiness/health checks.

These checks describe the inspected source, not completed artifact
qualification. The detailed manuals remain draft until independent review.

## Approved Product Direction

- [ ] Continue declarative schema-adjacent organization of functions/triggers,
  with discoverable crosslinks and agent-friendly examples.
- [ ] Prove exact workflow resume from record changes in realistic applications.
- [ ] Preserve reusable physical database/service composition as Zero grows
  logging, metrics, audit and other isolated data uses.

No new conventional db/schemas/functions/triggers filesystem auto-loader is
claimed here. A folder convention discussed as a future direction is not an
implemented discovery rule.

## Possible Later Extensions

Explicitly unapproved research ideas include operator queue inspection/redrive
UI, richer declarative row conditions, public lower-only operational knobs and
further scope-safe service facades. They require separate design, authority,
retention and compatibility work; do not present them as available.

Do not turn this roadmap into a requirement for SQLite-native arbitrary
triggers/procedures or unrestricted runtime code execution. The current
authoring/capability boundary is described in [functions](./functions.md) and
[services](./services-and-authority.md).
