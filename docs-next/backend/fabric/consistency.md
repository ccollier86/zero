---
id: zero.fabric.consistency
type: how-to
audience: [developer, agent, operator]
owner: fabric
status: draft
visibility: internal
system: fabric
feature: consistency
maturity: supported
applies_to: ["2.1.1 baseline with unreleased actor environment corrections"]
modes: [single, multiple, shared-row, tenant-database, file, hot]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Choose Read Visibility Explicitly

[Fabric index](./index.md) · [Documentation index](../../index.md)

Fabric sequences are durable **per database** ordering tokens, not a single
global clock across tenants. Every read and successful write reports
`sequence: { seq }`. Compare tokens only within their source database and
admitted capability lifetime.

## Three Read Modes

| Mode | Routing/visibility contract | Use |
| --- | --- | --- |
| `snapshot` | Read the routed actor's committed snapshot; may lag a recent writer result | Lists and ordinary tolerant reads |
| `read-your-writes` | Require the supplied `minSeq` from that same database | Verify a previous acknowledged write |
| `strong` | Route through the writer's committed view | Read current writer state without a prior token |

Omitted read consistency uses snapshot semantics. A stronger read still does not
join multiple files into one transaction or make an external side effect atomic.

## Carry A Commit Token

This fragment assumes an already-bound `data: AsyncDatabaseClient` and
app-owned values `id`, `title`, `idempotencyKey`:

```ts
const committed = await data.mutate(
  { type: 'update', table: 'notes', id, patch: { title } },
  { idempotencyKey },
);
const visible = await data.get('notes', id, {
  consistency: { mode: 'read-your-writes', minSeq: committed.sequence },
});
```

Do not pass a sequence learned in organization A into an organization B request
after switching scopes. Clear pending reads and scoped client state at that
boundary; sequences alone carry no tenant identity/authorization.

## Ordering And Recovery

Writer receipts preserve the committed token for replay. A read encountering an
unavailable/mismatched generation fails safely; it must not invent a sequence to
satisfy `minSeq`. Realtime replay similarly uses each file's ordered source and
reports history gaps explicitly.

See [concurrency](./concurrency.md) for WAL snapshot overlap,
[idempotency](./idempotency.md) for committed receipts and
[realtime](./realtime.md) for snapshot/replay epochs and client state.
