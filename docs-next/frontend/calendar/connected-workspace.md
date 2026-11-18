---
id: zero.frontend.calendar.connected-workspace
type: reference
audience: [developer, agent, maintainer]
owner: calendar
status: draft
visibility: internal
system: calendar
feature: connected-workspace
maturity: experimental
---

# Connected one-off calendar workspace

[Calendar UI index](./index.md) · [Backend facade](../../backend/calendar/facade.md) ·
[Native participants](../../backend/calendar/participants.md) · [Qualification](../../backend/calendar/qualification.md)

This documents **unreleased feature-branch source**. The selected Zero 2.11.0
archive and the approved hosted local-state demo are unchanged. The source UI
now composes real one-off booking, types, visits, lifecycle and account participants;
it is not a completed recurring/clinical/public scheduling product.

```tsx
import { ConnectedCalendarWorkspace } from '@zero/framework/calendar';

<ConnectedCalendarWorkspace displayTimeZone="America/New_York" />
// Optional presentation opt-out: participants={false}. This changes no permissions.
```

Use the existing Client/AppProvider and native modal/tooltip providers. The
workspace neither installs providers nor changes data topology or site themes.
Its calendar/resource catalog, appointments and overlays use the current admitted
Guardian scope; browser-auth replacement retires their subscriptions and owners.

## Discover, don't duplicate, server policy

`client.calendar.capabilities.get()` and `.watch(listener, options?)`, plus
`useCalendarCapabilities`, expose current scoped UI discovery:

```ts
{
  timeZone,
  createOwn, manage, participants,
  limits: { maxRangeDays, maxPageSize, maxResources, maxParticipants }
}
```

`participants` means this caller may use the configured native participant
controls. An app's `participants={true}` cannot override a false native capability.
No root/path, actor/principal, secret, account directory or storage health is in
this projection. Discovery allocates no calendar owner/file/actor and never
enumerates accounts. Individual resource grants, current type policy, revisions
and final commit admission remain authoritative; capability flags are not tokens.

The connected workspace discovers participant availability automatically. It
respects the server's selected-resource and participant ceilings; selector page
size stays server-configured. Read ranges use unambiguous display-zone midnight
bounds when available and split a 25-hour day correctly rather than guessing the
host timezone. Unusual missing/ambiguous midnights keep a conservative superset.
The workspace uses at most two range streams. A longer view exceeding narrowed
server limits shows an explicit shorter-view/fewer-calendars state, never a false
complete partial schedule or dozens of streams. Direct facade callers may compose
additional separately bounded reads.

## Booking and type selection

Canonical booking/hold admission also enforces the selected
[working-hours policy](../../backend/calendar/working-hours.md), when configured.
`useCalendarAvailabilityPolicy(id, readRevision?)` supports an app-owned setup
surface through the same native live boundary. This pass adds no hours/holiday
editor to the connected workspace or rich local preview. Missing coverage is a
real server rejection, not a request to guess availability or bypass the policy.

`CalendarCoreEditor` is separately composable, using `CalendarCoreSession` and
`CalendarCoreDraft`. The workspace owns the opening/base and original-request
recovery ledger. The richer recovered `AppointmentEditor` remains a separate
synchronous local UI; passing a Promise to it does not install persistence.

`CalendarCoreTypeFields` uses the currently authorized selected-resource type
intersection, not an omitted manager-wide catalog. Rescheduling queries every
reserved co-resource, preserving the resource set. The selector is paged and
retryable, and source-accepted historical types remain distinguishable from new
unsubmitted choices. A new choice missing from the current live page loses its
label and cannot be saved until explicitly reviewed; no stale snapshot is promoted
to authority. Loading/error withdraws old choice presentation while retaining drafts.

Choosing a type defaults its exact duration and before/after buffers. A 10:07
start with a 37-minute type ends at 10:44, not a quarter-hour approximation. Duration
uses elapsed instants in the scheduling zone. Gaps, folds and unrepresentable
same-day ends produce explicit errors; the editor does not clip, guess an offset,
or silently coerce manually edited times. Typed intervals/buffers must still match
before dispatch. Untyped bookings expose explicit whole-minute buffers.

Creation sends only a type reference; the source captures its canonical snapshot.
Reschedule omission preserves the accepted type, selecting another current version
replaces it, and `null` explicitly clears it. Historical preservation is not a
promise that changed occupancy passes today's policy. The server may reject an
untyped booking when a resource requires a type. Catalog/policy administration UI
is still a later stage; these controls select existing managed types.

## Participants: separate facts and separate saves

Native account participant controls appear only when scoped capability permits
them. Their `useCalendarParticipantSelection` controller is also reusable. Search
and cursor pagination keep opaque references, not a private cache of old picker
names. Opaque-cursor retry restarts discovery. A selected draft account off the
current page is labelled `Selected account`, not falsely declared unavailable.
Fresh retained binding names/tombstones take precedence over an independently
lagging directory snapshot. No raw account ID is used as a display-name fallback.

An untouched creation draft omits `participants`; deliberate selection/removal
sends the chosen set, including explicit `[]`. Disabling/hiding capability during
an open creation retires that opening instead of silently omitting its refs.
Restoring the prop does not revive the retired owner. An open existing-participant
dialog is also retired, not stored for automatic reopening on capability return.
The server freshly admits
all submitted targets; selection sends no invitation and grants no calendar access.

Details resolve private participant presentation separately from the ordinary
appointment DTO. `Manage participants…` opens
`CalendarAppointmentParticipantsDialog`, a distinct revision-controlled
`participants.replace` operation. Rescheduling never writes participants, title
or resource membership, and no pair of sequential saves is presented as atomic.
Retained unavailable accounts remain removable. A pristine/reverted replacement
cannot submit by button, Enter or a retained callback.

## Modal, draft and receipt lifecycle

The family uses Zero's native controlled modal manager, anchored surfaces,
design tokens, icons, magnetic rows and scroll fades. It does not replace the
approved theme or reintroduce native OS date pickers. The date field imports its
internal date-value helper directly rather than inventing an unsupported public
package subpath.

Both current reads and the latest admission state fence actions, including
retained callbacks. A detail action withdrawn by current management or participant
denial cannot reopen an editor. Newer typing during a pending save cannot be
erased or closed by an older accepted acknowledgment. Account/client/scope/target
replacement and unmount retire subscriptions, callbacks and native contexts.
The separately exported core editor owns the same client/provider/scope/session/
record-generation boundary, not just the parent workspace. Unrelated refreshed
props do not replace its accepted comparison baseline or erase typed changes.

An explicit calendar choice removes retired catalog IDs from that local selection
before enforcing the configured ceiling. A resource no longer on the authorized
page cannot invisibly block selection of its replacement.

Known noncommits may be corrected deliberately; unknown outcomes retain their
original key and never trigger an automatic resend. The scope-owned recovery
ledger survives closing/retiring the overlay. It retains the expected base revision
for mutations and verifies target, key, operation and exact accepted generation.
Creation must acknowledge revision 1 with `changed: true`; status changes cannot
claim quiet no-ops. An impossible receipt remains unsettled rather than being
accepted merely because its key matches. A later receipt cannot settle a newer
owner's pending work.

Unknown participant outcomes and accepted writes with newer unsent edits also
remain native dirty/review work, even if the visible selection was restored to
the old baseline while dispatch was pending. No-op submission checks still compare
only the reference set; the modal close warning does not manufacture another write.

The actual ReactDOM/native-modal controller tests cover these lifecycle boundaries
in memory. Host widgets are intercepted in parent tests: this does **not** qualify
browser layout, keyboard/focus pixels, animations, physical actor recovery,
managed compliance, installed package resolution or Linux deployment. Those
release gates remain explicit in the qualification guide.
