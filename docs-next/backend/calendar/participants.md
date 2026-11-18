---
id: zero.backend.calendar.participants
type: reference
audience: [developer, agent, maintainer]
owner: calendar
status: draft
visibility: internal
system: calendar
feature: native-participants
maturity: experimental
---

# Native account participants

[Calendar index](./index.md) · [Configuration](./configuration.md) · [Facade](./facade.md)

This is **unreleased feature-branch source**, not an API in the selected Zero
2.11.0 archive. The standalone hosted demo is unchanged. Calendar participants
are optional native Guardian account references; they are neither invitations nor
calendar access grants. Do not represent a patient/contact/guest as an invented
Guardian user to use this stage.

## Explicit configuration

```ts
calendar: {
  timezone: 'America/New_York',
  manage: 'admin',
  participants: { userEligibility: 'user' },
  maxParticipants: 100,
}
```

Omission or `participants: false` disables the directory and participant-bearing
commands, without deleting existing bindings. An ordinary booking with no
`participants` property still works. Explicit `[]` opts into participant handling;
it is not equivalent to omission for intent identity. The subject rule above
explicitly admits all otherwise eligible in-scope accounts. Use a declared role,
permission or trusted property rule to narrow it. This is the existing compiled
Guardian language, not a new calendar role registry. `true`, empty/public/optional
rules, self-editable properties and credential/session-dependent subject rules
are rejected because they cannot prove offline target eligibility.

This first native boundary requires the caller's current calendar **scope-manage**
policy for discovery, private participant reads and participant writes. It is not
hardcoded to administrator: delegated managers may satisfy the configured policy.
The ordinary current resource checks still run for every reserved calendar. Mere
appointment details/book access does not expose account references or names.

Each target must be token-eligible, not provisionally registering/admin-created,
and satisfy the configured trusted rule in the current application scope or exact
active tenant and membership. A user being a participant never grants that user
access to an appointment, resource or another tenant.

## One server/client facade

The same methods are available on the admitted server `zero.calendar` and browser
`client.calendar` facades:

```ts
const page = await client.calendar.participants.directory({ search: 'Taylor', limit: 25 });
const ref = page.items[0]?.ref; // { kind: 'guardian-user', userId: '...' }

await client.calendar.appointments.create({
  resourceIds, title, startAt, endAt, timeZone,
  participants: ref ? [ref] : [],
}, { idempotencyKey });

const bound = await client.calendar.participants.forAppointment(appointmentId);
await client.calendar.participants.replace(appointmentId, nextReferences, {
  idempotencyKey: replacementKey, expectedRevision: bound.revision,
});

const stop = client.calendar.participants.watchForAppointment(appointmentId, onSnapshot, {
  onError: retirePrivatePresentation,
});
// stop() on owner retirement. The SDK also retires streams on authority/client replacement.
```

Discovery returns `{ items, truncated, nextAfter }`. References are detached,
deduplicated by rejection and canonically ordered; the hard ceiling is 100 and
configuration may narrow new binding capacity. Names are minimal current SYSTEM
presentation, with `Account` for an unnamed account. Login names, emails, phone
numbers, avatars, biographies and other private profile fields are not returned
or searched. There is no public exact-ID resolve endpoint.

The directory checks at most 1,000 candidates per page. Policy filtering can yield
an empty page **with a continuation**; do not equate that with no eligible accounts.
`nextAfter` is an opaque process-local token, bound to scope, normalized search,
page size and scan position. It reveals no skipped identity. Tokens live for five
minutes, with a bounded 256-entry budget and no cleanup timer. Repeated identical
live continuations reuse their token so quiet watches do not chatter. Expiry,
restart or budget eviction requires restarting discovery from its first page;
it is never evidence that a retained participant was deleted.

Private binding reads return `{ id, revision, participants }`; available entries
contain `{ ref, availability: 'available', name }`, while unavailable entries
contain only `{ ref, availability: 'unavailable' }`. Disabling/removing a target
does not erase an accepted historical reference or expose its former name. Read
capacity remains the hard 100 even after lowering the new-binding limit.
Ordinary appointment/hold DTOs, receipts and busy views omit participants entirely.

## Accepted history, changes and confirmation

Additive migration `008` stores only bounded opaque references, private immutable
appointment generations/current pointers and fixed hold captures in the existing
scope's Fabric database. There are no copied users, cross-file foreign keys,
new databases per person, or backfilled participants on older appointments.
Migration functions and complete schema declarations `001`–`007` remain pinned.

Create/acquire validates all selected targets at the trusted parent's synchronous
final commit guard. The native database authority binding captures and verifies
the durable SYSTEM revision across that guard and the actual source commit.
Provisioning-marker insert/delete/retarget now also advances the canonical clock;
lease/setup metadata does not. No HTTP-supplied eligibility Boolean can replace
this boundary, and an asynchronous target callback fails closed.

Replacement uses the appointment revision: newly added targets require current
eligibility, but retained unavailable references may remain and may be removed.
Unrelated rescheduling/lifecycle changes preserve the reference history and do not
re-admit an already accepted participant. Terminal appointment outcomes still
prevent modification. A genuine no-op produces a quiet `changed: false` receipt.

Holds capture the exact set, including an explicit empty set. Confirmation freshly
checks captured targets and transfers exactly that set to the new appointment in
the same transaction. It cannot invent, drop or relabel participants. A feature
disabled after capture cannot silently confirm such a hold; old uncaptured holds
remain confirmable through the ordinary owner/book boundary. Lowering the current
capacity can require reviewing/releasing a larger held selection before retrying.

Accepted replay still compares original normalized intent and current object
rights. It does not reexecute or newly reject an already accepted operation just
because a target became unavailable later. Unknown outcomes require the original
key/receipt reconciliation; never manufacture a second write or claim rollback.
Semantic audit records only the native operation, revision, change flag/count—no
participant IDs, names, contact values or credentials.

## Reactive UI composition

Use `useCalendarParticipantDirectory`, `useCalendarAppointmentParticipants` and
`useCalendarHoldParticipants` for current-scope live reads. Calendar commits and
local SYSTEM mutations are payload-free wake hints; unchanged/read-only transaction
completions are suppressed with a connection-local scalar change watermark, never
treated as new domain facts. The existing five-second quiet
watch check resolves cross-process changes without another polling loop. Reads
and watches resolve target presentation **again after** the final asynchronous
caller check, so a target change during that wait cannot publish an old name.
These are separately authorized current projections, not a cross-database atomic
profile/calendar snapshot.

`CalendarParticipantFields` is separately composable from the calendar UI entry.
It preserves native anchored motion, magnetic row highlights, edge fades,
keyboard multi-selection and compact tokenized anatomy. Supply a current directory
page, controlled search/ref draft and fresh authorized accepted presentation.
Combine current-scope read readiness before passing `status: 'ready'`; never feed
a stale accepted page after its hook retires. Loading/error masks previous names
and actions, unavailable retained references remain removable, and no raw account
ID is shown as a fallback. Search/pagination controls do not submit a booking.

The connected one-off workspace now discovers current native capabilities,
supports participant creation fields and opens a separate revisioned participant
replacement dialog from details. See the [connected workspace guide](../../frontend/calendar/connected-workspace.md)
for draft retirement, pagination/name privacy and exact receipt recovery.
The rich local demo's patient/staff/contact/manual-invite selector remains a UI
preview, not a native backend adapter. Public guests, domain contacts, invitation
proofs, recurring participants, avatar delivery, mobile/API-key admission and
notification/workflow delivery remain future stages. Real browser, physical actor
and exact-archive Linux qualification remain release gates; memory tests do not
establish those flows.
