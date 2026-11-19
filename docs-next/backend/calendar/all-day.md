---
id: zero.backend.calendar.all-day
type: reference
audience: [developer, agent]
owner: calendar
status: draft
visibility: internal
system: calendar
feature: local-date-appointments
maturity: experimental
applies_to: ["feature/calendar-backend-foundation; source integration, not selected for zero-update"]
---

# All-day appointments and authored dates

[Calendar index](./index.md) · [Facade](./facade.md) ·
[Frontend composition](../../frontend/calendar/index.md) · [Qualification](./qualification.md)

All-day appointments are a distinct date-based interval, not timed appointments
with hidden midnight values. The first supported family is **untyped
appointments**. Holds and resource blocks retain their existing timed contracts;
recurring series and public booking are separate capabilities.

This is branch documentation, not a claim that the feature is already available
through the normal updater. Use the exact installed package's documentation.

## Create through the existing facade

After current Guardian admission and Calendar setup:

```ts
const calendar = zero.calendar;
if (!calendar) throw new Error('Calendar is not enabled.');
const receipt = await calendar.appointments.create({
  resourceIds: [resource.id],
  title: 'Planning retreat',
  interval: {
    kind: 'all-day-local-v1',
    startDate: '2026-11-02',
    endDate: '2026-11-04',
    timeZone: 'America/New_York',
  },
}, { idempotencyKey: requestId });
```

The end date is **exclusive**: this example includes November 2 and 3. Use strict
Gregorian `YYYY-MM-DD` strings, years 0000–9999, a positive interval of at most 31
nominal days and an explicit scheduling timezone. Do not mix `interval` with
flat `startAt`, `endAt`, `timeZone` or buffer fields. All-day buffers are zero.
Its occupied UTC range must still fit actual current availability and must not
conflict with appointments, blocks or live holds on any selected resource.
Ordinary 9–5 availability is not permission to occupy an entire day.

The existing `CalendarAppointmentInput` interface and flat timed wire shape are
unchanged. `CalendarAppointmentCreateInput` adds the explicit interval branch;
`CalendarAppointmentIntervalInput` describes either an all-day intent or an
explicit `timed-v1` intent with both buffer values supplied. This keeps existing
typed application code usable without forcing a new union into old interfaces.

## Edit without reinterpreting history

Metadata-only edits omit `interval`:

```ts
await calendar.appointments.update(record.id, { title: 'Revised title' }, {
  expectedRevision: record.revision,
  idempotencyKey: requestId,
});
```

The accepted dates, timezone token and UTC boundaries remain frozen. An identical
authored date/zone tuple also reuses the accepted fact. Current timezone rules are
not consulted merely to read, rename, cancel or reconcile that appointment.
Fresh changed interval admission is the point where timezone conversion occurs.

Conversion from timed to all-day is explicit. If a minute-based appointment type
is bound, the caller must explicitly supply `appointmentType: null` as well as
the new date interval. A resource's required-type policy can still reject the
untyped result. Resource ownership or ordinary management is not an override.
The editor requires the user to remove a selected minute type before selecting
all-day; it does not silently clear the type.

To convert back, supply an explicit nested `timed-v1` interval with start/end
instants, scheduling zone and both buffers. A legacy flat reschedule is not
permission to reinterpret an all-day record. Original accepted timed requests
retain their exact replay identities; a new key must never be used to guess
whether an uncertain previous operation committed.

All changes retain the existing atomic update, expected revision, current
all-resource authorization, participant fence, private history, semantic audit,
receipt and integration-effect contracts. A no-op returns `changed: false`
without manufacturing an edit event. Changing an authored date/kind/zone is a
meaningful edit even if its derived UTC instants happen to match.

## Query the date labels, not the viewer's midnight

```ts
const query = {
  resourceIds: selectedResourceIds,
  startDate: '2026-11-01',
  endDate: '2026-12-01',
};
const page = await client.calendar.appointments.queryDates(query);

const stop = client.calendar.appointments.watchDates(query, onPage, {
  onError: withdrawPrivateContent,
});
```

`queryDates`/`watchDates` return only non-cancelled source appointments with
all-day date ranges overlapping the exclusive query range. Optional completed/
no-show lifecycle outcomes retain their existing occupancy meaning. The range is
at most 31 nominal days, narrowed by `maxRangeDays`; page/resource limits are
also the ordinary configured limits. Complete co-resource details authorization
is applied before pagination, so truncation does not reveal hidden records.
The actor uses the indexed current-date projection and bounded date lookback,
not a scan of retained time history.

An all-day `CalendarAppointmentView` adds an `interval` containing the authoritative
dates and authored timezone. Its existing UTC projection fields remain available
for occupancy. Ordinary timed view JSON is unchanged. Existing UTC appointment
queries and redacted busy queries keep their instant-range semantics.

For example, a Kiritimati-authored January 1 can lie outside Honolulu's January 1
UTC window. Do not derive all-day labels by converting UTC instants into the
viewer timezone or manufacture midnight `ScheduleEvent` values. Use
`useCalendarAppointmentDates` and the native all-day projection/lanes.

The connected workspace combines bounded instant and date watches, preserves
logical appointment/revision identity, withdraws denied data and exposes
truncation instead of pretending an incomplete page is complete. Its date field
uses native Calendar/Popover/Input components with civil/UTC conversion, not the
operating system's date input. Standalone preview defaults remain unchanged.

## Storage, migration and limits

Native 017 adds immutable conversion history, sealed current time/date projection
and a date index. Old timed records are not rewritten into guessed all-day data.
Original 001–016 functions/checksums, identities, successful migration history and
receipts remain intact. Both genuine pre-manifest and staged016 identities remain
historical policy pins. Explicit preparation must prove the existing owner before
migration; an old physical schema is not silently accepted as current.

A local date can be 23, 24, 25 or a non-hour number of elapsed hours. Conversion uses
the first valid instant of each boundary date. A wholly missing boundary date
rejects; the date is never silently shifted. There must be a representable
four-digit exclusive end. Occupancy is positive and at most 33 elapsed days,
without changing the existing 31-elapsed-day timed limit. Conversion provenance
records the runtime/ICU engine; this is not a promise of a bundled pinned tzdb.

The native time-history budget is finite. Rejection rolls back the complete
parent/reservation/history/receipt/effect transaction; no partial conversion is
accepted. Reads of already accepted facts and reconciliation retain their
original identities under pressure.

Capability discovery advertises `allDayAppointments: true` on supporting servers.
Older packages omit it and should not display enabled controls. Discovery alone
does not prove per-owner storage/migration or provider readiness. Physical actor,
WAL/HOT, real-browser and installed-package qualification are tracked separately
in the qualification record; MEMORY tests do not substitute for those gates.
