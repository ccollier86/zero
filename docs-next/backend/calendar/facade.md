---
id: zero.backend.calendar.facade
type: reference
audience: [developer, agent]
owner: calendar
status: draft
visibility: internal
system: calendar
feature: managed-core-facade
maturity: experimental
---

# Calendar facade and booking semantics

[Calendar index](./index.md) · [Configuration](./configuration.md) ·
[Server request services](../runtime/server-services.md)

Unreleased source API. The same scoped `ScopedCalendar` contract powers native
handlers (`context.zero.calendar`) and the browser (`client.calendar`). No app
should copy private realm commands, query SQL, owner/actor handles or authority.
The server member is null when disabled, anonymous, unscoped, native/API-key or
in a sealed machine/background projection. Normal browser admission still needs
current Guardian and any configured required-audit delivery.

```ts
const calendar = context.zero.calendar;
if (!calendar) throw new Error('Calendar is unavailable in this context.');

const created = await calendar.resources.create({
  label: 'My calendar', kind: 'person', timeZone: 'America/New_York',
}, { idempotencyKey: crypto.randomUUID() });

const accepted = await calendar.appointments.create({
  resourceIds: [created.id], title: 'Planning session',
  startAt: '2026-12-01T15:00:00.000Z',
  endAt: '2026-12-01T16:00:00.000Z',
  timeZone: 'America/New_York',
  bufferBeforeMinutes: 10, bufferAfterMinutes: 10,
}, { idempotencyKey: crypto.randomUUID() });
```

Omitted person owner means the initiating user. Rooms/equipment are ownerless
unless an admitted manager explicitly supplies an owner. Labels are presentation,
not user creation or permission. IDs are server-generated and scope/principal/key
bound. Client fields attempting to override scope, actor, operation or creation
identity are rejected, not normalized away.

## Operations

| Facade | Result / requirement |
| --- | --- |
| `resources.list({limit?, after?}, {signal?}?)` | Authorized resource page; follow `nextAfter` while truncated |
| `resources.create(input, {idempotencyKey, signal?})` | Safe accepted receipt; own-person or delegated manager |
| `resources.setGrants(id, userId, grants, control)` | Full explicit grant set, `[]` revokes; current manage right |
| `availability.get(resourceId, {signal?}?)` | Current explicit policy and resource revision; book or details right |
| `availability.replace(resourceId, policy, control)` | Replace bounded windows/unrestricted policy; current manage right |
| `availability.watch(resourceId, listener, {signal?, onError?}?)` | Current authorized policy snapshots; returns unsubscribe |
| `appointments.query(range, {signal?}?)` | Authorized confirmed-appointment page; all co-resources must allow details |
| `appointments.get(id, {signal?}?)` | Current detail, including cancelled state; denied/missing concealed alike |
| `appointments.create(input, options)` | Atomic capacity-one reservation on every selected resource |
| `appointments.reschedule(id, input, control)` | Exact revision, instants, zone and both buffers required |
| `appointments.cancel(id, control)` | Explicit command after UI confirmation, releases all reservations |
| `blocks.query(range, {signal?}?)` | Active private blocks; all co-resources must allow details before pagination |
| `blocks.get(id, {signal?}?)` | Current private block, including cancelled history; all co-resources allow details |
| `blocks.create(input, options)` | Current manage right on every selected resource; atomically reject occupied time |
| `blocks.reschedule(id, input, control)` | Exact revision, UTC instants and zone; resource set remains fixed |
| `blocks.cancel(id, control)` | Explicit confirmed cancellation releases all block reservations, retains history |
| `blocks.watch(range, listener, {signal?, onError?}?)` | Active private block snapshots with current all-co-resource authorization; returns unsubscribe |
| `busy.query(range, {signal?}?)` | Appointment-buffer and block occupancy in one bounded order; no target IDs, titles or attendees |
| `receipts.get(originalKey, {signal?}?)` | Original safe outcome or null; current target rights still required |
| `appointments.watch(range, listener, {signal?, onError?}?)` | Initial/fresh authorized pages and commit invalidation flag; returns unsubscribe |

`control` is `{expectedRevision, idempotencyKey, signal?}`. Every command requires
an explicit stable idempotency key. Receipts include only `requestId`, operation,
target ID, revision and `changed`; never an old private appointment snapshot.

A range is `{resourceIds, startAt, endAt, limit?}`. It is half-open, positive,
bounded at 31 days / 16 resources / 100 results (or narrower config). Empty
selection stays empty. Queries never seed fictional calendars. `truncated: true`
means incomplete; narrow/split the query and never interpret it as complete
availability. Resources use stable keyset continuation; appointment ranges do not
provide unbounded offset paging or global counts.

Block ranges use the same bounds and return active records only. Guessed-ID reads
conceal missing and denied objects alike, including cancelled history. A private
multi-resource block is omitted before membership/truncation unless every
co-resource permits details, even when only one resource was selected. Busy-only
grants reveal just `{resourceId,startAt,endAt}` for either kind of reservation;
no block/appointment discriminator, private title or record ID is returned.

Canonical UTC ISO milliseconds are required by browser contracts. Server time
helpers also admit exact integer epochs internally. Scheduling zones do not
reinterpret the instants. Buffers are 0–1,440 minutes each; appointment duration
is positive and at most 31 days. Exact adjacency is allowed; buffered overlap is
rejected transactionally. No host-timezone, DST-fold, duration, working-hours or
quarter-hour assumption is silently applied by the backend.

## Explicit availability and one-off blocks

Each resource starts with unrestricted availability for backward compatibility.
`availability.replace` supplies the complete policy: either
`{mode:'unrestricted', windows:[]}` or `{mode:'windows', windows:[{startAt,endAt}]}`.
Windows are positive, exact UTC intervals. At most 100 are accepted before
normalization; overlapping and adjacent windows merge into one canonical policy.
`{mode:'windows', windows:[]}` is deliberately closed, not a fallback to unrestricted.
The returned `resourceRevision` is the control revision, shared with grant changes;
`timeZone` remains the explicitly configured resource scheduling zone. Reading
policy requires book or details rights, not a busy-only grant.

A new appointment's entire buffered occupied interval must fit one effective
window on every resource. A reschedule that changes UTC occupancy must satisfy
the current policy. Restricting policy does not cancel or move previously accepted
appointments: unchanged occupancy and a zone-only correction remain grandfathered.
Availability replacement uses the exact resource revision, safe immutable receipts,
and source-atomic audit; normalized no-ops create neither a false change nor a new
policy generation. These explicit windows do not expand recurring local working
hours, holidays or DST rules, calculate a provider's presence, or offer bookable slots.

`blocks.create` takes `{resourceIds,title,startAt,endAt,timeZone}`. A block has no
buffers, positive duration of at most 31 days, and `active` or `cancelled` status.
Its creator, canonical UTC instants, zone, revision and resource membership remain
private domain data. Creation and rescheduling require current manage on every
resource, including unselected co-resources on an existing block. Book or details
alone is insufficient. Blocks can close time outside availability windows, but
cannot overlap any active block or confirmed appointment's buffered occupancy.
Exact half-open adjacency is permitted. Neither a block nor a restrictive policy
silently cancels another reservation.

`blocks.reschedule` explicitly supplies only `{startAt,endAt,timeZone}`; changing
resource membership or adding appointment buffers is rejected. Cancellation
requires deliberate confirmation in the calling UI and releases every block
reservation atomically, while retaining the cancelled record and safe receipts.
The `block.created`, `block.rescheduled` and `block.cancelled` receipts use the
same scope/principal/request-key namespace as resource and appointment commands;
reusing a key across command families conflicts. Replay and receipt reconciliation
still require current manage rights on all block resources, not historical grants.

## Outcome and recovery

A matching receipt is an accepted source commit, **not** proof that a person
viewed it or any notification was delivered. Genuine no-ops return `changed:false`
without revision or false audit change. Stale revisions, capacity/booking conflicts,
denied reads and unavailable setup have closed stable `CALENDAR_*` failures.
`CALENDAR_AVAILABILITY_CONFLICT` rejects a new or changed appointment interval
outside the current resource windows; it is distinct from occupied-time conflict.

`CALENDAR_OUTCOME_UNKNOWN` means the operation may have committed: retain the
original key, reconcile through `receipts.get`, and separately reload authorized
current data. A missing or inaccessible receipt is not proof of rollback.
Never generate a new key and automatically resend after timeout, transport loss,
revocation, malformed acknowledgment or an unknown outcome. Exact replay does
not grant historical permissions; current target rights are checked even when
the native Fabric transport returns a retained receipt.

The browser exposes privacy-safe `CalendarMutationError` with
`requiresReconciliation`, `requiresSameIdempotencyKey`, `idempotencyKey`, outcome,
stable code and status. No provider/SQL/body text is reflected. Read errors expose
static messages. Unsubscribe/abort, account/tenant replacement and authorization
invalidation retire old callbacks and snapshots. A reconnect is marked separately
from actual commit invalidation. SSE is authenticated fetch under `/api/calendar`,
not a second unauthenticated Sync database or a browser-selected Fabric scope.

Appointments, blocks and explicit availability all expose `watch`. Each watch
subscribes to payload-free source-commit hints, then performs a current-authority
read. The browser uses private SSE at `/api/calendar/appointments/live`,
`/api/calendar/blocks/live` or `/api/calendar/availability/:id/live`; applications
should use the facade rather than constructing these transports. Slow readers
retain a dirty hint, not another private snapshot, and reauthorize before a later
publication. Quiet revalidation does not emit an unchanged snapshot or an audit
event. Exact receipt replay emits no source hint; accepting a new-key no-op can
still commit its private receipt and therefore invalidate a watch, without
manufacturing a semantic change event.

Always retire subscriptions when their owner closes and clear retained private
presentation on `onError`. Account/scope replacement retires the SDK's old
callbacks. A watch error is not permission to retain denied rows, infer rollback
or replay a write. A healthy stream renewal reports `reconnected` separately
from `invalidated`; reconnecting is a read, not a new scheduling operation.

## Browser composition

```tsx
import { ConnectedCalendarWorkspace } from '@zero/framework/calendar';

<ConnectedCalendarWorkspace
  displayTimeZone="America/New_York"
  onSetupRequested={openAppCalendarSetup}
/>
```

The connected workspace composes existing native fields, controls, overlays and
day/week/month/list presentations without switching an app theme. Its core editor
is explicitly limited to supported one-off fields; the original richer local
`AppointmentEditor` remains unchanged and synchronous. It is not safe to pass an
async persistence callback to that synchronous local editor.

The display timezone is mandatory and separate from each resource scheduling
zone. Month reads split into bounded ranges. Minute-precision editing rejects
ambiguous/nonexistent local times instead of choosing an offset. Overnight,
sub-minute, DST-transition and outside-7-AM–7-PM records remain available in an
exact-instant companion list; the current grid cannot faithfully edit them.
Unknown submissions retain their original identity and offer explicit
reconciliation. Current core UI does not administer resource grants; use the
scoped facade in an app-owned setup surface until native management ships.

Catalog Previous/Next controls use native resource continuation, retain only the
current authorized page and explicitly clear selection on a page change. The
catalog is a paged read, not an independent live identity-directory subscription;
unselected labels refresh through reload, page change or scope replacement.
Existing-appointment editors reauthorize details on source invalidation,
reconnect and changed result membership. Access denial retires the form; a changed
base revision blocks a stale write without silently rebasing the user's draft.

The workspace's generated-request ledger is currently in memory and scope-owned.
It preserves an unsettled key across overlay retirement during that mount, not a
full browser reload. The typed SDK error returns the original key for app-owned
durable reconciliation. Persistent UI request recovery and a resource-management
workspace remain separate unfinished qualification/features; do not promise them.

The connected appointment grid requires detail rights for selected resources.
Busy-only calendars remain available through the redacted `busy.query` facade,
not a silently upgraded detail feed in this initial workspace. Managers should
assign rights deliberately; hidden UI actions never replace server checks.

The connected workspace remains the supported one-off appointment UI. Availability
and block management use the scoped facades above until a dedicated native
management surface is implemented; this stage does not retrofit the richer local
editor or self-booking preview, nor change the approved hosted demo. Private
effect-reference intents remain handoff groundwork, not dispatch, reminder or
notification work.
