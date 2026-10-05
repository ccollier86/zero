---
id: zero.reactive-db.replica-delivery
type: operations
audience: [developer, agent, operator]
owner: reactive-db
status: draft
visibility: internal
system: reactive-db
feature: replica-delivery
maturity: supported
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

# Deliver Changes From Another SQLite Connection

[ReactiveDB index](./index.md) · [Documentation index](../../index.md)

`startExternalChangePolling(options?)` opts an instance into ordered
delivery of its shared durable change log and returns a stop function. Only one
dispatcher can be active. The containing Sync plugin enables its appropriate
file-mode relay; do not install a duplicate one underneath managed composition.

## Options

| Option | Default / requirement |
| --- | --- |
| intervalMs | 250 ms; positive safe integer, values below10 clamped to10 |
| onGap | synchronous handler for retention/continuity/format gap |
| onInvalid | once-only invalidation notification; dispatcher stops |
| onError | transient poll/callback failure observation; cursor retained for retry |

Polling begins from the current durable head, not a replay of every old record.
Local commits synchronously wake the same drain, first delivering any lower
external sequence. Delivery source is local/external relative to this instance.

## Gaps And Corruption

A gap handler must synchronously invalidate/replace downstream baselines before
successful continuation. If omitted, throwing or returning a thenable, the
runtime is invalidated instead of silently skipping undelivered history.
Invalid log/state stops the dispatcher and serving must not fall back to an
untrusted direct-delivery path.

Transient SQLite busy/locked reads retain the cursor for retry. Arbitrary
corruption is not classified as retryable lock pressure. Diagnostic callbacks
must not prevent safe invalidation.

## Scope And Durability

The poller relays tracked durable records written through cooperating instances.
It is not arbitrary SQL CDC, a distributed message broker or a tenant selector.
Different files have independent logs/cursors. Hot placement and actor delivery
have their own persistence/topology rules.

A poll interval is not a promise of a particular end-to-end UI latency.
Do not market it as a measured benchmark.

## Verify

Use disposable file connections to force interleaved local/external commits,
retention gaps and busy/invalid reads. Verify no duplicates, sequence regression,
silent missing event or timer after stop/disposal.

## Related Guides And Next Steps

- [Change history](./change-history.md) owns the durable replay representation.
- [Snapshots](./snapshots.md) provides an authoritative gap recovery baseline.
- [Lifecycle](./lifecycle.md) retires polling with its owner.
