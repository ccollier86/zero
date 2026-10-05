---
id: zero.kv.engine
type: reference
audience: [developer, agent, operator]
owner: kv
status: draft
visibility: internal
system: kv
feature: memory-value-and-expiry
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

# Values, Entries, TTL And Eviction

[KV index](./index.md) · [Documentation index](../../index.md)

KvService uses a KvMemoryEngine for active reads. Service get returns a cloned
value or undefined; getEntry returns a cloned entry or null. Missing and
logically expired keys are not live values. Reads remain synchronous.

## Value Contract

Service writes use lossless JSON-compatible snapshots: null/string/boolean/
finite number, dense arrays and plain objects with enumerable data properties.
Undefined/functions/symbols/BigInt/non-finite numbers, custom prototypes,
accessors, sparse arrays and cyclic structures are rejected KV_VALUE_INVALID.
Negative zero normalizes to0. Nested depth is bounded.

An entry carries key/kind/value/expiresAt/version/createdAt/updatedAt/
lastAccessedAt/sizeBytes. Kind defaults value; the union also names counter/
hash/set/list/lease/rate-limit. Kind metadata is not a complete public Redis-like
method family; no hash/list/lease API should be inferred from the type.

## TTL

Set ttlMs omitted uses engine default (none by default); null removes expiry;
a finite nonnegative number establishes relative expiration. Zero is immediate
expiry/tombstone, not no-expiry. Counter omission preserves existing TTL,
while explicit counter ttlMs replaces it. expire changes an existing expiry;
persist removes it.

Logical expiry is checked at read/mutation timestamps. Durable reads do not
silently remove state while a journal decision is pending; checkpoint pruning
is itself ordered/journaled. Physical retained entry count can temporarily
differ from logically live reads. TTL bucket scheduling is250ms by default,
not a promise of delayed logical expiry.

## Capacity And Recency

Optional maxEntries/maxBytes bound live retained state; bytes are approximate
value size, not process RSS or an exact allocator budget. Eviction defaults LRU;
none rejects writes requiring eviction. Standalone/memory service defaults
access recency. Durable services require mutation recency so replay reproduces
the eviction order; forcing access recency fails KV_LIMIT_INVALID.

Bounded capacity/eviction is shared across keys and therefore needs a shared
decision boundary. [Concurrency](./concurrency.md) explains that exception
to independent-key admission.

## Verification And Related Guides

Test cloned input/result isolation, exact TTL boundary, immediate expiry,
nonserializable values, bounded eviction and no-eviction rejection.
Do not use evictable keys as a permanent compliance/audit record.

- [Operations](./operations.md) owns accepted returns.
- [Configuration](./configuration.md) owns engine options.
- [Durability](./durability.md) owns replay/expiry pruning.
