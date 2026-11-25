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
| `lifecycle.get(options?)` | Current versioned scope lifecycle/reason policy; scope calendar manager only |
| `lifecycle.replace(policy, control)` | Complete policy replacement with exact revision; scope calendar manager only |
| `lifecycle.watch(listener, options?)` | Live manager-only policy with normal authority retirement |
| `resources.list({limit?, after?, locationIds?, regions?}, {signal?}?)` | Authorized resource page narrowed by current location facets; follow `nextAfter` while truncated |
| `resources.watch(query, listener, options?)` | Authorized live resource pages, including current assignments and grant changes |
| `resources.create(input, {idempotencyKey, signal?})` | Safe accepted receipt; own-person or delegated manager |
| `resources.setGrants(id, userId, grants, control)` | Full explicit grant set, `[]` revokes; current manage right |
| `overrides.grants.get(resourceId, userId, options?)` / `watch(resourceId, userId, listener, options?)` | Separate exception grants; ordinary resource manage and independent grant administration |
| `overrides.grants.replace(resourceId, userId, {categories}, control)` | Exact resource revision; independent administrator and finalized current-scope target; `[]` revokes |
| `resources.setLocations(id, locationIds, control)` | Replace location set; current resource manage and expected resource revision |
| `locations.list({limit?, after?}?, options?)` | Authorized current location catalog; no hidden assignments or counts |
| `locations.get(id, options?)` | Current authorized location revision, including retained inactive metadata |
| `locations.create({label, region?, active?}, options)` | Scope calendar manager only; omitted region is null, active defaults true |
| `locations.replace(id, {label, region, active}, control)` | Explicit full replacement; scope manager and exact location revision |
| `locations.forResource(resourceId, options?)` | `{resourceId, resourceRevision, locationIds}` under current resource visibility |
| `locations.forVisit({resourceIds, interval?, limit?, after?}, options?)` | Active current intersection; explicit occupied UTC `interval` also filters whole-interval eligibility before pagination, `[]` always empty |
| `locations.watchForVisit(query, listener, options?)` | Live assignment-compatible booking selector with current authority |
| `locations.watch(query, listener, options?)` | Authorized live location catalog pages |
| `locations.watchLocation(id, listener, options?)` | Live detail; losing the last visible assignment retires the detail |
| `locations.watchForResource(resourceId, listener, options?)` | Live assignments; losing resource access retires the detail |
| `locations.policy.get(resourceId, options?)` / `watch(resourceId, listener, options?)` | Authoritative static/effective assignment source; current resource book/detail rights |
| `locations.policy.replace(resourceId, policy, control)` | Atomic versioned static or effective-UTC assignment policy; current resource manage rights |
| `capabilities.get(options?)` / `watch(listener, options?)` | Current scoped UI flags and configured limits; no owner/file/actor allocation or account enumeration |
| `types.list({resourceIds?, limit?, after?}?, options?)` | Authorized active-type intersection for selected resources; manager omission lists the full catalog |
| `types.get(id, options?)` | Current catalog revision; scope calendar manager only |
| `types.create(input, options)` | Create a versioned type; scope calendar manager only |
| `types.replace(id, fullType, control)` | Full replacement at the exact type revision; scope calendar manager only |
| `types.forResource(resourceId, options?)` | `{resourceId, resourceRevision, mode, typeIds}`; current book/details/manage |
| `types.watch(query, listener, options?)` | Live authorized type-selector catalog |
| `types.watchType(id, listener, options?)` | Live manager-only catalog detail |
| `types.watchForResource(id, listener, options?)` | Live current resource type policy |
| `resources.setAppointmentTypes(id, {mode, typeIds}, control)` | Versioned resource policy; scope calendar manager only |
| `availability.get(resourceId, {signal?}?)` | Current explicit policy and resource revision; book or details right |
| `availability.policy.get(resourceId, options?)` / `watch(resourceId, listener, options?)` | Versioned selected source and bounded materialization metadata; current book/detail rights |
| `availability.policy.replace(resourceId, policy, control)` | Complete explicit-UTC or weekly-local replacement, exact resource revision and manage rights |
| `availability.replace(resourceId, policy, control)` | Replace bounded windows/unrestricted policy; current manage right |
| `availability.watch(resourceId, listener, {signal?, onError?}?)` | Current authorized policy snapshots; returns unsubscribe |
| `appointments.query(range, {signal?}?)` | Authorized confirmed-appointment page; all co-resources must allow details |
| `appointments.queryDates(query, options?)` | Authorized all-day appointment page matched on authored dates, not viewer-zone midnight |
| `appointments.get(id, {signal?}?)` | Current detail, including cancelled state; denied/missing concealed alike |
| `appointments.create(input, options)` | Atomic capacity-one reservation on every selected resource |
| `appointments.reschedule(id, input, control)` | Exact revision, instants, zone and both buffers required |
| `appointments.update(id, patch, control)` | One atomic revision-controlled title/resource/time/type/visit/participant edit; omitted fields preserve accepted facts |
| `appointments.reviewCreate(input, options)` / `reviewUpdate(id, patch, control)` | Readonly independently permitted review of a proposed key; no reservation, receipt or pending mutation |
| `appointments.cancel(id, {...control, reason?})` | Explicit cancellation enforcing current lifecycle/reason rules; releases all reservations |
| `appointments.transitions(id, options?)` | Current effective status, policy/appointment revisions and allowed changes; manage on all co-resources |
| `appointments.transition(id, {status, policyRevision, reason?}, control)` | Canonical status transition, exact current policy and appointment revisions |
| `appointments.watchTransitions(id, listener, options?)` | Live allowed-action projection; current all-co-resource manage rights |
| `participants.directory(query?, options?)` / `watchDirectory(query, listener, options?)` | Explicitly enabled, scope-manager-only native Guardian discovery; opaque bounded continuations |
| `participants.forAppointment(id, options?)` / `forHold(id, options?)` | Private manager-only references with fresh names or unavailable tombstones |
| `participants.replace(id, references, control)` | Revisioned replacement; fresh admission for additions, retained unavailable identities removable |
| `participants.watchForAppointment(id, listener, options?)` / `watchForHold(id, listener, options?)` | Private live binding presentation with SYSTEM and calendar invalidation |
| `blocks.query(range, {signal?}?)` | Active private blocks; all co-resources must allow details before pagination |
| `blocks.get(id, {signal?}?)` | Current private block, including cancelled history; all co-resources allow details |
| `blocks.create(input, options)` | Current manage right on every selected resource; atomically reject occupied time |
| `blocks.reschedule(id, input, control)` | Exact revision, UTC instants and zone; resource set remains fixed |
| `blocks.cancel(id, control)` | Explicit confirmed cancellation releases all block reservations, retains history |
| `blocks.watch(range, listener, {signal?, onError?}?)` | Active private block snapshots with current all-co-resource authorization; returns unsubscribe |
| `holds.query(range, {signal?}?)` | Effective live holds only; subject/current-book or all-co-resource manage authorization before pagination |
| `holds.get(id, {signal?}?)` | Authorized private hold, including virtual expired, released and confirmed history |
| `holds.acquire(input, options)` | Authenticated, server-expiring buffered reservation; current book and active availability on every resource |
| `holds.release(id, control)` | Explicit confirmed release by the current authorized subject or all-co-resource manager |
| `holds.confirm(id, {title}, control)` | Original subject only; atomically create a new ordinary appointment and consume the hold |
| `holds.watch(range, listener, {signal?, onError?}?)` | Current authorized live holds; quiet expiry changes are not source invalidations |
| `busy.query(range, {signal?}?)` | Appointment-buffer, block and live-hold occupancy in one bounded order; no target IDs, titles or attendees |
| `receipts.get(originalKey, {signal?}?)` | Original safe outcome or null; current target rights still required |
| `appointments.watch(range, listener, {signal?, onError?}?)` | Initial/fresh authorized pages and commit invalidation flag; returns unsubscribe |
| `appointments.watchDates(query, listener, options?)` | Live authorized authored-date pages with the same scope retirement and bounded query rules |

[Appointment-specific override options](./overrides.md) preserve the normal receipt
and single-write contract. They never bypass hard policies or make ordinary
resource management sufficient for an exception.

`control` is `{expectedRevision, idempotencyKey, signal?}`. Every command requires
an explicit stable idempotency key. Receipts include only `requestId`, operation,
target ID, revision and `changed`; never an old private appointment snapshot.

See [Lifecycle and required reasons](./lifecycle.md) for simple defaults, richer
confirmation/outcomes, private reasons and legacy cancellation compatibility.
See [Visit modes and retained locations](./visits.md) for optional `visit` on
creation/hold acquisition and reschedule preserve/replace/clear semantics.
See [Effective location policies](./location-policies.md) for time-bounded
assignments, legacy replacement/downgrade and occupied-interval discovery.
See [Native account participants](./participants.md) for explicit configuration,
the additional private permission boundary, hold transfer and unavailable targets.

A range is `{resourceIds, startAt, endAt, limit?}`. It is half-open, positive,
bounded at 31 days / 16 resources / 100 results (or narrower config). Empty
selection stays empty. Queries never seed fictional calendars. `truncated: true`
means incomplete; narrow/split the query and never interpret it as complete
availability. Resources use stable keyset continuation; appointment ranges do not
provide unbounded offset paging or global counts.

Authored-date queries instead take `{resourceIds, startDate, endDate, limit?}`
with an exclusive end and at most 31 nominal days, narrowed by `maxRangeDays`.
They select all-day appointments only. Existing instant-range appointment and
busy queries keep their UTC occupancy semantics. See [All-day appointments](./all-day.md)
for canonical dates, frozen accepted boundaries and the separate date watch.

Block ranges use the same bounds and return active records only. Guessed-ID reads
conceal missing and denied objects alike, including cancelled history. A private
multi-resource block is omitted before membership/truncation unless every
co-resource permits details, even when only one resource was selected. Busy-only
grants reveal just `{resourceId,startAt,endAt}` across appointments, blocks and live
holds; no reservation-kind discriminator, private title or record ID is returned.

Canonical UTC ISO milliseconds are required by browser contracts. Server time
helpers also admit exact integer epochs internally. Scheduling zones do not
reinterpret the instants. Buffers are 0–1,440 minutes each; appointment duration
is positive and at most 31 days. Exact adjacency is allowed; buffered overlap is
rejected transactionally. No host-timezone, DST-fold, duration, working-hours or
quarter-hour assumption is silently applied by the backend.

## Atomic appointment editing

Use `appointments.update` when one Save changes multiple appointment fields.
Do not chain `reschedule`, participant replacement and another write and present
them as an atomic save. The native server and SDK use the same patch contract:

```ts
await calendar.appointments.update(appointment.id, {
  title: 'Updated planning session',
  resourceIds: [replacementCalendar.id],
  startAt: '2026-12-01T16:00:00.000Z',
  endAt: '2026-12-01T17:00:00.000Z',
  timeZone: 'America/New_York',
  bufferBeforeMinutes: 10,
  bufferAfterMinutes: 10,
}, { expectedRevision: appointment.revision, idempotencyKey: originalRequestKey });
```

The nonempty closed patch can contain `title`, a nonempty `resourceIds` set,
`appointmentType`, `visit` and `participants`, plus an explicit interval change.
For the compatible flat timed form, supplying any time/zone/buffer field requires
**all five** interval fields above; no partial interval is guessed. Alternatively,
`interval` accepts the explicit `timed-v1` or `all-day-local-v1` form described in
[All-day appointments](./all-day.md). Nested and flat interval fields cannot be
mixed. Omitting both preserves the accepted kind, dates/instants and boundaries.
Converting an all-day appointment back to timed requires explicit `timed-v1`;
legacy flat reschedule does not reinterpret an all-day record. A timed-to-all-day
conversion with a retained minute-based type must also explicitly clear that type.
Omission preserves accepted fields and bindings. Only type and visit accept
explicit `null`; participant `[]` deliberately clears references and still needs
the configured scope-manager participant permission. New participant targets are
freshly admitted at the final native commit fence, not merely when selected.

The writer requires management of every current co-resource and booking access
to every resulting resource. Current type/location/working-hours and conflict
rules are evaluated where occupancy, assignments or bindings actually change.
Accepted historical metadata is not silently rebound to today's catalog. Removed
resources stop receiving occupancy/detail membership, while retained reservation
identities and immutable prior/update snapshots preserve history. The current
set stays bounded independently of how many past transfers occurred.

One accepted change creates one parent revision, safe receipt, semantic audit
operation and integration mutation in the same source transaction. Rejection
rolls them all back. An authorized original-key replay returns its original safe
receipt; a quiet no-op does not manufacture a change. Genuine post-commit
uncertainty stays unknown and requires reconciliation, never automatic replay.
Terminal appointments reject new edits; history is not reopened by this API.

The legacy `reschedule` and separate participant command remain supported with
their existing identities. Manual create and rich update additionally support
the optional independently authorized [appointment-overlap review](./overrides.md);
this is not a generic force flag and cannot bypass blocks, live holds or other
hard booking policies. Rich editing does not enable recurrence, clinical progress,
invitations or reminders. Those retain their explicit implementation/configuration gates.

## Locations, regions and authorized resource filters

Locations are scope-owned directory metadata with stable IDs and immutable revision
history. A region is an optional, case-sensitive opaque token, such as `US-IN` or
`north`; it is not a geographic lookup, IANA timezone or authorization claim.
Tokens match `[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}`. The backend never infers eligibility
from an address, a self-edited profile or a location label.

Only the admitted scope calendar manager (`manageAll`) creates or replaces global
locations. Owning/managing one provider calendar is not global catalog authority.
Managers can see unassigned/inactive locations for setup. Other users see only
locations currently assigned to at least one resource they can already access.
Visibility is applied before pagination and truncation. A denied or missing ID
returns the same not-found result. Responses expose no hidden provider membership
lists or global counts.

`resources.setLocations` takes at most 16 distinct location IDs. They are normalized
to a sorted set; `[]` deliberately clears assignments. The writer requires current
manage on the resource and its exact revision. A non-global manager may introduce
only currently visible locations: the service resolves a private assignment witness,
and the writer rechecks that witness's current resource permission and membership
inside the source transaction. That proof is internal, never client-authored and
never a substitute for the stable command identity. Hidden IDs cannot be exposed
by attaching them to a resource you own. Newly assigned locations must be active;
an already assigned inactive location can be retained or removed. Assignment changes
increment the resource revision, so older holds fail their captured-resource fence.
Once effective assignment policy is selected, fresh legacy replacements reject
instead of flattening it. Explicit downgrade uses `locations.policy.replace` with
`static-v1`; accepted original receipt replay remains available under current rights.

Both `locationIds` and `regions` filters accept at most 16 distinct entries. An empty
or omitted facet means no narrowing within the authorized resource set, not
permission to discover another resource. Values are ORed within a facet; when both
facets are set, one current assigned location must satisfy both. Selecting an Indiana
region and a Georgia-only location does not match merely because a provider works
at separate locations in both states. An appointment range's empty `resourceIds`
continues to mean no resources; geography filtering never broadens that selection.

Inactive locations/assignments remain readable and filterable history metadata.
Deactivation does not erase, move or cancel accepted appointments. Fresh in-person
bindings require the selected active directory generation and all-resource policy
coverage. The separate visit and effective-location policy APIs establish those
facts; ordinary directory facets do not. See the linked guides for their contracts.

Location and assignment histories each have a 100,000-revision lifetime ceiling;
locations have a 10,000-row ceiling. These are retained budgets, not concurrent
quotas. No-op replacements do not allocate history or false audit events. Migration
`004` preserves preceding schema declarations/checksums and the global
scope/principal/request-key receipt namespace. Current membership projections serve
directory queries; retained assignment history is not scanned for every live page.

Browser hooks `useCalendarResources` and `useCalendarLocations` are live pages;
`useCalendarLocation` and `useCalendarResourceLocations` are live details. They mask
old data during filter, client or scope replacement, clear denied presentation and
retire late callbacks. `refresh()` retries the authorized read, not a mutation.
The connected workspace's resource directory now uses that live path. The rich
demo's geographic filters and the new catalog management editor are not silently
connected by adding these backend APIs.

## Appointment types and booking policy

Types are optional, scope-owned catalogs. A create input requires `label` and
`durationMinutes`; optional `bufferBeforeMinutes`/`bufferAfterMinutes` default to
zero, `colorKey` to null and `active` to true. Duration is an integer 1–44,640
minutes (31 days); each buffer is an integer 0–1,440 minutes. `colorKey` is a nullable
opaque token with the same ASCII syntax as region keys, not arbitrary CSS or an
instruction to change the application theme. Full replacement explicitly supplies
all six fields. IDs/revisions are stable and every changed catalog generation is
retained; there is no delete/relabel-history shortcut.

Only the scope calendar manager edits types or resource type policies. Owning a
provider resource is not permission to weaken its type policy. Resource policy
uses the current **resource** revision, not a catalog type revision:

| Mode | New untyped bookings | New typed bookings |
| --- | --- | --- |
| `unrestricted` with `typeIds:[]` | Allowed | Any active current scope type |
| `optional` | Allowed | Only the explicitly listed types |
| `required` | Rejected | Only the explicitly listed types |

No policy means unrestricted. Policies accept at most 16 distinct type IDs, sorted
to a canonical set. `required` with `[]` deliberately closes the resource to new
bookings; `optional` with `[]` allows only untyped bookings. Unrestricted mode with
a nonempty list is invalid, not silently normalized. Newly assigned types must be
active; a retained inactive member can remain or be removed. Changes advance the
resource revision, fencing older holds, but never cancel accepted appointments.

`types.list({resourceIds:[...]})` first requires current book or details rights on
**every** selected resource, then intersects their current policies before limits
and truncation. Busy-only access is insufficient. Only active types are returned
for selectors. An explicit `resourceIds:[]` is empty for everyone. Omitting the
selection gives a scope manager the complete catalog, including inactive setup
entries; for other users omission is empty, not a global directory. A standalone
`types.get`/`watchType` is manager-only. Existing appointment/hold detail rights
instead authorize the historical type snapshot embedded in that record.

Appointment creation and hold acquisition accept an optional
`appointmentType:{id,revision}`. UTC start/end instants remain explicit; the server
does not guess a wall time or derive an end time. When a type is selected, omitted
buffers come from that exact retained type generation. Explicit buffers and exact
UTC duration must match the selected policy. Every resource must currently permit
the type, and the catalog version must still be active/current at the final short
writer transaction. Untyped input retains all earlier wire and command-digest
semantics; it is rejected only when a current resource policy requires a type.

Authorized typed appointment/hold views add `appointmentType` containing
`{id,revision,label,durationMinutes,bufferBeforeMinutes,bufferAfterMinutes,colorKey}`.
Untyped views omit the property. These facts come from immutable catalog history,
not today's label/defaults. Updating/deactivating a type does not reshape an
accepted appointment or rewrite its old receipt. A hold retains the selected
generation and cannot confirm against a stale/deactivated type or silently become
an untyped appointment.

Rescheduling still explicitly supplies both buffers. Omitted `appointmentType`
preserves the appointment's accepted binding; a reference deliberately switches
to that current generation; null deliberately clears it only if current resource
policies permit untyped bookings. Time/buffer changes or a binding change require
fresh type/policy admission. A genuine no-op or timezone-only correction with
unchanged occupancy/binding remains grandfathered, including an old inactive type.
Binding changes append immutable appointment-revision history; cancellation retains
it. Replaying an earlier reschedule normalizes against its expected revision, not
the later binding, and still checks the original command digest and current rights.

`CALENDAR_TYPE_STALE` and `CALENDAR_TYPE_CONFLICT` are safe 409 known non-commits,
not permission for automatic resend. Re-read the current policy and deliberately
prepare a new logical request if input must change. Lost acknowledgments still
require the original key's receipt reconciliation. A new default or revision is
never substituted behind the user's back.

Typed commands use a versioned catalog-free wire intent, so current resource
policy is checked before resolving a newly requested type or its defaults.
Omitted and explicitly supplied buffers remain distinct typed request inputs;
after an uncertain outcome, preserve the exact original fields as well as its
key. Do not fill omitted defaults into a replay request. Untyped legacy command
digests remain unchanged. This admission order also prevents a rejected request
from distinguishing an unavailable existing type from a missing ID/version.

Types have a 10,000-row retained ceiling; catalog, resource-policy and appointment
binding histories each have a 100,000-generation lifetime ceiling. Typed hold
bindings are one per retained hold, bounded by the existing hold budget. The fifth
receipt family joins the same 200,000 global request budget and cross-family
namespace. Migration `005` preserves the first four migration/schema identities.

Native hooks `useCalendarAppointmentTypes`, `useCalendarAppointmentType` and
`useCalendarResourceTypes` use the existing current-scope watch/retirement path.
The connected one-off editor now selects native types, applies exact elapsed
duration/buffer defaults and preserves accepted historical generations separately
from unsubmitted choices. Catalog/resource-policy administration is still later
work; the rich demo's local type picker is not a backend adapter. See the
[connected workspace](../../frontend/calendar/connected-workspace.md).

## Explicit availability and one-off blocks

The versioned [working-hours facade](./working-hours.md) additionally supports
weekly-local source rules, finite coverage and exact-date exceptions. It is one
selected whole policy, not a hidden intersection with old explicit state. The
older methods below remain compatible for selected explicit policy; weekly state
requires the new policy facade. Historical accepted command replay remains valid
under current target authorization and never switches the active format back.

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

## Authenticated temporary holds

`holds.acquire` takes `{resourceIds,startAt,endAt,timeZone,bufferBeforeMinutes?,
bufferAfterMinutes?,ttlSeconds?}`. It deliberately has no title or client-selected
identity/subject/expiry fields. The broker derives the opaque hold ID and binds
the private record to both the authenticated principal and initiating user.
This is a staff/member facade, not a guest proof or public booking endpoint;
`selfBooking` remains false.

Acquisition atomically checks current book rights, active state, explicit
availability and all appointment/block/live-hold conflicts on every resource.
It uses the same positive interval, buffer and half-open occupancy rules as an
appointment. Requested TTL is an integer from 1 to 900 seconds, defaulting to
300, clipped at the appointment start. The start must be strictly after the
trusted server clock; input cannot supply `now` or choose a later expiry. Fixed
live ceilings are 16 holds per principal and 1,000 per scope, counting only held
records whose expiry is still future. Retained holds have a separate 100,000-row
lifetime budget; all command families share the 200,000-receipt budget. Expiry
does not delete history or reset either retained budget.

The view contains `{id,revision,resourceIds,startAt,endAt,timeZone,
bufferBeforeMinutes,bufferAfterMinutes,status,expiresAt,createdBy,appointmentId}`.
Status is `held`, `expired`, `released` or `confirmed`; `appointmentId` is null
until successful confirmation. Expired is a virtual read state: at
`now >= expiresAt`, a stored held row no longer occupies time, appears in hold
ranges or consumes live quota. No cleanup timer or idle database write is needed.
Even repeated expired holds for the same future interval stop blocking it.
`holds.get` can return this authorized history without changing its revision.

Private reads and release require either the exact principal **and** user subject
with current book rights on every co-resource, or current manage on every
co-resource. Details alone does not expose another subject's hold. A selected
resource may admit book or details for a range, but each matching hold must still
pass its stricter subject/manage check before membership, limit and truncation.
Missing and denied IDs are concealed alike. Busy-only grants see only redacted
occupancy, never private hold IDs.

`holds.release` uses the expected hold revision and explicit calling-UI
confirmation. It atomically releases all hold reservations, including an expired
hold that the caller deliberately releases. An already released row can return
`changed:false` with the current expected revision. A confirmed hold cannot be
released: that rejects with `CALENDAR_HOLD_STALE`, and never claims to cancel its
appointment. Appointment cancellation remains its separate canonical command.

`holds.confirm(id, {title}, control)` is narrower than management: only the
original principal and user may consume a hold, even if another actor manages
all resources. It requires current book on every resource, the exact hold
revision, a still-held/unexpired lease, and every resource revision captured at
acquisition. A grant or availability change can therefore make it stale even
when booking would otherwise remain permitted. `CALENDAR_HOLD_EXPIRED` and
`CALENDAR_HOLD_STALE` distinguish expiry and stale consumption. Resources, UTC
instants, zone, buffers and expiry cannot be edited or renewed; the acquisition
receipt seals membership. Title is supplied only for the new appointment, never
stored on the hold.

Confirmation uses the canonical appointment writer to freshly check active
resources, book rights, availability, conflicts and retained capacity, excepting
only this owned live hold. The same transaction creates the ordinary appointment
and reservations, marks the hold confirmed with its appointment ID, releases the
hold reservations, and commits receipt/evidence. A competing reservation, expiry,
stale revision, late insert or audit-pressure failure rolls the whole attempt
back. The result is an ordinary `appointment.created` receipt with the **new
appointment ID**, revision 1 and `changed:true`, not a `hold.confirmed` receipt or
a hold snapshot. Read the authorized appointment separately.

An acquire replay after expiry still returns its original accepted receipt; it
does not renew or reacquire the hold. A confirmed hold's original confirmation
receipt remains subject-bound and currently authorized. If any hold command has
unknown outcome, keep its original key and reconcile via `receipts.get`, then
reload current authorized state. Do not automatically resend under a new key,
reacquire after expiry, or interpret a missing receipt as rollback.

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

Appointments, blocks, holds, availability and resource/location directories/details
expose live watches. Each watch
subscribes to payload-free source-commit hints, then performs a current-authority
read. The browser uses private SSE at `/api/calendar/appointments/live`,
`/api/calendar/blocks/live`, `/api/calendar/holds/live` or
`/api/calendar/availability/:id/live`, plus the corresponding resource/location
catalog/detail live routes; applications
should use the facade rather than constructing these transports. Slow readers
retain a dirty hint, not another private snapshot, and reauthorize before a later
publication. Quiet revalidation does not emit an unchanged snapshot or an audit
event. Exact receipt replay emits no source hint; accepting a new-key no-op can
still commit its private receipt and therefore invalidate a watch, without
manufacturing a semantic change event.

A quiet hold revalidation can publish a changed page when a lease expires without
any source commit; its update has `invalidated:false`. This is not a synthetic
expiry mutation or audit event. Holds reuse the existing bounded quiet read and
retirement machinery, not a new expiry worker. Revocation, scope/account
replacement, abort and terminal denial still retire old callbacks and snapshots.

Accepted source transitions have separate `calendar.hold.acquired`,
`calendar.hold.released` and `calendar.hold.confirmed` evidence; confirmation also
records ordinary appointment creation. Evidence contains only opaque target and
bounded revision/sequence/resource-count/status facts, not title, scheduling
times, private subject data or copied hold content. Idle expiry, replay, no-op
and rollback never manufacture semantic change facts.

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
day/week/month/list presentations without switching an app theme. Its default
`CalendarAppointmentEditor` reuses the approved rich content with one native async
save/receipt owner, limited to implemented one-off fields. The original local
`AppointmentEditor` remains unchanged and synchronous. Passing an async persistence
callback to that local editor does not install canonical acceptance or recovery.

Current scoped capabilities discover optional participant controls and configured
range/resource/participant limits without allocating a calendar owner. These are
presentation hints, never grants. The workspace bounds itself to two instant-range
streams plus at most two authored-date streams when all-day support is available,
and explicitly requests a shorter view or fewer calendars when narrowed
server limits cannot cover the requested view. It never silently presents a
partial schedule as complete. `participants={false}` opts out of these controls;
`true` cannot override native permission/configuration.

The rich connected editor submits supported title, full-resource-set, timed/all-day
interval, type/visit and changed account-participant fields through one atomic
`appointments.update`, not sequential saves. All-day controls require the server's
`allDayAppointments` capability and use authored-date lanes instead of midnight
timed events. Optional overlap review requires separate capability, independent
per-resource grants and explicit confirmation/reason; it shares that same save owner.
`CalendarCoreEditor` remains separately composable. The native
`CalendarAppointmentParticipantsDialog` also supports participant-only replacement;
legacy reschedule does not also write participants. The reusable pieces, privacy and
exact receipt-revision recovery rules are documented in the
[connected workspace guide](../../frontend/calendar/connected-workspace.md).

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
current resource catalog page is live: grant and assignment changes trigger a
fresh authorized projection, and denial withdraws it. This is not a separate
Guardian identity-directory subscription or a global list of users.
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

The connected workspace remains the supported one-off appointment UI. Availability,
block and authenticated-hold management use the scoped facades above until a
dedicated native management surface is implemented. Rich connected composition does
not turn the standalone local editor or self-booking preview into a backend client,
nor change the approved hosted demo. Private
effect-reference intents remain handoff groundwork, not dispatch, reminder or
notification work.
