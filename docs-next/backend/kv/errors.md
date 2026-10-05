---
id: zero.kv.errors
type: reference
audience: [developer, agent, operator]
owner: kv
status: draft
visibility: internal
system: kv
feature: errors-and-operational-events
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

# KV Errors And Operational Handling

[KV index](./index.md) · [Documentation index](../../index.md)

KvError exposes a stable code and metadata. It does not prescribe an HTTP
status; an application maps the domain outcome to its authorized endpoint.

| Family | Codes |
| --- | --- |
| Input/capacity |KV_KEY_INVALID, KV_TTL_INVALID, KV_LIMIT_INVALID, KV_VALUE_INVALID, KV_COUNTER_TYPE_MISMATCH, KV_EVICTION_REQUIRED. |
| Lifecycle |KV_SERVICE_NOT_RUNNING, KV_SERVICE_STOPPING. |
| Persistence/recovery |KV_JOURNAL_CORRUPT, KV_PERSISTENCE_FAILED, KV_CHECKPOINT_INVALID, KV_RECOVERY_FAILED. |

Metadata can contain internal keys/paths/causes; do not reflect it or a raw
stack into an unreviewed public response. Namespaces/keys may be sensitive
identifiers. Use stable safe failure summaries and the owning app event stream.

Managed startup/stop and journal/checkpoint/recovery emit stable KV_* events.
They are operational events, not durable evidence that a replay nonce or
payment was consumed. Do not log cached values/raw secrets to diagnose them.

## Operational Checks

Confirm the service started, selected durability, actual owned base directory,
readable filesystem and acknowledged writes. Reproduce concurrency against the
exact installed public package using fresh fixtures before deploying CAS/limits
as a security primitive. Never point tests at a live KV directory.

A process-local claim must not be widened to independent instances/distributed
atomicity. A persistence failure may leave bytes to recover; preserve files
rather than performing an automatic reset/retry that hides unknown state.

- [Durability](./durability.md) owns recovery and failure fencing.
- [Concurrency](./concurrency.md) owns claim scope.
- [Observability](../observability/index.md) owns safe diagnostic export.
