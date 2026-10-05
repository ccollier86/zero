---
id: zero.kv.operations
type: reference
audience: [developer, agent, operator]
owner: kv
status: draft
visibility: internal
system: kv
feature: service-and-atomic-writes
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

# KV Operations, CAS And Counters

[KV index](./index.md) · [Documentation index](../../index.md)

Await start before writing; managed startup does this for you.
Reads are synchronous and writes return accepted promises.

| Operation | Result |
| --- | --- |
| get/getEntry/has/getMany | Value-or-undefined / entry-or-null / boolean / Map of present keys. |
| set/setMany | Entry / entry array, each describing that operation's value/version. |
| delete/deleteMany | Whether removed / removed count. |
| expire/persist | Whether an existing key changed expiry. |
| increment/decrement | That operation's resulting numeric value. |
| compareAndSet | {ok,value,current,version}, with coherent observed state on loss. |
| getOrSet | Existing value or accepted winning loader value. |

setMany/deleteMany are sequential helpers, **not** an all-or-nothing multi-key
transaction. An earlier successful write remains if a later item fails.

## Compare-And-Set

expectedVersion:null means create only if absent at the admitted evaluation.
A number means replace only that live version. Exactly one same-version claim
wins against same-instance competing mutations; plain set/delete/expiry/counter
writes participate in the same key boundary. Losers return ok:false plus the
observed value/version (null for missing); no implicit retry occurs.

```ts
import { KvService } from '@zero/framework/kv';

const kv = new KvService({ durability: 'memory' });
await kv.start();
try {
  const claims = await Promise.all(Array.from({ length: 100 }, (_, index) =>
    kv.compareAndSet('synthetic-claim', null, index),
  ));
  if (claims.filter((claim) => claim.ok).length !== 1) {
    throw new Error('Synthetic single-instance claim invariant failed');
  }
} finally {
  await kv.stop();
}
```

This creates no persistent directory and is not a distributed lock recipe.
Expiry/eviction can permit a future absent-key claim; lifetime policy matters.

## Loader And Counter Semantics

getOrSet may run **multiple concurrent loaders**. It computes outside the key
write boundary, then preserves an already accepted concurrent value instead
of overwriting it. The loader must not perform a once-only side effect or
assume single-flight execution.

Increment starts from0, accepts finite delta and preserves TTL by default.
Nonnumeric existing values reject KV_COUNTER_TYPE_MISMATCH; non-finite result
rejects KV_VALUE_INVALID. Decrement negates delta. kv.counters provides
increment/decrement/value/reset; value returns0 for missing.

## Namespaces

kv.namespace(prefix) produces KvNamespace with get/getEntry/set/delete/
increment/compareAndSet/namespace/key. It prefixes with colon-separated text
and returns full backing entry keys; nested namespaces add another prefix.
No automatic escaping/domain separation, cross-tenant permission check or
enumeration API is supplied. Choose app-owned collision-safe key conventions.

- [Concurrency](./concurrency.md) owns full single-instance atomic boundaries.
- [Engine](./engine.md) owns snapshots/TTL/eviction.
- [Lifecycle](./lifecycle.md) owns mutation admission/drain.
