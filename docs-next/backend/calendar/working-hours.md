---
id: zero.backend.calendar.working-hours
type: reference
audience: [developer, agent, operator]
owner: calendar
status: draft
visibility: internal
system: calendar
feature: working-hours
maturity: experimental
---

# Weekly working hours and date exceptions

[Calendar index](./index.md) · [Facade](./facade.md) · [Qualification](./qualification.md)

This is **unreleased feature-branch source**, not a newly selected `zero-update`
archive. Weekly resource availability is not recurring appointments, a free-slot
offer, public booking, a reminder or an automatically maintained horizon. The
approved hosted demo and its visual design are unchanged.

## One policy facade, two explicit formats

The admitted server `zero.calendar` and browser `client.calendar` expose the same
`availability.policy.get`, `.replace` and `.watch` contracts:

```ts
const current = await client.calendar.availability.policy.get(resourceId);
await client.calendar.availability.policy.replace(resourceId, {
  kind: 'weekly-local-v1',
  coverage: { from: '2027-01-01', until: '2028-01-01' }, // until is exclusive
  fold: 'earlier',
  weekly: [
    { day: 1, windows: [{ startMinute: 540, endMinute: 1020 }] },
    { day: 2, windows: [{ startMinute: 540, endMinute: 1020 }] },
  ],
  overrides: [{ date: '2027-01-04', windows: [] }],
}, { idempotencyKey, expectedRevision: current.resourceRevision });

const stop = client.calendar.availability.policy.watch(resourceId, onCurrentPolicy, {
  onError: retirePrivatePresentation,
});
// Call stop() on owner retirement. Client/authority replacement also retires it.
```

ISO weekdays are Monday `1` through Sunday `7`. Missing weekdays are closed.
An override is the complete replacement for that civil date; `[]` closes it.
Dates are explicit application-owned decisions, not inferred country holidays,
network feeds, patient rules or a location-permission system.

The scheduling zone comes from the authorized resource, not the browser, host,
display zone or submitted policy. Same-day wall-minute windows satisfy
`0 <= startMinute < endMinute <= 1440`. Split overnight hours into the two civil
dates explicitly, so closing a holiday removes that date's morning spillover too.
Overlapping/adjacent windows normalize to their union; duplicate weekdays or
override dates reject instead of relying on array order.

The compatible explicit format is:

```ts
{ kind: 'explicit-utc-v1', mode: 'unrestricted', windows: [] }
// Or mode: 'windows' with canonical UTC { startAt, endAt } intervals.
```

The selected source is the **whole availability policy**, not a hidden
intersection of old UTC and new local rules. Replacing with an explicit format
is a deliberate versioned transition. Old `availability.get/watch` can still
represent selected explicit state. While weekly state is active, those old reads
and new legacy replacement commands reject with
`CALENDAR_AVAILABILITY_FORMAT_UNSUPPORTED`; they never return a stale old policy
or silently restore it. Accepted old command replay is checked first, retains its
original receipt and does not change the selected current format.

## Finite coverage and booking truth

Weekly coverage is an explicit local date interval, at most 366 nominal days.
It is evaluated by the native source writer and retained as exact UTC coverage
and normalized UTC windows. Outside that snapshot is **unqualified**, not free
or unrestricted. New booking and hold admission requires the entire buffered
occupied interval inside coverage on every reserved resource; otherwise it
returns `CALENDAR_AVAILABILITY_COVERAGE_REQUIRED`. An interval inside coverage
but outside permitted windows returns `CALENDAR_AVAILABILITY_CONFLICT`.

Coverage does not establish that all future series reservations are represented.
The source's later recurrence-coverage watermark remains a separate requirement
before a future slot can be guaranteed. Empty appointment queries and working
hours alone are not authoritative offers.

Changing policy advances the shared resource revision. Old holds therefore become
stale rather than confirming under a different availability generation. Restrictive
changes do not cancel or move accepted appointments. Current unchanged occupancy
and historical accepted receipts retain their existing grandfathering/replay rules;
new or changed occupancy is checked against the selected current policy. All
co-resource checks and reservation writes share the same source transaction.

## Time conversion and retained snapshots

Only a fresh, meaningful weekly policy write uses the runtime's native Temporal
implementation. Replay and source no-op checks precede conversion. Unsupported
runtime support produces `CALENDAR_TIME_RULES_UNAVAILABLE`, not guessed offsets
or fallback unrestricted policy. No dependency download or provider call occurs.

Same-date repeated boundaries use the stored `earlier` or `later` choice.
`endMinute: 1440` is different: it is the exclusive boundary of the following
civil date, so a repeated next midnight uses its **earlier** occurrence. Yesterday's
window therefore cannot spill into the first occurrence of an explicitly closed
next date, or exceed coverage ending on that date. An authored same-date boundary
such as minute `0` still honors `fold`. Nonexistent
boundaries are detected by roundtrip: a generated weekly window is skipped as a
whole and its date appears in bounded `skippedDates`; an explicitly authored date
override with that defect rejects for correction. Valid boundaries spanning a
clock change keep actual elapsed UTC duration. A missing midnight uses the civil
date's actual first instant for coverage; an entirely missing boundary date rejects.
These are this dialect's rules, not a claim to implement an appointment RRULE.
The underlying disambiguation mechanism is described in the
[Temporal ZonedDateTime reference](https://tc39.es/proposal-temporal/docs/zoneddatetime.html).

Immutable UTC windows are stored with the source. Booking uses an indexed current
generation and at most one preceding normalized window, never expands weeks or
scans retained history. Retained reads/bookings do not require Temporal and do not
silently reinterpret policy after a runtime/timezone-data update. A deliberately
changed source rematerializes; an identical no-op does not. Runtime and ICU versions
are provenance, **not** a claimed pin of the IANA timezone database.

## Permissions, receipts and evidence

Current resource book or detail rights admit policy reads; current resource manage
rights admit replacement. Busy-only access does not expose the source. Existing
Guardian scope, tenant isolation, source revocation, final commit and live-read
retirement remain authoritative. A browser cannot supply engine metadata, UTC
expansion, target identity, scope, actor or source revision as an authorization claim.

The safe receipt operation is `resource.availability-policy-changed`. It shares the
existing scope/principal/request-key namespace and requires exact resource CAS.
New-key semantic no-ops retain their own command receipt but no policy generation,
effect reference or false change audit. Unknown outcomes retain their original
identity; receipt lookup is not permission to replay with a new key. Semantic audit
contains target identity, revision, format and bounded window count—not source
rules, dates, times, labels or clinical content.

Public policy views contain `{ resourceId, resourceRevision, timeZone, policy,
materialization }`. Explicit policy materialization is `null`; weekly metadata
contains UTC coverage, engine provenance, skipped dates and window count. Private
expanded window rows are not copied into the response. The SDK strictly validates
these projections; `useCalendarAvailabilityPolicy(id, readRevision?)` uses the
existing scope-owned live hook and masks retired targets before effect cleanup.

## Bounds, adoption and remaining work

Inputs admit at most seven unique weekdays, eight windows per day, 128 date
overrides and 24 KiB normalized source. Materialization rejects above 1,024
generated windows **before** merging; it never truncates and claims completion.
The retained per-file budgets are 100,000 policy generations and 1,000,000 window
rows, alongside the existing global command-receipt budget. Capacity rejection
rolls back source, pointer, quota, receipt and audit together. Nothing auto-prunes
accepted history or rotates scopes to evade these bounds.

Additive source migration `009` leaves every `001`–`008` function, schema generation,
receipt and accepted UTC appointment intact, without backfill. The current selector,
source history and frozen windows are private Fabric state. Missing referenced
history, invalid legacy pointers, lost selectors with retained new history and
incomplete generations fail closed rather than becoming unrestricted availability.
Disabling calendar remains inert and does not delete this state.

There is no new working-hours management UI in this pass. Use the scoped facade
for an app-owned setup surface; the connected appointment editor automatically
uses canonical booking admission but does not pretend its local preview edits
these rules. Automatic coverage extension, appointment series and Jobs/Torrent
effects remain later approved stages. Physical upgrade/recovery, real-browser,
bundled Linux and exact archive/updater qualification are still outstanding;
see the qualification record before adopting this source work in an application.
