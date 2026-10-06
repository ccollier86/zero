---
id: zero.database-automations.index
type: index
audience: [developer, agent, operator]
owner: reactive-db
status: draft
visibility: internal
system: database-automations
feature: index
maturity: supported
applies_to: ["2.4.2 source update; focused release checks recorded separately"]
modes: ["pinned application database", "Fabric realm database"]
reviewed_against:
  package: "@zero/framework"
  version: "2.4.2"
  commit: "5cf3009f63767c4052065aa211734f2ebffb2c9f"
  snapshot: dirty
  date: "2026-10-06"
  evidence_level: source-observed
---

# ReactiveDB Database Automations

[Backend systems](../index.md) · [Documentation index](../../index.md)

Database automations are versioned, declarative functions and AFTER triggers
over tracked ReactiveDB mutations. They connect a data change to same-database
computation or durable server work. They apply to the pinned application
database and admitted Fabric realms.

Use a transaction function for an atomic rollup or invariant sharing the source
commit. Use a durable function for an awaitable app function, Zero-service action,
external request, retry-safe Torrent start or exact Torrent event. Use an ordinary authorized route/service for a
user command not caused by a tracked row mutation.

## Mental Model

```text
authorized tracked mutation
  → matching AFTER triggers
  → synchronous functions + source-local durable outbox
  → one database commit
  → host dispatcher claims durable work
  → app function / source-bound services / external effect / Torrent start or event
```

AFTER means after the logical mutation within its ReactiveDB transaction, not
after an independently committed SQLite write. Transaction failures roll back
origin rows, cascades, change records and pending durable commands together.
Durable delivery is at least once, not exactly-once external I/O.

These are not SQLite CREATE TRIGGER objects. Raw SQL and other mutations
bypassing ReactiveDB are not observed. Sync/Resources can produce tracked
mutations, but server policy must authorize them before admission.

## Guides

- [Configuration](./configuration.md): pinned/Fabric registries, composition and
  startup/storage prerequisites.
- [Functions](./functions.md): public declarations, contexts, identities/results.
- [Transaction functions](./transaction-functions.md): atomic rollups, capability
  lifetime, cascades, budgets and Guardian anchors.
- [Durable functions](./durable-functions.md): async handlers and idempotency.
- [Invoke app functions](./app-functions.md): map captured row values into an
  ordinary function or your application's versioned dispatcher; no workflow required.
- [Triggers](./triggers.md): events, column filters and ordered function chains.
- [Input snapshots](./inputs.md): before/after rows, sequence and correlation.
- [Versioning](./versioning.md): canonical manifests and queued-version upgrades.
- [Validation](./validation.md): authoring checks and managed admission.
- [Delivery](./delivery.md): leases, capacity, fairness, restart and shutdown.
- [Services and authority](./services-and-authority.md): system execution and
  source-bound live fences.
- [Torrent integration](./torrent.md): durably start one run or resume one exact
  waiting instance, with delivery-derived receipt identities.
- [Operations](./operations.md): errors, safe events and Doctor.
- [Testing](./testing.md): deterministic acceptance before deployment.
- [Roadmap](./roadmap.md): current contracts versus future work.

The public authoring package is @zero/framework/database-automations.
Outbox/dispatcher/store classes are internal, not a public queue management
SDK. No built-in authoring UI, direct HTTP function invocation route or browser
hook is supplied by this package.

## Architectural Principles

The source supports this inferred philosophy: code owns trusted handlers;
definitions are immutable and explicit about version/mode; same-commit work
uses a revocable narrow capability; asynchronous work is captured beside its
cause; physical source identity controls scope; and diagnostics avoid payloads
and high-cardinality identities.

A graph editor can persist declarative Torrent definitions; database function
handlers remain registered server code. A registry is executable trusted
startup configuration, not arbitrary JSON received from an untrusted client.

Read [ReactiveDB](../reactive-db/index.md) and
[runtime services](../runtime/server-services.md) first. Automations do not
independently grant Guardian or Fabric access. These are source-backed drafts,
not release/artifact qualification; independent guide review remains separate.
