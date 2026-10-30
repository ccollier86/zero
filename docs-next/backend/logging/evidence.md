---
id: zero.logging.evidence
type: reference
audience: [developer, agent, operator, maintainer]
owner: observability
status: in-review
visibility: internal
system: logging
feature: evidence-lifecycle
maturity: supported
applies_to: ["2.7.0 activity auditing replacement; verify the qualified release commit"]
modes: [managed-server, browser, Fabric, file]
reviewed_against:
  package: "@zero/framework"
  version: "2.7.0"
  commit: "d702d72c09e94eb95eb65cc270dad2aa8ab5c2ac"
  snapshot: clean
  date: "2026-10-29"
  evidence_level: implementation-verified
---

# Logging Retention Holds Reviews and Export

[Logging index](./index.md) · [Documentation index](../../index.md)

Evidence lifecycle operations use the dedicated logging actor, not ad hoc
deletion in an application database. Authorization is separate from transport:
read, export, hold, review and management permissions are independently configured.
Composite history, private export jobs and signed local custody are part of
the managed completion release. Older preview archives lack these controls;
verify the exact source commit and archive checksum before enabling compliance.

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

In the [activity replacement](./activity-auditing.md), fresh/held activities
protect their linked preparation facts and historical manifests as well as their
own latest fact. Expiration retires the logical row, publishes a real removal
and deletes derived manifests/indexes through bounded restartable cleanup.
Retired ranges prevent later reconstruction from resurrecting removed history.
Original replay proofs and custody checkpoints retain their existing semantics.

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

`client.logging.evidence(before?)` returns scoped hold/review records, with at
most 100 records per catalog. Continue using `page.nextCursor`, which keeps
separate `(timestamp, id)` positions for holds and reviews and retires a finished
catalog. Equal-time records are not skipped or returned again. `hasMoreHolds`
and `hasMoreReviews` describe each list; neither flag proves a complete catalog.
The legacy numeric timestamp argument and `nextReviewBefore` remain available
for existing callers, but new callers should use the composite cursor.

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

A chain stored beside its data checks consistency, not independent custody.
The built-in [local custody owner](./configuration.md#self-contained-signing-and-checkpoints)
retains signed checkpoints in a separate private Fabric database, rejects
event/checkpoint edits through ordinary database operations, and verifies the
history at startup. A database restored below its retained checkpoint is not
silently accepted. Signing keys remain outside event/checkpoint databases.
Local custody has a local-server trust boundary; off-host immutable storage is
optional stronger deployment hardening, not an external-account requirement.
Returned pages also check envelope/index/digest/proof consistency before release.

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

The inline `export()` API remains compatible for lower presets. The strict
completion implementation rejects inline export and requires a durable private
job followed by a freshly authorized download:

```ts
const job = await client.logging.createExport({
  id: crypto.randomUUID(),
  stream: 'audit',
  query,
});
const current = job.state === 'pending'
  ? await client.logging.exportJob(job.id)
  : job;
if (current?.state === 'ready') {
  const verifiedBlob = await client.logging.downloadExport(current.id);
  // Offer the Blob through the application's download interaction.
}
```

Keep the same request ID when retrying an uncertain create. A pending job is
durable, not proof that generation completed. The built-in materializer runs at
most four jobs concurrently and reconciles retained work after restart. Each
artifact expires after one hour; at most 128 artifacts awaiting expiry/cleanup
are admitted. Expiry retires download access before private Storage cleanup;
capacity is released only after cleanup is recorded. Job transitions commit
their audit evidence atomically, including the artifact checksum/state binding.

Artifacts use Zero Storage's private system-object lifecycle. They create no
public drive, ordinary file link or client-selectable provider path. Every
status/download rechecks current scope and read/export authority. Downloads
repeat those checks around each yielding read, enforce expiry, and check exact
length/digest. The client discards scope-retired responses and verifies the full
download checksum. A server-side stream completion is not proof of human receipt.

NDJSON is the supplied format; no spreadsheet formula execution is introduced
through CSV. The durable artifact contains a manifest followed by event lines.
Its job SHA-256 covers every downloadable byte, including the manifest line;
`manifest.eventSha256` separately covers the event lines. The older inline
result's SHA-256 still covers only its event NDJSON. Neither hash proves
unobserved source activity. These are investigation exports, not a database
backup or an implemented older-log archive/import format.

### Activity Export Format

Raw-event exports keep format version 1. Selecting `projection: 'activities'`
produces version 2, adding a bounded history segment for each activity: actual
displayed result versions, their ordered manifests/source lineage and original
supporting evidence. It does not query the current application record in place
of missing historical evidence.

`complete` describes the query segment. `historyComplete` in the v2 export
manifest and each row's `history.complete` describe history coverage separately.
At most 20 result versions, 100 supporting events and 100 lineage sources are
included per activity, within the shared 8 MiB artifact budget. Continuation
ordinals, `omittedSourceIds` and `unavailableResultIds` explicitly identify older
or retired facts. A complete query segment is not a complete history when those
markers/flags say otherwise. The existing durable job's `complete` remains the
query-segment flag; inspect the downloaded artifact's history markers too.

## Related Guides and Next Steps

- [Configuration](./configuration.md) explains explicit retention policy.
- [API reference](./api.md) lists exact authorization and failure semantics.
- [Operations](./operations.md) covers backlog, checks and recovery.
- [Roadmap](./roadmap.md) identifies optional investigation UI, additional
  deployment qualification and deferred backups/archive imports.
