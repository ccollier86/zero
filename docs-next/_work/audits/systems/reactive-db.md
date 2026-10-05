---
id: zero.inventory.reactive-db
type: inventory
audience: [maintainer, agent]
owner: reactive-db
status: in-review
visibility: internal
system: reactive-db
applies_to: ["2.1.1 committed source; archive qualification pending"]
modes: ["see feature and configuration matrix"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-04"
  evidence_level: source-observed
---

# ReactiveDB Inventory

[System index](./index.md) · [Documentation index](../../../index.md)

## Audit Identity

ReactiveDB owns synchronous managed SQLite data operations, canonical row identity, transaction-safe durable change records, and local/replica change delivery. It is the data engine beneath Sync and Fabric, not itself a remote permission API.

This source/contract inventory records the original clean baseline above.
The documentation branch now includes separately authorized source/test fixes;
their reproductions and actual runs are recorded in the
[findings ledger](../findings.md) and owning supplemental sections. Baseline
test-presence statements below do not claim those checks were executed.
Public implementation is observed in the committed source/export map; package
qualification is a separate gate. Internal annotations and trusted escape hatches
are not promoted to ordinary request APIs.

## Purpose And Terminology

ReactiveDB is Zero's synchronous SQLite-backed application data layer. It owns
managed row changes, a durable ordered change log, natural identity, consistent
reads, transactions, and local/external change delivery. It is not the Sync
transport, Fabric actor coordinator, Resource authorization layer, or an
arbitrary-SQL change-data-capture promise.

## Features And Documentation Coverage

Unless a row says otherwise, maturity is source-observed **supported** and its
review status is **inventory in review**; package qualification remains pending.

| Feature | Public surface and modes | Evidence / owning responsibility | Planned canonical guide |
| --- | --- | --- | --- |
| Construction/schema admission | `ReactiveDB`, `createReactiveDB`, `defineTable` | One isolated PK definition, TEXT/INTEGER identity, guarded managed table schema | [Draft schema admission guide](../../../backend/reactive-db/schema-admission.md) |
| CRUD and replacement semantics | `insert/create` exact-PK upsert; `createStrict`; `update/delete`; `query/list/get/queryOne` | Prepared statements; other unique conflicts abort; methods return Change/null | [Draft crud guide](../../../backend/reactive-db/crud.md) |
| Row-scoped operations | `createScoped`, `updateScoped`, `deleteScoped`, `getScoped`; `ReactiveDBRowScope` | Mandatory scope stamped/checked in SQL; caller supplies trusted scope | [Draft scoped operations guide](../../../backend/reactive-db/scoped-operations.md) |
| Optimistic conditional mutation | `updateIfCurrent`, `deleteIfCurrent` | Atomic managed write compares expected row at commit path | [Draft conditional writes guide](../../../backend/reactive-db/conditional-writes.md) |
| Natural identity APIs | `getIdentity`, `identityKey`, `queryByIdentity`, `upsertByIdentity`, `updateByIdentity`, `deleteByIdentity` | Unique identity keys, immutable fields, deterministic sync ID | [Draft natural identity guide](../../../backend/reactive-db/natural-identity.md) |
| Synchronous transactions | `transaction(fn)`; nested participation, rollback-only poisoning | No Promise callbacks, tracked schema/mutation constraints, events after root commit | [Draft transactions guide](../../../backend/reactive-db/transactions.md) |
| Post-commit callbacks | `afterCommit(fn)`; best effort synchronous callbacks | Active transaction required, ordered after committed delivery; failure cannot undo commit | [Draft post commit guide](../../../backend/reactive-db/post-commit.md) |
| Consistent snapshot read | `readAtCurrentSequence(fn)` returns `{ value, seq }` | Synchronous/read-only snapshot; raw SQL remains trusted escape hatch | [Draft snapshots guide](../../../backend/reactive-db/snapshots.md) |
| Durable change history | `currentSeq`, `epoch`, `_changes` cursor, `getChangesAfter`, bounded `getChangesPageAfter` | Monotonic sequence and format/retention fences; fresh snapshot on gap | [Draft change history guide](../../../backend/reactive-db/change-history.md) |
| Change subscriptions | `onChange(listener)` returns unsubscribe | Listeners synchronous; isolated payload copies, stable listener snapshot, reentrant delivery ordering | [Draft subscriptions guide](../../../backend/reactive-db/subscriptions.md) |
| External connection delivery | `startExternalChangePolling({ intervalMs, onGap, onInvalid, onError })` | Durable shared change log polling; local/external ordering and invalidation | [Draft replica delivery guide](../../../backend/reactive-db/replica-delivery.md) |
| Tracked automation interception | `registerReactiveDBMutationInterceptor` and transactional changes | Synchronous AFTER database logic belongs database-automations registry, not arbitrary async listeners | [Draft automation integration guide](../../../backend/reactive-db/automation-integration.md) |
| Trusted SQL and introspection | `exec`, `prepare`, raw/service handle getters, table/PK/column inspection | Bypasses managed authority; arbitrary SQL is not guaranteed managed change tracking | [Draft trusted sql guide](../../../backend/reactive-db/trusted-sql.md) |
| Disposal and observability | `dispose`; app-owned emitCode/observability | Injected handles ownership respected; callback errors reported by standard sink | [Draft lifecycle guide](../../../backend/reactive-db/lifecycle.md) |

## Public Surface Map

- `@zero/framework/sync` exports `ReactiveDB`, `createReactiveDB`, mutation
  interceptor registration, row-scope/config/change types, and natural-identity
  helpers.
- Public instance operations cover table definition; managed, strict, scoped,
  conditional, and natural-identity CRUD; query/get/list; synchronous
  transaction/read-at-sequence/after-commit; subscriptions; paged change
  history; external polling; trusted SQL/introspection; and disposal.
- `registerReactiveDBMutationInterceptor` is the supported bridge for admitted
  synchronous database automations. Internal change recording, commit fences,
  and local-origin machinery are not package contracts.
- `exec`, `prepare`, raw database access, and the platform SQLite handle are
  trusted escape hatches. Mutations through them do not automatically receive
  ReactiveDB validation/change tracking, Resource policy, or Sync delivery.

## Configuration Inventory

`ReactiveDBConfig` extends SQLiteStorageConfig (see persistence inventory): sqlite injected service, standalone database handle, ownsDatabase false for injection, clearChangesOnStart false (destructive maintenance), ringBufferDepth 1000, emitCode/observability app-local. Memory/:memory: aliases mean ephemeral, not hot durable storage. Polling default 250ms, minimum accepted positive interval clamped to 10ms. clearChangesOnStart prunes history without reusing monotonic cursor; never a normal migration fix.

All values are server configuration unless explicitly projected. Reading an app's
configuration module executes trusted code; this audit only inspects source.
Doctor/config parity and installed-package examples require scoped synthetic
verification before release-facing claims are marked verified.

## Integration Map

Managed write and change record share the SQLite transaction. Listeners receive committed Change records (`seq/table/op/rowId/row/previousRow/ts`), while local/external metadata is process-local. Sync consumes policy-filtered events; Fabric actors marshal serializable operations and per-file sequence tokens. Database automation interception executes synchronously while rollback remains possible; durable side effects use the automation outbox/dispatcher. `afterCommit` is not a durable external delivery guarantee. Guarded raw schema/SQL operations remain trusted server escape hatches.

## Evidence And Verification

Implementation and the Sync subpath exports were inspected. Six direct
ReactiveDB/identity/format/interceptor test files are present, alongside wider
Sync and Fabric integration coverage; no test was run in this pass.

- [src/sync/reactive-db.ts](../../../../src/sync/reactive-db.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/sync/types.ts](../../../../src/sync/types.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/sync/reactive-db-change-log.ts](../../../../src/sync/reactive-db-change-log.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/sync/reactive-db-external-poller.ts](../../../../src/sync/reactive-db-external-poller.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/sync/reactive-db-synchronous-boundary.ts](../../../../src/sync/reactive-db-synchronous-boundary.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/sync/reactive-db.test.ts](../../../../src/sync/reactive-db.test.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/sync/reactive-db-format-fence.test.ts](../../../../src/sync/reactive-db-format-fence.test.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/sync/reactive-db-mutation-interceptor.test.ts](../../../../src/sync/reactive-db-mutation-interceptor.test.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/sync/reactive-db-local-origin.test.ts](../../../../src/sync/reactive-db-local-origin.test.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [docs/realtime-sync/realtime-sync/reactive-db.md](../../../../docs/realtime-sync/realtime-sync/reactive-db.md): source/test or research reference; test files were inspected as evidence, not executed.

See the [package export catalog](../catalogs/package-exports.md) for subpath
coverage; named exports require the owning feature guide, not a second API manual.

## Findings

`insert` is an exact-primary-key upsert, not strict creation; guide must distinguish createStrict. Async transaction/listener callbacks are rejected/reported, not awaited. Arbitrary raw SQL cannot be taught as automatically emitting managed changes. Cascading FK actions are rejected to avoid unlogged mutation. Internal `afterCommitFence`, recordInternalChange and commit guards require explicit trusted classification rather than normal app tutorials.

## Known Future Plans

User plans include PostgreSQL-like capabilities and branching databases. Current functions/triggers are owned by database-automations; further SQL features/branching are plans, not claims about this engine.

## Navigation And Cross-Link Plan

Planned home: `docs-next/backend/reactive-db/index.md`, `configuration.md` where relevant, and
`roadmap.md`. Feature paths above are plans until actual linked guides exist.
Cross-system integration descriptions must become contextual reciprocal links.

## Completion Review

- [x] Responsibility and primary source/public/config surfaces inspected.
- [x] Feature groups assigned canonical documentation destinations.
- [x] Independent source/public-boundary review of this inventory complete.
- [x] Whole-platform discovery/ownership reconciliation complete (not package/security qualification).
- [ ] Important examples and artifact/package support qualified.
- [x] Detailed draft guide homes replace the feature table's planned paths; independent manual/artifact qualification pending.

Follow the [documentation process](../../../documentation-process.md) before
marking this inventory complete or beginning detailed feature rewriting.
