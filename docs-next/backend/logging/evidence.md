---
id: zero.logging.evidence
type: reference
audience: [developer, agent, operator, maintainer]
owner: observability
status: in-review
visibility: internal
system: logging
feature: evidence-lifecycle
maturity: preview
applies_to: ["2.6.0 main builds containing the opt-in logging preview"]
modes: [managed-server, browser, Fabric, file]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "af5554b750affc48645889debf3680bee29c2ef5"
  snapshot: clean
  date: "2026-10-24"
  evidence_level: implementation-verified
---

# Logging Retention Holds Reviews and Export

[Logging index](./index.md) · [Documentation index](../../index.md)

Evidence lifecycle operations use the dedicated logging actor, not ad hoc
deletion in an application database. Authorization is separate from transport:
read, export, hold, review and management permissions are independently configured.

## Retention and Holds

Both streams retain indefinitely by default. Explicit `auditDays` or
`operationalDays` starts bounded maintenance; each is null or an integer
from 1 to 36500. This is an application policy, not a universal legal period.
Retention age uses server ingestion time so a delayed source timestamp cannot
make newly admitted evidence immediately expire.

Maintenance runs once per minute and removes at most eight batches of 100 events
per stream per pass. Candidate discovery and writer admission are separate:
the writer rechecks event age and active holds in its transaction, so a hold
placed after discovery still prevents deletion.

```ts
await client.logging.hold({
  id: holdId,
  since: intervalStartMs,
  until: intervalEndMs,
  reasonRef: caseReferenceId,
});
await client.logging.releaseHold(holdId);
```

Holds cover audit events in the current authorized scope and source-time interval
`[since, until)`. References are opaque IDs, not free-form case notes. Creation
and release each commit their attributable audit event atomically with hold
state. A release does not erase its history. The active/history catalog has a
hard 1000-record bound; this preview has no archival lifecycle for that catalog.
Operational diagnostic retention is not a substitute for an audit hold.

Pruning removes event envelopes but retains minimal digest/ordinal/chain proofs.
Exact redelivery of an expired source/event identity returns its old receipt;
it cannot resurrect the event. Different content under the same identity still
conflicts. Proofs and hold/review records currently retain indefinitely and need
their own deployment storage budget. No destructive repair CLI is provided.

## Separate Review Evidence

```ts
await client.logging.review({
  id: reviewId,
  query: { family: 'records', since: intervalStartMs, until: intervalEndMs },
  highWaterOrdinal: reviewedWatermark,
  result: 'follow-up',
  reference: followUpId,
});
```

Reviews require read and review authority. They preserve the query, reviewer,
reference, watermark and result in a separate record, alongside an atomic audit
event. Original events are not marked up or overwritten. A future follow-up
does not prove that an earlier investigation was complete.

`client.logging.evidence(before?)` returns scoped hold/review records;
the optional exclusive timestamp pages older reviews. Each list is bounded to
100 records. `hasMoreHolds` and `hasMoreReviews` report additional records;
`nextReviewBefore` supplies the next review timestamp when available. A true
flag does not mean the response contains the entire catalog. This preview does
not yet supply robust composite-cursor history pagination for equal timestamps
or archived hold catalogs.

## Integrity Verification

```ts
const check = await client.logging.verify('audit', 0, independentlyStoredCheckpoint);
```

This platform-admin/manage operation checks at most 100 successive proofs,
including expired-envelope state, expected predecessor links, content digests
and the head/tail relationship. Continue from `throughOrdinal` while
`hasMore` is true. The result includes the current stream checkpoint.
Compare an independently retained checkpoint to detect a rewritten/truncated
tail relative to that checkpoint.

A chain stored beside its data checks consistency; it cannot independently
prove that a privileged operator did not rewrite the whole database. Independent
custody, checkpoint signing/rotation, backups and restore verification are
deployment/release prerequisites for stronger claims and are not automatically
provided by this preview. Returned pages also check envelope/index/digest/proof
consistency before releasing evidence.

## Bounded Evidence Export

```ts
const part = await client.logging.export('audit', query);
```

The current authorized scope and explicit read/export permissions apply at
creation and again before release. The result contains NDJSON, exact-byte
SHA-256, export ID, source high-water, count, completion flag and a continuation
ordinal. It is bounded to ten pages (at most 1000 events) and 8 MiB. A noncomplete
result is a segment, never a claim that every matching event was exported.
Continue with its original high-water and `nextBeforeOrdinal`, or narrow
the query. Server generation is logged before content is returned.

For durable artifacts, compose the result with an explicitly authorized private
Zero Storage drive; never put it in public build output or a public drive.
Do not infer continuing download permission from the export permission at
generation time. The preview does not yet own durable export jobs, artifact
expiry, independently authorized download routes or cleanup/reconciliation.
Those remain strict-profile gates, not simulated UI controls.

NDJSON is the supplied format; no spreadsheet formula execution is introduced
through CSV. The workspace downloads a manifest plus the segment. The digest
covers the event NDJSON bytes, not that outer manifest line or the truth of
unobserved source activity.

## Related Guides and Next Steps

- [Configuration](./configuration.md) explains explicit retention policy.
- [API reference](./api.md) lists exact authorization and failure semantics.
- [Operations](./operations.md) covers backlog, checks and recovery.
- [Roadmap](./roadmap.md) identifies the remaining strict-profile controls.
