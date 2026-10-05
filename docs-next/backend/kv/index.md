---
id: zero.kv
type: index
audience: [developer, agent, operator]
owner: kv
status: draft
visibility: internal
system: kv
feature: overview
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

# KV And Cache

[Backend index](../index.md) · [Documentation index](../../index.md)

Zero KV is memory-first server state with optional journal/checkpoint recovery,
TTL/eviction, versioned writes, counters and rate limiters. Active lookup is
always in RAM; durability does not turn it into a disk-query database or a
distributed Redis replacement.

- [Engine and values](./engine.md): JSON-compatible state, TTL and finite capacity.
- [Operations](./operations.md): exact return values, CAS, namespaces and counter helpers.
- [Concurrency](./concurrency.md): single-instance per-key atomicity and shared commit ordering.
- [Durability](./durability.md): memory/everysec/always, checkpoints and recovery.
- [Limiters](./limiters.md): fixed/token/sliding algorithms and safe bucket ownership.
- [Configuration](./configuration.md): complete defaults, app mounting and explicit test seams.
- [Lifecycle](./lifecycle.md): startup, stop/drain and maintenance failure.
- [Errors and operations](./errors.md): stable failures, telemetry and operational checks.
- [Roadmap](./roadmap.md): ideas separate from implemented capabilities.

Public server import is @zero/framework/kv. Managed composition enables KV by
default; trusted server services expose zero.kv/counter/limiter where allowed.
These are application-wide primitives, not automatically per-user/tenant
authorization. Prefix namespaces organize keys; they are not security grants.

The source prioritizes local latency plus explicit durability and real
single-instance mutation ordering. Do not bypass the service's journal/queues
through its exported raw engine when relying on those guarantees.
