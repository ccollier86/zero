---
id: zero.kv.concurrency
type: architecture
audience: [developer, agent, operator]
owner: kv
status: draft
visibility: internal
system: kv
feature: atomicity-and-ordering
maturity: supported
applies_to: ["2.1.1 source; new documentation under review"]
modes: [managed-server, standalone-server]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Single-Instance KV Atomicity

[KV index](./index.md) · [Documentation index](../../index.md)

KV decisions are serialized per key across all normal service mutations.
The boundary includes read/check/calculation, journal commit/apply and capture
of the specific operation result. A mutex around only the final append would
not make CAS or a limiter decision atomic.

## Shared Boundaries

Independent unbounded keys can admit independent work. The journal still has
one append order and apply waits for the corresponding sequence; this is
persistence ordering, not independent file writers racing unsafely.
Checkpoints join the mutation/commit boundary.

When maxEntries/maxBytes is configured, global capacity/eviction decisions
share an additional boundary because evicting another key changes global
state. Do not promise unconstrained cross-key throughput in that configuration.

CAS, ordinary set/delete/expire/persist and counters use the same per-key queue.
Limiter decisions use an internal compound-update seam within that same
ordering. The symbol is not exported as a general app transaction API.
Captured replies do not reread a later write's value/version after yielding.

## Failure And Lifecycle

A failed queued operation releases normal queue progress. Persistence/apply
failure may deliberately fence subsequent writes until recovery, rather than
pretend state and journal still agree. Idle queue entries are retired.
Stop closes new mutation admission and drains admitted loader/mutation/commit
work before final durability. See [lifecycle](./lifecycle.md).

## Scope Of Guarantee

This is **one KvService instance**, not cross-process/cross-server atomicity.
Two services independently opening one directory are not a supported shared
lock/limiter arrangement. Direct engine/journal mutation bypasses service
coordination. Namespaces do not provide an authorization boundary.

The earlier1.3 concurrency defects are not the current source contract.
Source includes deterministic journal barriers/fault injection, CAS races,
mutation returns, limiter admission and recovery tests; exact installed-package
acceptance still requires running the relevant regressions for that artifact.

- [Operations](./operations.md) owns public CAS/return semantics.
- [Limiters](./limiters.md) owns bucket algorithms.
- [Durability](./durability.md) owns append/apply/checkpoint ordering.
