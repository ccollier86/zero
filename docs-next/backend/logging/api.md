---
id: zero.logging.api
type: reference
audience: [developer, agent, operator, maintainer]
owner: observability
status: in-review
visibility: internal
system: logging
feature: scoped-api
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

Dedicated worker entries should instead import `runLoggingActorIfRequested`
from `@zero/framework/logging/actor`. That focused entry avoids loading the
application/server service barrel just to answer the actor handshake. Existing
`/server` imports remain compatible. Shared app/worker entries should dynamically
import `createApp` only after the actor helper returns false, as shown in the
[launch recipe](./configuration.md). The helper does not relax realm, audit,
environment or startup-deadline checks.

## Declared Server Actions

For the generic replacement, start with [activity auditing](./activity-auditing.md):
`defineLoggingAction`/`zero.logging.action()` supply typed static labels and
finite values; `prepareResult()` and receipt-backed React views retain historical
displayed selections. `record`, `read` and `run` below remain compatible, with
their narrower semantics unchanged.

Use the request's `zero.logging` facade after ordinary domain authorization.
It derives the actor, current application/tenant scope and policy on the server;
an application event cannot supply a different user, tenant or database path.
These are route-handler fragments, not a second logging service:

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

### Choosing a custom logging operation

| Operation | Use it for | What it does not establish |
| --- | --- | --- |
| `record(event)` | An app-defined semantic stage such as an approved export, clinical operation, or completed task | That a later external effect succeeded, or that a person read a response |
| `read(target, callback)` | Preparing an explicitly authorized record for release | The user's permission to access it, transport delivery, or human attention |
| `run(callback)` | Carrying trusted actor/scope attribution into ReactiveDB commits and managed service calls | A distributed transaction or automatic semantic success for the callback |

Use `LoggingEventInput` from `@zero/framework/logging` to type custom events.
Choose the matching existing family (`records`, `workflow`, `communications`,
`ai`, `transfers`, and so on) and a stable namespaced action such as
`clinical.plan.updated`. Custom action names do not require a new worker,
database, plugin or schema migration. The configured family must be enabled;
a null receipt means filtered, not retained.

Event IDs and `occurredAt` belong to the logical stage. If a retry is needed,
reuse the complete original event, not just its ID with a new timestamp.
The trusted actor/session/scope context is part of those facts too: recording
the same event after a new login is not an exact same-context replay.
Reusing an identity with different facts is a conflict, not an update. A later
confirmation is a new stage with its own ID. Do not catch required audit failures
and then tell the caller that an operation was safely audited or safe to repeat.

`read()` durably records `record.read.admitted` before invoking the callback.
It records `record.read.prepared` before returning a successful result, or a
`failed`, `denied`, or `unknown` terminal stage when the callback or authority
fence fails. It retains no exception text. For a stream or an external side
effect, declare the corresponding delivery/completion stage separately;
preparing a stream does not prove its consumption.

Application metadata is denied by default. Add only reviewed scalar keys to
`logging.metadataKeys`; the common sensitive-content names remain prohibited.
Use opaque target IDs and never clinical notes, patient contact information,
credentials, tokens, raw URLs, document bodies, prompts or model responses.
An allowlisted key is not permission to put sensitive content in its value.

Browser code uses `client.logging.observe()` or the built-in collector, not
`record()`. The server fixes those events to the browser-observed evidence class
and an authenticated actor/scope. A browser cannot assert provider confirmation.
Durable background work uses its authority-scoped service facade. Do not retain
a request facade after its lifetime or import the private `LoggingRuntime` to
invent a background identity.

Managed AI and email already own their trusted provider-stage logging. Do not
add a duplicate `record({ evidence: 'provider-confirmed', ... })` afterward:
`record()` intentionally derives a backend/system origin and rejects that
claim. The managed integration changes only the confirmation stage's origin
to `provider`, retaining the initiating actor, scope and invocation identity.

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
Managed pages also carry an optional `people` projection: minimal current
Guardian names/usernames/revisions for the page's human identities. This sits
outside retained events and is not part of their signed/exported evidence.
Continue with both `highWaterOrdinal` and `beforeOrdinal` to preserve a
reading snapshot. New arrivals do not move an older page boundary.

Query fields are `limit` (1–100, default 50), `since` (inclusive),
`until` (exclusive), `beforeOrdinal`, `highWaterOrdinal`, `family`,
`action`, `actorId`, `sessionId`, `targetType`, `targetId`,
`outcome`, `level`, and `eventIds`. Exact `eventIds` are at most 100
JSON-encoded `[sourceId, eventId]` identities; they narrow the same authorized
query and never select a different scope. An empty list matches nothing.
Scalar criteria combine with AND. There is no
free-text scan, raw SQL or advanced nested filter grammar in this version.

The replacement additionally accepts `projection` (`events` by API default,
or `activities`), `activityId` (supporting evidence for that exact activity),
`userId` (human actor or explicit initiating user), `changedField` (exact retained
field name), and `includeTotal`. Omitted values never become free-text search.
`actorId` continues to select the exact executor, not the initiator. Activities
retain a stable ID, first ordinal and latest immutable projection revision;
high-water queries select the retained revision appropriate to that snapshot.
Exact totals count the selected projection, not raw ordinal differences.

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

### Investigation display directory

`client.logging.people({ search?, after?, limit? }, { signal? })` searches the
current authorized Guardian directory by name or username. Search is bounded to
100 characters, limit is 1–50 (default 25), and `after` is the returned opaque
user-ID cursor. The result is `{ items, nextCursor, hasMore }`; each item is
`{ id, name, username, revision? }`. These are current presentation fields, not
contact details, credentials, full profiles or historical identity snapshots.
The same operation is available through the scoped server facade.

`client.logging.tables({ signal? })` / `zero.logging.tables()` returns the
declared table catalog as `{ type, names }[]`, using the exact target identities
already captured by Zero. Tenant catalog entries come only from registered
tenant resources. It does not discover arbitrary Fabric realms or enumerate
their rows; removed/unregistered types remain filterable by exact `targetType`.
Legacy normalization aliases are grouped under their actual retained type.

Both APIs require the configured **logging read** authority and current strict
admission, not merely a signed-in user. Scope is derived by the facade and
cannot be passed in query JSON. Tenant people must still have an active
membership in the current active tenant. Pending provisioning, removed members
and cross-tenant profiles are excluded; suspended users can still be identified
as historical participants. Avatars use the separate native private avatar
directory/delivery checks; a logging read grant does not publish an image or
bypass avatar authorization.

User search uses POST and an audited, bounded investigation window; search
text is not copied into audit metadata (only a criteria digest). Reads recheck
live authority before releasing results. SDK requests are aborted/fenced across
auth-generation changes, like ordinary event reads. Disabling adaptive profile
fields or avatars does not disable readable core names or the activity table.

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

For DataTable, use `createLoggingTableSource(client.logging, stream, criteria)`
from `@zero/framework/components/logging`. Its adapter supplies the standard
`subscribeChanges`, `confirmInsertedRows` and `getLeadingRowId` capabilities;
it does not create a second table, shared public collection or reveal button.
The live first page updates normally while older pages retain ordinal cursors.

The underlying `watch()` options `afterOrdinal` and `onChanges` opt into the
authorized append cursor. A change batch contains ascending retained `events`,
`afterOrdinal`, `throughOrdinal`, `highWaterOrdinal` and `hasMore`.
The SDK resumes from the last validated `throughOrdinal` across reconnects.
It never turns an initial/reconnect snapshot into INSERT evidence. Bursts drain
in bounded pages rather than losing events beyond the latest snapshot window.
These options require stream transport; polling does not pretend to prove inserts.

Activity change pages distinguish genuine INSERT, UPDATE and removal. A new
duration/result fact updates its existing activity; it is not a newly inserted
activity. Filter exits and retention produce actual removal identities. The
native adapter preserves those semantics and batches presentation updates.

The component groups visual INSERTs for roughly 250 ms and bounds pending
presentation identities to the latest 1000. This is UI batching, not delayed
durable logging. Every retained record remains queryable. Native DataTable
owns insertion motion, pagination and its existing incoming-record control.
Page and membership reads share the semantic investigation window, preventing
their refreshes from recursively appending audit events. Authorization,
required delivery and final stream fences remain enforced.

Browser-to-server observations use batched HTTPS POST requests. SSE is one-way,
server to browser; it cannot upload observations. Both routes stay on the
application's own API, with no third-party tracker or credential in a URL.
This direction and framing follow [MDN's SSE documentation](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events).
Same-origin transport does not guarantee passage through an extension or proxy.

## HTTP Operations and Health

The private authenticated prefix is `/api/_zero/logging`. POST operations are
`/events`, `/platform/events`, `/stream`, `/observations`, `/evidence`,
`/holds`, `/holds/release`, `/reviews`, `/export`, `/exports/create`,
`/exports/status`, `/exports/download` and `/verify`.
GET `/policy` returns collection settings; GET `/health` returns global readiness
and counters only under platform-administrator, application-control and configured
manage authority. Tenant-granted read/manage permissions cannot expose global
backlog or integrity state. Query filters remain in POST bodies, not URLs/referrers.
Responses are private/no-store. Server identities never come from body fields;
schema normalization may discard additional HTTP fields.

Use `client.logging.deriveResult`, `result` and `resultVersions` for historical
selections/reads. Selection accepts only opaque source receipt positions; there
is no browser `prepareResult` operation. Historical reads need current logging-read
authority. Platform inspection is explicitly separate and additionally needs
platform/application-control authorization.

`health()` separates in-memory `pendingEvents`, durable
`sourcePendingEvents`, writer `failedEvents`, `sourceDeliveryFailures`,
and `maintenanceFailures`. `sourceDiscoveryPending` separately counts sources
with pending or active reconciliation; their exact event count may not yet be
known. Do not add the two pending event counts: a delivered but
unacknowledged source event can appear in both. Failure counters include retry
attempts and are not counts of distinct lost business events.

`pendingEvents` includes direct admissions and the delivery worker's active
source admissions. When that process is recovering, health reports
`state: 'recovering'`; worker failures contribute to `sourceDeliveryFailures`.
This is separate from the continued availability of the Fabric log databases.
The browser health response does not expose the private worker PID or its
launch/environment settings.

Domain errors distinguish invalid input, forbidden access, backpressure,
unavailable capture, definite noncommit and unknown acknowledgment. Show safe
errors; do not attach event bodies, raw SQL, credentials or private paths.

Native logging routes and custom Zero endpoints return stable safe
`{ code, outcome, error }` logging failures. Caller event/query validation is
422, forbidden access 403, required acknowledgment 428, capacity pressure 429,
and a conflicting event identity 409. Configuration, worker response and
unresolved service failures are 503, not mislabeled bad input. An `unknown`
outcome requires reconciliation of the original operation, never a blind repeat
of a payment, email or other possibly completed external action.

`LOGGING_RESULT_LIMIT` (413) is a definite pre-admission manifest-size rejection,
not an unknown commit or transient queue-pressure signal. Native Sync may split
only that specific rejected preparation. It does not split/replay possibly
committed work after an unknown outcome.

## Related Guides and Next Steps

- [Configuration](./configuration.md) defines permission declarations.
- [Browser collection](./browser.md) defines activity signals and strict-mode gates.
- [Evidence lifecycle](./evidence.md) covers export/review/hold/verification APIs.
- [Logging workspace](../../frontend/components/logging.md) composes the SDK and shared UI.
