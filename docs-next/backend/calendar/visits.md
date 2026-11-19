---
id: zero.backend.calendar.visits
type: reference
audience: [developer, agent]
owner: calendar
status: draft
visibility: internal
system: calendar
feature: visit-bindings
maturity: experimental
---

# Visit modes and retained locations

[Calendar index](./index.md) · [Facade](./facade.md) · [Lifecycle](./lifecycle.md) ·
[Qualification](./qualification.md)

Feature-branch source, not a released calendar backend. A visit binding describes
how/where an appointment is planned. It is separate from appointment confirmation,
clinical progress, office/telehealth lobby membership, participant identity,
presence and provider connectivity. A video binding does not create a call link.

## Explicit, optional input

Appointment creation and authenticated hold acquisition accept optional `visit`:

```ts
{ mode: 'in-person', location: { id: locationId, revision: locationRevision } }
{ mode: 'video' }
{ mode: 'phone' }
```

Omission means unspecified, not an inferred video or physical appointment.
`location` is forbidden for phone/video. Manual addresses, call URLs, provider
configuration and arbitrary extra fields are not part of this contract.
Existing no-visit commands and their original typed/untyped request digests remain
unchanged. No retained appointment or hold is automatically backfilled.

An in-person binding selects one current active location version. It must belong
to the current location assignment of **every** reserved resource. Provider, room
and equipment calendars with no matching assignment are not silently treated as
global. A scope manager does not bypass this compatibility rule. All ordinary
book/manage/resource-active/availability/type/conflict checks still apply.

Assignments are calendar metadata, not legal licensure, clinical eligibility or
a new permission grant. A scheduling app must not use an editable location label,
region or assignment as proof that a person is authorized to practice somewhere.
The separate effective-dated/trusted eligibility integration remains planned.
A location is not itself a capacity-one reservation; reserve an appropriate room
resource when room capacity matters.

## Authorized selector

Use the supported selector instead of listing every location and filtering in CSS:

```ts
const page = await calendar.locations.forVisit({
  resourceIds: [providerId, roomId], limit: 10,
});
// { items: [{ id, revision, label, region, active: true }],
//   truncated, nextAfter }
```

Book/manage access to every selected resource is checked before location lookup,
counts, limits or cursors. Busy/details-only grants do not admit this booking
selector. An explicit empty selection returns an empty page, including for a scope
manager. Missing `resourceIds` is invalid; it does not mean the full catalog.
Follow `nextAfter` while truncated and keep the same resource selection.

`locations.watchForVisit(query, listener, options)` and
`useCalendarVisitLocations(query | null)` use native scoped invalidation, quiet
revalidation and private SSE. Changing selection withdraws the old page before
late callbacks can publish; denial retires choices. Policy/grant/assignment changes
are evaluated on fresh reads. A picker never confers booking authority.

## Historical snapshots, edits and holds

Private appointment/hold views include an optional visit snapshot. In-person
snapshots resolve the accepted location generation's ID, revision, label and region
from retained immutable history. Renaming, deactivating or reassigning a location
does not rewrite older bookings. Phone/video snapshots contain only the mode.
Busy views do not include visit mode, location identity, label or region.

Reschedule semantics are explicit:

| `visit` input | Meaning |
| --- | --- |
| Omitted | Preserve the binding at the submitted expected appointment revision |
| Explicit visit | Replace with that exact mode/location generation |
| `null` | Clear to unspecified |

An occupancy or visit-binding change freshly checks the in-person location's
current version, active state and current assignments. Unchanged binding with a
no-op/timezone-only correction remains grandfathered. A type-only edit with
unchanged occupancy preserves the existing visit; a visit-only edit does not
require fresh availability. All changes still share the canonical appointment
revision and atomic reservation decision. A terminal lifecycle outcome cannot be
bypassed by editing visit metadata.

Unavailable assignment combinations return `CALENDAR_VISIT_CONFLICT`. An admitted
location whose requested version is no longer current/active returns
`CALENDAR_VISIT_STALE`. New admission checks assignment policy before looking up a
client-selected catalog generation; hidden IDs are not an existence oracle.
Review current choices instead of blindly retrying under a new key.

Assignments can now be explicit all-time or effective-UTC policies. Fresh in-person
admission must cover the whole buffered occupied interval on every resource;
directory membership alone is not that proof. `locations.forVisit` can filter by
explicit occupied UTC bounds, while omission remains directory discovery only.
See [Effective location policies](./location-policies.md) for versioned authoring,
private discovery, static compatibility and accepted-history preservation.

Holds capture their fixed visit at acquisition. Confirmation accepts only the
normal title, rechecks the captured visit/type/resource/expiry state and transfers
the exact binding through the canonical appointment writer before consuming the
hold. A stale or incompatible visit rejects the entire transaction; it cannot
produce an appointment while leaving a consumed or partially transferred hold.
Grant/assignment revisions also retain their existing hold-staleness fences.

Accepted replay returns the original safe receipt under current caller/object
rights. Later location changes do not invalidate that accepted outcome. Unknown
delivery retains the original request identity for reconciliation; do not silently
switch to a new location, acquire another hold or resend an accepted operation.

## Connected UI and integration boundaries

The connected one-off editor provides explicit Unspecified/In-person/Video/Phone
controls and a bounded authorized location picker. It preserves selected historical
versions rather than silently selecting a newer location. `CalendarVisitFields`
is separately composable; its caller supplies the authorized page and navigation.
It uses the existing tokenized calendar anatomy and native select/popover behavior.
It is not a new theme or separate overlay manager.

The native editor preserves drafts on transient management-read failure while
disabling submission until access is reverified; known denial retires the owner.
Control-character titles/reasons are rejected before creating a dispatched request
identity. Matching accepted receipts preserve newer edits and unknown outcomes
remain explicit. Real-browser/focus/motion acceptance is still required.

Visit facts use additive migration `007`, immutable appointment binding history,
advancing current pointers and fixed hold bindings. Every older schema/migration
identity is retained. The appointment visit-history budget is 100,000 retained
generations; hold bindings are bounded by the existing retained-hold budget.
Source audit adds only fixed `visitMode`/`visitChanged` metadata, never labels,
region values, chosen location IDs, call URLs or sensitive content. No-op, replay
and rollback do not manufacture activity. No email, invitation, reminder, AI or
telehealth provider is enabled by a visit binding.
