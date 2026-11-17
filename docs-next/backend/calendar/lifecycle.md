---
id: zero.backend.calendar.lifecycle
type: reference
audience: [developer, agent]
owner: calendar
status: draft
visibility: internal
system: calendar
feature: appointment-lifecycle
maturity: experimental
---

# Appointment lifecycle and required reasons

[Calendar index](./index.md) · [Facade](./facade.md) · [Qualification](./qualification.md)

Feature-branch source, not a released calendar service. Use this contract for
confirmation/outcome changes, not a replacement clinical chart or a notification
engine. Visit progress, office/telehealth arrival, attention shading and online
presence are separate facts and are not inferred by a lifecycle change.

## Simple defaults; optional richer outcomes

Every scope starts with a virtual policy at revision 1:

```ts
{ revision: 1, extended: false,
  cancellationReason: 'optional', noShowReason: 'optional' }
```

No default rows, appointments or users are seeded. The current scope's admitted
calendar manager can opt into the extended lifecycle and required reasons:

```ts
const current = await calendar.lifecycle.get();
await calendar.lifecycle.replace({
  extended: true,
  cancellationReason: 'required',
  noShowReason: 'required',
}, { expectedRevision: current.revision, idempotencyKey: crypto.randomUUID() });
```

`get`, `replace` and `watch` require the scope-level calendar management policy,
not merely ownership/manage access to one resource. A provider cannot weaken the
reason policy by editing their own calendar. Replacements are complete, revisioned
and duplicate-safe. A no-op does not manufacture a policy-change audit event.

The first lifecycle has a deliberately fixed vocabulary, not arbitrary executable
state machines or user-authored status catalogs:

| Effective lifecycle | Meaning | Further transitions | Occupancy |
| --- | --- | --- | --- |
| `confirmed` | Confirmed reservation | Other active state or terminal outcome permitted by policy | Retained |
| `tentative` | Unconfirmed reservation | Confirmed or permitted terminal outcome | Retained |
| `completed` | Recorded completed outcome | None | Retained |
| `no-show` | Recorded no-show outcome | None | Retained |
| `cancelled` | Cancelled reservation | None | Released |

With `extended: false`, ordinary confirmed → cancelled remains available. A
previously tentative appointment can still be confirmed or cancelled after
extended mode is disabled; disabling the policy does not trap or rewrite it.
Extended mode enables confirmed/tentative changes and completed/no-show outcomes.
Creation and hold confirmation still start at `confirmed`; an unconfirmed outcome
currently requires an explicit subsequent transition. There is no hidden initial
status default, and no automatic invitation/reminder is sent between those commands.
Completed/no-show are terminal but **do not silently free a future reservation**.
They are not a workaround for cancellation, and cannot be rescheduled or cancelled
through an older endpoint. Restoration/correction of terminal outcomes is not
currently supported; it needs a separately reviewed correction contract.

## Discover, review, then submit

Ask the server for the current appointment transition projection:

```ts
const available = await calendar.appointments.transitions(appointmentId);
// { id, revision, policyRevision, status,
//   allowed: [{ status: 'cancelled', requiresReason: true }, ...] }

await calendar.appointments.transition(appointmentId, {
  status: 'cancelled',
  policyRevision: available.policyRevision,
  reason: 'Scheduling conflict',
}, { expectedRevision: available.revision, idempotencyKey: crypto.randomUUID() });
```

Discovery, live discovery and mutation require current manage access to **every**
reserved resource. The projection is UI guidance, not a capability; the writer
rechecks current rights, exact appointment revision, current policy revision and
the transition. A changed policy returns `CALENDAR_POLICY_STALE`; an unavailable
transition returns `CALENDAR_TRANSITION_INVALID`. The UI must review again, not
silently rebase a pending reason dialog. No dialog confirmation means no command.

Reasons apply to cancellation/no-show, are optional or required according to the
current target-state policy, bounded to 1,024 characters without control characters,
and retained privately with the accepted lifecycle fact. The native form omits
blank optional reasons; an explicitly supplied blank string is invalid input.
A required missing reason returns
`CALENDAR_REASON_REQUIRED`. Never put a clinical narrative in a reason field.
Reasons are not copied into audit metadata, busy projections, command receipts,
effect references, public URLs or operational error messages.

`appointments.watchTransitions(id, listener, options)` and
`useCalendarAppointmentTransitions(id)` use normal scoped reactive reads. Denial
retires prior controls. Policy commits invalidate the projection even when the
appointment row itself did not change. `useCalendarLifecycle()` is the manager
policy hook. Stop subscriptions on unmount and use the current SDK client.

## Compatibility, audit and accepted outcomes

`appointments.cancel(id, {expectedRevision, idempotencyKey, reason?, signal?})`
remains supported and checks the same current lifecycle/reason rules. The
reason-less legacy command retains its original request digest; old accepted
replays return their original safe receipt before later policy/terminal checks,
while still requiring current object rights. An accepted replay is not a new
cancellation or a permanent right to read its old content.

`transition` returns `appointment.transitioned`, including a transition to
cancelled. The dedicated cancel API returns `appointment.cancelled`. Each accepted
change appends one matching semantic event at its canonical source transaction;
there is no duplicate frontend “saved” event. Audit includes safe fixed status,
revision, policy revision and reason-presence facts, never the reason text.
There is no success evidence on rejection/rollback and no new activity on replay.

The existing reservation status remains `confirmed | cancelled` in storage and
the compatible DTO. When present, `appointment.lifecycle.status` is the effective
confirmation/outcome state; use it for labels. Untouched legacy appointments omit
the optional lifecycle object. Its source `revision` may be older than the current
appointment revision after a reschedule; it does not mean the outcome disappeared.
Appointment details expose the latest private reason only under current detail
authorization. This is not yet a public lifecycle-history browser API.

All mutations preserve stable request identity and honest unknown-outcome handling.
If delivery fails after dispatch, reconcile the **original** receipt. Do not retry
with a new key, claim rollback or treat closing a modal as cancellation of a write.
The native connected workspace uses Zero's modal manager, server-supplied actions,
an explicit reason form and receipt reconciliation. Newer typing is not erased by
an older acknowledgment, and retired owners cannot close a newly opened dialog.

## Not enabled by this feature

No automatic email, AI, reminders or provider calls run from a transition. Opaque
source effect references are groundwork, not a completed Jobs/Torrent dispatcher.
No visit stage, lobby membership, attendance, custom workflow, participant RSVP,
medical judgment or terminal-outcome correction is implied. See the qualification
guide for the distinction between memory checks and pending physical/browser/
deployment acceptance.
