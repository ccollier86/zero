---
id: zero.inventory.kv
type: inventory
audience: [maintainer, agent]
owner: kv
status: draft
visibility: internal
system: kv
applies_to: ["Zero 2.1.1 source baseline; not a release qualification"]
modes: ["managed server app", "standalone plugin/service"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-04"
  evidence_level: source-observed
---

# KV/Cache System Inventory

[Systems inventory index](./index.md) · [Documentation index](../../../index.md)

## Audit Identity

KV/cache provides memory-first key-value service, bounded retention, optional
journal/checkpoint recovery, namespaces, counters and rate limiters. Inspected
Zero 2.1.1 source baseline is `a3a5f726768dac890f241a3899c0a1acb66265d9`;
documentation-only `HEAD` is `cd643b5b862f83b4ab40320486e1b89df1154c87`.
Source observation only.

## Purpose And Terminology

KV is a server-side cache/state primitive whose active reads use in-memory
entries; persistence is a recovery mechanism, not a file-backed lookup mode.
TTL is expiration; LRU is bounded eviction; journal/checkpoint describe the
durability/recovery path. Do not conflate KV with SQL, object storage, or a
distributed external cache.

## Features And Documentation Coverage

| Feature | Maturity and modes | Public surfaces | Evidence | Canonical draft guide | Review |
| --- | --- | --- | --- | --- | --- |
| Memory engine | Supported; server | reads get/getEntry/getMany/has; writes set/setMany/delete/deleteMany/expire/persist/CAS/getOrSet/increment/decrement; namespace/stats | engine/service and memory tests | [engine](../../../backend/kv/engine.md) | Source observed |
| TTL/eviction bounds | Supported; memory-first | default/per-write TTL, max entries/approx bytes, `none|lru`, access/mutation recency | engine, TTL/LRU indices and tests | [engine](../../../backend/kv/engine.md) | Source observed |
| Journal/checkpoint/recovery | Supported; durable managed service | `everysec|always|memory`, replay/corruption policy, flush/checkpoint | journal/checkpoint/recovery/service tests | [durability](../../../backend/kv/durability.md) | Source observed |
| Namespaces/counters/atomic updates | Supported; server | `KvNamespace`, `KvCounterService`, version-based CAS and `getOrSet` | service/concurrency tests | [operations](../../../backend/kv/operations.md) | Source observed |
| Rate limiters | Supported; server | fixed-window/token-bucket/sliding-window methods | limiter service and tests | [limiters](../../../backend/kv/limiters.md) | Source observed |
| Plugin/app lifecycle | Supported; managed app/server | Elysia plugin, `zero.kv`, counters/limiters, app service | plugin and lifecycle tests | [configuration](../../../backend/kv/configuration.md) | Source observed |

## Public Surface Map

Package export `@zero/framework/kv` exposes app service and standalone
memory/persistence primitives. `AppConfig.kv?: boolean | KvServiceConfig` is
enabled by default under `./data/kv`; `false` omits the plugin. Managed services
are app-local; getter is compatibility. No frontend/CLI surface identified.

## Integration Map

- Memory owns active lookup; journal/checkpoint are recovery artifacts. Durable
  writes append before apply; `everysec` periodically fsyncs, `always` fsyncs
  before mutation resolves, `memory` has no persistence. Checkpoint/recovery
  and graceful stop own durability lifecycle.
- TTL and max-entry/byte limits interact with eviction; counters and limiters
  require atomicity/concurrency contracts.
- App factory creates one service, which is stopped/flushed with app lifecycle.
  Global getter is compatibility, not preferred cross-app binding.
- File paths and permissions are server-owned; never inspect actual runtime KV
  data as part of documentation work.
- Emits structured codes through observability.

## Configuration Inventory

Exact service defaults: `baseDir='./data/kv'`, `durability='everysec'`,
`fsyncMs=1000`, `checkpointIntervalMs=30000`, `corruptRecordPolicy='fail'`;
`memory` options have no default TTL, max entries, or max bytes, eviction is
`lru`, TTL bucket 250ms. Durable service uses mutation recency for replay
determinism; memory-only uses access recency. `KvSetOptions.ttlMs` omitted uses
engine default (none by default); `null` means no expiration. `kv:false` disables
the app service; omission enables it. Config is captured at startup; plugin
startup recovers and starts periodic loops, app shutdown flushes/stops. No
Doctor-specific option was found.

## Evidence And Verification

The [ten-page KV manual](../../../backend/kv/index.md) now covers every
inventoried feature, with dedicated concurrency/lifecycle/errors references.
It describes one-instance per-key decision atomicity, the shared journal/apply
and bounded-capacity barriers, exact mutation returns, multiple-loader getOrSet,
TTL/eviction, all limiter shapes, recovery and explicit durability. No
distributed lock/full Redis method family is inferred from kind names.
Guide/source-example/package qualification remains pending.

Inspected `src/kv/index.ts`, `KvServiceConfig`, memory options and app wiring.
Service methods include get/getEntry/getMany/has/set/setMany/delete/deleteMany,
expire/persist/compareAndSet/getOrSet/increment/decrement/namespace,
flush/checkpoint/status/start/stop. Tests present
include memory-engine, recovery, service, concurrency, background maintenance,
and plugin tests. No tests were run during the baseline inventory.
At the audited `main` baseline, the file comment still described a memory-only
slice although exports and app wiring include persistence/plugin surfaces. The
working tree now contains a narrow comment correction; runtime behavior is
unchanged.

Source entry points: [`src/kv/index.ts`](../../../../src/kv/index.ts),
[`src/kv/kv-service.ts`](../../../../src/kv/kv-service.ts),
[`src/kv/kv.plugin.ts`](../../../../src/kv/kv.plugin.ts).

## Findings

### Independent Source Review Supplement

Constructor/default assignments in kv-service.ts and memory options were checked, including durable mutation-recency enforcement. The owner's corrected stale barrel comment is a post-baseline comment-only change, not package durability qualification.

This targeted independent source review is complete for this inventory. It keeps the pinned main baseline distinct from authorized working-tree fixes; it does not complete whole-platform or exact-package gates.

- **Baseline comment contradiction:** `src/kv/index.ts` at `main` described an
  earlier memory-only slice despite current exports/service/app mounting; the
  working-tree comment correction is included in this audit's authorized diff.
- Current `docs/kv.md` and historical storage plan may describe earlier stages;
  reconcile against current code and tests.
- Exact persistence guarantees and corruption policy need test-backed tracing.
- Source version does not prove a released feature.

## Known Future Plans

No new future commitments inferred. Historical storage planning doc has future
items and changing status; only current approved roadmap entries belong in
`docs-next/backend/kv/roadmap.md`.

## Navigation And Cross-Link Plan

Parent: `docs-next/_work/audits/systems/index.md`. Planned reader home:
`docs-next/backend/kv/index.md`, configuration/roadmap, engine, durability,
operations and limiter pages. Cross-link app lifecycle, observability, SQL
storage and operational backups.

## Completion Review

- [x] Targeted independent source/default/public-boundary review completed; no whole-platform or package qualification inferred.

- [x] Correct stale barrel comment through the authorized source-fix process;
  behavior and historical clean baseline remain distinct.
- [ ] Verify all config/defaults and durability boundaries from code/tests.
- [ ] Whole-platform independent review completed.
