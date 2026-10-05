---
id: zero.kv.limiters
type: reference
audience: [developer, agent, operator]
owner: kv
status: draft
visibility: internal
system: kv
feature: rate-limit-algorithms
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

# KV Rate Limiters

[KV index](./index.md) · [Documentation index](../../index.md)

kv.limiter exposes fixedWindow/tokenBucket/slidingWindow.
Each full decision/update is atomic for its backing key in one KvService;
do not add an app-only mutex and claim distributed atomicity.

## Options And Algorithm

| Method | Required options / behavior |
| --- | --- |
| fixedWindow(key,{limit,windowMs,cost?}) | Counts attempts in aligned windows. Rejected attempts still increase this window count. |
| tokenBucket(key,{capacity,refillPerSec,cost?,ttlMs?}) | Starts full, refills by elapsed time up to capacity and subtracts only accepted cost. |
| slidingWindow(key,{limit,windowMs,cost?}) | Weighted current+previous window approximation; accepted costs enter current count. |

Limit/capacity/refill/window/cost are finite positive values; cost defaults1.
Token-bucket TTL defaults max(1000,ceil(capacity/refillPerSec*2000))ms;
explicit TTL is finite nonnegative, with zero immediate expiry.
Fixed/sliding state lasts approximately two windows from the decision.
Backward clock movement does not refill/reset an existing bucket prematurely.

KvLimiterResult contains allowed/remaining/resetAt/retryAfterMs/value.
Reset/retry may be null. remaining is clamped/rounded per algorithm, not a
license to charge fractional requests differently from supplied cost.
Sliding is a weighted approximation, not an exact timestamp-log window.

## Bucket Ownership And HTTP

Use server-chosen keys incorporating the intended app/organization/user/
route policy. Namespace text alone does not authorize a caller to reset or
overwrite rate-limit backing state. Avoid mixing normal values with reserved
limiter keys. The helper does not automatically enforce a route or emit429;
the endpoint applies the accepted decision and retry information.

Loss/expiry/eviction of limiter state can reopen capacity. An evictable cache
is not durable lifetime billing/accounting. Choose capacity/retention/durability
for the actual threat/rate policy.

## Verification And Related Guides

Use ManualKvClock plus controllable journal barriers, not only sequential
requests. On a fresh capacity10 bucket,100 concurrent cost1 calls should admit
exactly10 in all three shapes/modes. Also test refill, rollover, backward clock,
nondefault costs, journal rejection and shutdown/recovery.

- [Concurrency](./concurrency.md) owns full atomic decision boundaries.
- [Operations](./operations.md) owns normal mutations participating in CAS races.
- [Durability](./durability.md) separates fsync from atomicity.
