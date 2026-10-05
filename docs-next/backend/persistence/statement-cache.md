---
id: zero.persistence.statement-cache
type: reference
audience: [developer, agent, operator]
owner: persistence
status: draft
visibility: internal
system: persistence
feature: statement-cache
maturity: supported
applies_to: ["2.1.1 baseline with unreleased transaction/buffer corrections"]
modes: [file, hot, ephemeral, Fabric-actor]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Reuse Connection-Owned Statements

[Persistence index](./index.md) · [Documentation index](../../index.md)

StatementCache owns preparation/reuse/finalization for one Bun Database.
The default maxSize is 1000 and ttlMs is 300000. The platform service supplies
its configured statementCacheSize.

prepare(sql) returns the cached statement on a hit, updating last-used/use count,
or prepares a new one. At capacity it evicts expired entries, otherwise the
least-recently-used candidate. TTL is checked during eviction, not by a background
expiry timer.

## Ownership

Do not finalize a borrowed cached statement independently and later reuse its
same cache entry. The cache owns that statement; bind values on each operation
rather than embedding user values into a fresh SQL string/cache key.

clear attempts every finalize and deletes only entries successfully finalized.
Failed entries remain owned for a later retry; multiple errors are aggregated.
This prevents silently abandoning locks/resources after one finalize fails.

## Diagnostics

stats returns size/maxSize/hitRate based on retained entry use counts. It is a
cheap cache diagnostic, not a historical application-wide query metric.
Evicted/cleared history is not included in that current estimate.

Statement reuse is performance machinery, not authorization or managed change
tracking. A cached raw UPDATE is still raw SQL.

## Related Guides And Next Steps

- [SQLite service](./sqlite-service.md) owns the cache lifecycle.
- [Trusted SQL](../reactive-db/trusted-sql.md) explains raw access boundaries.
- [Lifecycle](./lifecycle.md) joins finalization and close.
