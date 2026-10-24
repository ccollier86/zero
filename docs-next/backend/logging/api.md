---
id: zero.logging.api
type: reference
audience: [developer, agent, operator, maintainer]
owner: observability
status: in-review
visibility: internal
system: logging
feature: scoped-api
maturity: preview
applies_to: ["Unreleased feature/core-logging source only"]
modes: [managed-server, browser, Fabric, file]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "af5554b750affc48645889debf3680bee29c2ef5"
  snapshot: clean
  date: "2026-10-24"
  evidence_level: implementation-verified
---

# Logging Server and Client APIs

[Logging index](./index.md) · [Documentation index](../../index.md)

Managed logging exposes `zero.logging` on admitted request and durable-work
service facades, and `client.logging` on the existing browser SDK. Neither
requires a second auth or database client. The server facade is null when
logging is disabled or no committed request scope exists.

Types are available from `@zero/framework/logging`. Server configuration,
`ScopedLogging`, `LoggingError` and `runLoggingActorIfRequested` are also
exported from `@zero/framework/server`. Do not import the private runtime,
realm, writer or source-outbox classes into application routes.

## Declared Server Actions

These are route-handler fragments after ordinary domain authorization:

```ts
const logging = zero.logging;
if (!logging) throw new Error('This operation requires logging');

const result = await logging.read(
  { type: 'document', id: documentId },
  () => documentService.readAuthorized(documentId),
);

await logging.run(() => documentService.updateAuthorized(documentId, input));

await logging.record({
  id: operationEventId,
  family: 'workflow',
  action: 'report.prepared',
  occurredAt: Date.now(),
  outcome: 'succeeded',
  evidence: 'server-confirmed',
  target: { type: 'report', id: reportId },
  metadata: { rowCount: 12 },
});
```

Declare `rowCount` in `logging.metadataKeys` for the last fragment.
`read()` durably admits the read attempt and records successful preparation
before returning its result. It does not grant permission to read the document
and cannot prove response delivery or human attention. If the callback fails,
there is no successful preparation event.

`run()` binds source mutation attribution to live authority and the current
app. Database changes and their source outbox still commit together. It does
not make a multi-await operation one distributed transaction. Retained child
tasks cannot reuse the ended attribution lifetime.

`record()` snapshots its input before yielding, checks current authority, and
returns a commit receipt or null when capture policy filters it. On an unknown
outcome, retain the original identity, time and context for reconciliation;
do not generate a new event identity just because the acknowledgment was lost.

## Queries and Permissions

```ts
const page = await client.logging.page('audit', {
  limit: 50,
  family: 'records',
  actorId: actorId,
  targetId: documentId,
  since: startTimeMs,
  until: endTimeMs,
});
```

Each page contains `events`, `highWaterOrdinal`, `hasMore`, and
`nextBeforeOrdinal`. Each entry contains `event`, `ordinal`, and `ingestedAt`.
Continue with both `highWaterOrdinal` and `beforeOrdinal` to preserve a
reading snapshot. New arrivals do not move an older page boundary.

Query fields are `limit` (1–100, default 50), `since` (inclusive),
`until` (exclusive), `beforeOrdinal`, `highWaterOrdinal`, `family`,
`action`, `actorId`, `sessionId`, `targetType`, `targetId`,
`outcome`, and `level`. Scalar criteria combine with AND. There is no
free-text scan, raw SQL or advanced nested filter grammar in this version.

Ordinary `page()` is permanently bound to the live application/tenant scope.
`platformPage()` is a distinct operation requiring platform-administrator
and application-control-plane authority, plus the configured read permission.
A tenant role alone cannot grant it. There is no caller-selected arbitrary scope
argument. All protected yielding operations revalidate before returning data.

By default, read/export/hold/review/manage operations require a platform
administrator. Configured Guardian permission codes replace that operation's
default; export additionally requires read, and review additionally requires read.
Browser observations require a session, not log-read permission. The built-in
HTTP routes accept sessions, not arbitrary API-key credentials; an app-owned
machine endpoint must explicitly admit its credential and use the scoped facade.

## Streaming Committed Projections

```ts
const stop = client.logging.watch('audit', { limit: 1 }, page => {
  showLatestWatermark(page.highWaterOrdinal);
}, {
  onStatus: status => showConnectionState(status),
  onError: () => hideEvidenceUntilRevalidated(),
});
```

The default is an authenticated, same-origin SSE projection stream using the
SDK's fetch transport. It is not a raw table feed. Every projection performs a
fresh scoped read and final authority check. Commit notifications are coalesced;
only one projected page is buffered per subscription. Missing hints are healed
by a fresh baseline and periodic authorized reads.

Each connection lasts at most 20 seconds, with a ten-second revalidation
interval. The SDK reconnects through the normal credential-refresh path.
Stopping, logout, tenant replacement or authorization invalidation aborts
retained transport work. There are at most 256 server subscriptions per logging
runtime. Stream packets have a 1 MiB client parsing limit.

Use `{ transport: 'poll', intervalMs: 5000 }` only as an explicit fallback;
poll intervals are integers from 1000 to 60000 milliseconds. `platform: true`
selects the separately authorized platform read. A snapshot/reconnect is not a
new business event or an exact count of new records.

Browser-to-server observations use batched HTTPS POST requests. SSE is one-way,
server to browser; it cannot upload observations. Both routes stay on the
application's own API, with no third-party tracker or credential in a URL.
This direction and framing follow [MDN's SSE documentation](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events).
Same-origin transport does not guarantee passage through an extension or proxy.

## HTTP Operations and Health

The private authenticated prefix is `/api/_zero/logging`. POST operations are
`/events`, `/platform/events`, `/stream`, `/observations`, `/evidence`,
`/holds`, `/holds/release`, `/reviews`, `/export` and `/verify`.
GET `/policy` returns collection settings; GET `/health` returns authorized
readiness and counters. Query filters remain in POST bodies, not URLs/referrers.
Responses are private/no-store. Server identities never come from body fields;
schema normalization may discard additional HTTP fields.

`health()` separates in-memory `pendingEvents`, durable
`sourcePendingEvents`, writer `failedEvents`, `sourceDeliveryFailures`,
and `maintenanceFailures`. Do not add the two pending counts: a delivered but
unacknowledged source event can appear in both. Failure counters include retry
attempts and are not counts of distinct lost business events.

Domain errors distinguish invalid input, forbidden access, backpressure,
unavailable capture, definite noncommit and unknown acknowledgment. Show safe
errors; do not attach event bodies, raw SQL, credentials or private paths.

## Related Guides and Next Steps

- [Configuration](./configuration.md) defines permission declarations.
- [Browser collection](./browser.md) defines activity signals and strict-mode gates.
- [Evidence lifecycle](./evidence.md) covers export/review/hold/verification APIs.
- [Logging workspace](../../frontend/components/logging.md) composes the SDK and shared UI.
