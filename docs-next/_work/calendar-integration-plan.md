---
id: zero.work.calendar-integration-plan
type: architecture
audience: [developer, agent, maintainer]
owner: calendar
status: draft
implementation_state: in-progress
visibility: internal
system: calendar
feature: managed-calendar-integration
maturity: planned
applies_to: ["proposal reviewed against 2.11.0 and b237bf4 foundation follow-up; not an available calendar backend"]
---

# Calendar: end-to-end managed integration plan

[Working index](./index.md) · [Preserved UI and return handoff](./calendar-return-handoff.md) ·
[Current frontend contract](../frontend/calendar/index.md)

Reviewed 2026-11-16. This is the proposed integration contract and implementation
sequence, not documentation of existing calendar APIs or permission to deploy an
application. The user requested plan review before backend implementation.
The experimental frontend ships in 2.11.0; **calendar configuration, persistence,
booking and reminder APIs do not yet exist**. Names in backticks below describe
proposed surfaces unless explicitly identified as existing.

Implementation has begun on `feature/calendar-backend-foundation`. The
[managed core source guide](../backend/calendar/index.md) now documents the
connected one-off implementation. It is not yet released or updater-selected;
statements above about the selected 2.11.0 archive remain unchanged. Core API
names in that guide are implemented on the branch; later-stage names below are
still proposals.

## 1. Review outcome and baseline

The earlier handoff correctly preserves the UI and identifies eight important
backend prerequisites. It does not yet specify complete configuration, service
admission, consistency, mutation, live-query or operational contracts. This plan
fills those gaps; it does not replace the reviewed visual design.

Use source `b237bf40bb491bcc71d3bc957ffa288f67d269d4` for this review. It includes
source-verified follow-up worker context, detached workflow audit-lifetime,
Jobs query-plan and direct-dependency fixes. Those fixes are **not** in the
selected 2.11.0 archive at `4d2eb26034783cb77622a249c0cc57f48760331e`.
Require the matching newly qualified artifact before a calendar deployment
relies on them; see the [foundation review record](./durable-jobs-and-workers-plan.md#post-release-review-boundary).

The review found three core integration gates, not capabilities to assume:

1. A calendar source outbox has no existing source-bound Jobs scheduling facade.
   Current `ScopedJobs` still requires a live session even when execution is
   service-owned. Add a narrow verified source/service bridge before relying on
   outbox-to-Jobs scheduling; do not fabricate user authority or use `unsafe`.
2. Jobs `service.isEligible` is synchronous, not an asynchronous calendar Fabric
   lookup. Define its limited policy role and an actual fresh calendar-state
   check before dispatch/effect; never close over a stale appointment snapshot.
3. Current retained Jobs budgets are finite. A production reminder design must
   qualify schedule/receipt/occurrence lifecycle and capacity, not allocate an
   indefinitely growing schedule for every reminder and assume automatic pruning.

Existing building blocks are [scope-bound request services](../backend/runtime/server-services.md),
[Fabric](../backend/fabric/index.md), [Guardian](../backend/guardian/index.md),
[Jobs](../backend/scheduler/durable-jobs.md), [Torrent enqueue](../backend/torrent/enqueue.md)
and [worker/service composition](../backend/workers/service-integration.md).

## 2. Product scope and defaults

One opt-in native calendar system must serve personal calendars, organization
scheduling, resources/rooms and delegated schedulers. Clinical scheduling is a
configurable preset/example, not the domain model or a requirement for every app.

Recommended defaults, subject to product approval before implementation:

- `calendar` omitted/false: mount no calendar routes, files, actors, definitions,
  timers, subscriptions or provider work. Retained state is not deleted.
- Enabling core calendar requires Guardian and a valid private Fabric placement;
  explicit `auth:false` is rejected. Do not change application tenancy/topology.
- The small default offers private authenticated calendars, one-off appointments,
  resources, availability, blocks and the reviewed day/week/month/list UI.
  Public self-scheduling, outbound channels, AI and automatic clinical behavior
  are off. No fictional providers, patients, locations or demo settings are seeded.
- Recurrence, automatic horizon maintenance and reminders have explicit capability
  settings. Durable work requires admitted Jobs/Torrent registrations; an explicitly
  disabled dependency is never silently overridden. Decide whether the simple
  enablement shorthand includes recurrence during configuration/API review.
- Scheduling timezone must be deliberately selected before publishing availability
  or bookings. Do not infer it from the host, browser, a user's preferred zone,
  a geographic filter or a provider's current presence.
- Missing optional email/messaging/Storage/AI providers make that capability
  unavailable; they do not prevent unrelated core calendar use or trigger installs.

Make the dependency matrix explicit: core one-off use needs Guardian/private
Fabric only; automatic recurrence-horizon maintenance and future-due effects need
Jobs/Torrent; immediate durable transition hooks use Torrent without inventing a
timer; each outbound channel needs its configured adapter; AI, media and presence
are independent optional capabilities. Pure bounded recurrence preview
alone is not automatic future reservation. If a dependency is unavailable, disable
the dependent capability with a clear setup state rather than partially enabling it.

## 3. Configuration and existing-project adoption

Design typed `CalendarConfig` with pure resolution before side effects. Admit
and detach trusted callbacks, reject unknown settings/accessors and invalid limits,
and expose only a safe capability/readiness summary to clients. Configuration
resolution is not proof storage or adapters are ready.

| Configuration area | Required design |
| --- | --- |
| Storage/lifecycle | Private root, fixed actor launch, explicit child environment, file/hot placement and bounded active databases/readers. File is first-class. |
| Access | Guardian requirements plus calendar/resource/object grants; delegated scheduling and management are independent. |
| Time | Scheduling/default display zones, week start, visible hours, supported precision, recurrence dialect/horizon and DST behavior. |
| Catalogs | Generic appointment types, durations/buffers, visit modes, colors, resources, locations and optional clinical transition preset. |
| Policies | Conflicts, exceptional overrides, holds, booking windows, cancellation/reason rules and series-edit behavior. |
| Integrations | Versioned reminder/workflow definitions; separately enabled channel adapters, directory adapters and optional AI tools. |
| Limits | Bounded query ranges/pages, occurrences, participants, holds, input sizes, worker/provider occupancy and retained-state budgets. |
| Delegated settings | Code-owned ceilings; optional scope-admin-editable schedules/catalog settings with revisions and semantic audit. No executable/provider-secret settings in browser JSON. |

Code establishes allowed capabilities and policy ceilings. If delegated settings
are included, scope administrators may change only declared fields, with expected
revision and current permission; tenant settings cannot enable a platform-disabled
channel, weaken global privacy or choose a provider endpoint/actor entry.
Do not make the first release depend on building an unrelated general config UI.

Catalog/type/mode/status/resource IDs are stable and versioned. Deactivation or
replacement must preserve historical interpretation and readable old appointments;
never silently relabel/default an unknown retained value or convert it during an
unrelated edit. Define read-only preservation versus explicit reviewed migration.
Removing a calendar/location/resource does not implicitly erase appointment history
or cancel future reservations without an explicit authorized operation.

Specify a bootstrap-owned durable policy generation and final fences, or qualify
single-runtime exclusion that prevents overlapping old policy owners. Read, write,
after-await and effect boundaries must reject retired policy/channel/adapter handles.
Configuration A → B → A is a new generation, not revival of the first A. Snapshot
revision metadata alone does not retire another process. Disable/re-enable follows
the same rule and never deletes retained state.

Expose disabled, setup-required, ready and blocked states with safe reason codes.
An empty calendar is not a failed mount. Missing established storage is blocked,
not an empty-start screen. Setup must be recoverable by the actual delegated
manager, including non-admin schedulers in single/advanced configurations.

For an existing app: Doctor/read-only planning reports required permission-registry
version changes, SYSTEM owner/catalog migrations, private roots, missing adapters,
build entries and conflicting paths. Use normal explicit migration preparation;
preserve users, assignments, Storage, app schemas and retained evidence. Never
reset Guardian to install new calendar permissions, auto-convert single tenancy,
inject demo data or overwrite public/authenticated theme tokens. Test disable,
re-enable and same-version replay against populated retained state.

## 4. Ownership and private Fabric placement

Recommended placement is **one private calendar conflict domain per admitted
application/tenant scope**, with multiple calendars/providers/resources inside
that file. Single tenancy uses application scope; multi tenancy uses the current
committed tenant scope. A selection session is not tenant calendar access.

This feature-owned Fabric plane must work independently of the app's primary
shared-row versus tenant-file topology. `zero.data` is intentionally unavailable
for some app modes and does not supply calendar object policy; never fall back
to raw primary SQL or `unsafe` when it is null.

Use the messaging/Jobs ownership pattern: SYSTEM stores private ownership/wake
metadata, while the calendar file stores domain records, receipts and source
intents. Pin opaque file identity, root identity, owner, schema/realm fingerprint
and established state. Reject overlapping/aliased roots across app, SYSTEM,
calendar, Jobs, logging, blog, messaging, Storage and build/public paths.
Missing established files or mismatched identities require explicit recovery.
Actors never boot the app or inherit dotenv/provider credentials.

Do not create a file per provider: an appointment reserving a provider and room
needs one short atomic conflict decision. Cross-tenant/cross-file atomic bookings
are outside the first contract; reject them rather than promising distributed
transactions. Scoped calendar data is not a cross-organization directory.

Conceptual records (names/schema still to be designed):

| Records | Owned facts |
| --- | --- |
| Calendars/resources/locations | Stable identity, timezone, capacity, effective assignments and object grants. User identity references are not a copied user store. |
| Types/availability/blocks | Versioned permitted types, working intervals, exceptions, duration and buffer/capacity policy. |
| Series/occurrences/exceptions | Recurrence source, nominal occurrence key, effective time, revision and cancellations/splits. |
| Appointments/participants | Actual reservation, generic lifecycle and authorized person/contact/guest references. |
| Holds/requests | Expiry, resource reservation, subject/proof binding, request-versus-confirmation state and consumption receipt. |
| Reminder/effect intents | Immutable logical identity, source revision, eligibility, channel status and reconciliation history. |
| Command receipts/outbox | Duplicate-safe accepted mutation and durable integration handoff, atomically owned by the source file. |

Index range/resource/state/expiry and outbox discovery explicitly. Stable IDs
must not be derived from mutable names, current email addresses or a retry number.
Define deletion, tombstones, holds and receipt retention before admitting writes.

Choose identity-reference admission explicitly. The recommended small first model
uses server-validated opaque canonical user/membership references, with scope checks,
deactivation/deletion tombstones and no pretend Guardian foreign keys. If native
Guardian foreign keys are introduced instead, register and qualify the separately
owned calendar plane as an identity-projection target, including ownership/readiness
barriers; app/tenant projection is not automatically installed in every private realm.

## 5. Guardian, privacy and directory integration

Close every normal service/HTTP/query/watch facade over existing `ServiceDataScope`
and live authority. Browser input cannot choose a tenant, principal, path or database
reference. Verify Guardian and domain policy before reads, after asynchronous
lookups, at final mutation admission and before delivering private results.

Keep these grants separate: free/busy visibility, appointment details, participant
details, booking own/another calendar, editing/rescheduling/cancelling, status changes,
availability/catalog management, self-booking eligibility and exceptional conflict
override. Compiled Guardian requirements plus calendar object grants own access;
do not hard-code a global `admin`/provider label as the whole policy. Current
server-derived allowed actions aid UI discovery but never authorize a mutation.

Location/state/property filters operate only within the already authorized set.
A provider may have multiple effective state/location assignments; self-editable
profile properties cannot grant eligibility. Tenant-local assignments belong in
the calendar/domain scope, not global canonical user profiles. Use only admitted
trusted Guardian properties for authorization; a preference is not a permission.
Empty geography facets mean all currently admitted choices, while an empty selected
calendar/resource array remains empty. Prune invalid selection/focus explicitly;
do not silently select a different provider or broaden a narrowed view. Valid no
matches, loading, setup and denial have different presentation states.

Return distinct busy-grid and detail projections. Busy-only responses must omit
titles, attendees, notes, reasons, contacts and private IDs not needed by that view;
CSS hiding of a full appointment is not redaction. Authorize counts, facet values,
search, pagination and exports too, to avoid query oracles.

Define a bounded authorized directory adapter for staff, contacts and app-defined
participants (a patient is an app participant type, not a core user kind). Manual
guests have separate identity/proof/consent contracts; never create fake Guardian
users. SYSTEM remains canonical for profiles; shadow identity anchors are not
names, avatars, status, permissions or a license to read another person's profile.
Use native authorized profile/avatar/presence projections and retire their caches
with scope. Presence is optional UI context, never attendance or bookable capacity.

App-specific participant eligibility needs an explicit consistency contract.
Guardian and calendar-owned grants can have final canonical fences; an asynchronous
app-file lookup is not a cross-file atomic security check. Where an adapter cannot
prove the required current fence, fail closed for that policy or require a reviewed
calendar-owned authority projection with hydration/revocation semantics. Do not
claim that a stale directory snapshot makes a domain invariant atomic.

Browser-session admission is the baseline. Native sessions need explicit proposed
calendar credential ceilings and parity across native configuration, authorization,
discovery, consent, client types and SDKs before calendar use is admitted. Existing
`profile`/`profile:write` scopes and Guardian roles alone do not grant that native
capability; test narrowed/missing scope and client/session revocation. API-key/
machine calendar access, if included, needs separately declared capabilities and
scope projection—not automatic reuse of actor-only Jobs/Workers. Public booking
has its own proof below. Deferred credential types must fail closed and be documented.

## 6. Public facade and domain commands

Proposed server request surface: nullable `zero.calendar`; proposed SDK surface:
`client.calendar`. Add both through normal request projections, client lifecycle,
HTTP serialization, authorization and exports—not a privileged service bag exposed
to an app/browser. Keep lifecycle/registration on trusted setup only.

Organize server code under `src/calendar/`; preserve UI under
`src/components/calendar/`. Use a separate focused server entry, not server imports
in the existing browser `@zero/framework/calendar` entry. Add contract/type and
installed-package tests for every supported export.

Design one canonical implementation per domain operation, shared by UI, routes,
workflow adapters and explicit app hooks. Proposed families:

- Safe configuration/capabilities and authorized directory/resource catalogs.
- Bounded calendar range/free-busy queries, detail/history and scoped watches.
- Appointment create/update/reschedule/transition/cancel and conflict overrides.
- Series preview/create/edit-this/edit-future/edit-series with exception policy.
- Availability/block management, booking offers/holds/confirm/requests and RSVP.
- Original command receipt reconciliation; no raw CRUD around invariants.

Every mutation uses a stable caller request identity and normalized command hash;
existing records require expected revision. The writer atomically commits domain
changes, accepted receipt, integration intents and configured semantic evidence.
No-op saves make no false mutation or success audit. Exact replay returns the
original receipt; the same key with another command conflicts. Read the current
record separately. Scope/principal bind the receipt; private commands are never
cross-tenant de-duplicated through caller-selected keys.

Replay/reconciliation preserves immutable operation identity and outcome, not a
permanent authorization to its original private payload. Reauthorize current
calendar/object/detail fields before delivery; narrow or withhold detail snapshots
after grant loss. Receipt errors and lookup results must not become an existence
oracle or bypass busy-only privacy.

Differentiate not-started, rejected/not-committed, accepted and unknown. Lost
acknowledgment or post-commit authority loss never claims rollback or safe replay.
Reconcile using the same request identity under current authorization. A missing
receipt after authority replacement does not prove the write never committed.
HTTP and SDK must preserve safe machine-readable outcomes, not raw provider errors.

Hooks are explicit, versioned integration seams: bounded synchronous validation/
commit contributions where atomicity is promised, or durable post-commit handlers.
Never let an asynchronous app callback run inside the SQL transaction or turn a
committed accepted appointment into a falsely rejected appointment.

## 7. Time, recurrence and booking truth

Use canonical UTC instants for timed reservations plus the intended local date,
wall time, IANA scheduling zone and explicit ambiguity resolution. All-day records
are local date intervals, not midnight UTC durations. Intervals are half-open;
adjacent appointments conflict only through declared buffers/capacity. Keep
appointment, location, provider and viewer zones distinct and visibly labeled.
Support cross-midnight and non-hour offsets; the prototype's 7 AM–7 PM and 15-minute
suggestions are not domain limits. Typed exact times and backend precision agree.

Use the reviewed daily/weekly/monthly/yearly preferences as a bounded recurrence
dialect, not the current browser-local preview as a server engine. Select and pin
the recurrence/timezone implementation only after a standards/runtime test spike.
Unsupported rules must reject or remain read-only intact, never silently simplify.

The standards reference is [RFC 5545](https://www.rfc-editor.org/rfc/rfc5545.html):
section 3.3.10 defines recurrence handling, and section 3.6.1 defines event interval
ends. Calendar rules must not inherit Croner's job-time semantics. In particular,
invalid/generated gap occurrences are skipped rather than shifted/counting as
normal instances. A directly entered nonexistent local time should require
correction; repeated local times require a documented, visible resolution policy.
Also reject a start date inconsistent with the selected repeat pattern, or require
an explicit visible correction. The prototype unconditionally includes its first
date; that does not establish a valid DTSTART/RRULE pair. Define COUNT and inclusive
local end-date conversion without silently adding or dropping an occurrence; see
[RFC 5545 section 3.8.5.3](https://www.rfc-editor.org/rfc/rfc5545.html#section-3.8.5.3).

Persist stable series identity and **nominal** occurrence identity, separate from
the currently effective UTC start. Moving an instance must not create a second
logical occurrence. Define this-instance/all/future edits, EXDATE/RDATE equivalents,
split-series lineage, exceptions, COUNT/UNTIL, timezone-rule changes and which
future reservations are revalidated. Preserve historical occurrences and receipts.
Rendering must handle repeated/missing local hours and offset labels correctly,
not force a fixed 24-hour grid or overlap visually indistinguishable fold instances.

Expand/materialize only a bounded horizon with a durable coverage watermark.
Requests beyond qualified coverage must not report a slot as guaranteed free.
A series proposal must specify all-or-none versus explicit partial/conflict-review
behavior over the admitted horizon; never silently book only the easy instances.
Unbounded future conflict guarantees are not part of the contract. Horizon extension
is version-fenced durable work; it must not send duplicate invitations/reminders.

Availability is authoritative server policy: effective provider/resource/location
assignments, working hours, holidays/overrides, blocks, appointment status/capacity,
buffers, notice and horizon. A busy presence ring is not a reservation. Check all
required resources and capacity together inside the final short writer decision.
Two competing requests cannot both win a capacity-one reservation.

Holds carry opaque IDs, source/policy revision, subject/proof binding and server
expiry; acquire/consume/expire atomically in that conflict domain. Correctness
uses expiry checks at reads/commands, not whether a cleanup timer fired on time.
An exceptional override needs its own grant, reason and semantic event.

## 8. Self-scheduling and participant invitations

Production self-scheduling defaults off. The preview's `enabled:true` is synthetic
UI data, not a configuration default. Staff management and visitor booking are
different permission boundaries.

When enabled, configure permitted calendars/types, notice/horizon/buffers, identity
mode (member, scoped invitation or separately approved guest proof), rate/abuse
admission, verified contact/consent requirements and request-for-review versus
instant confirmation. Native mutation/CSRF/audit rules still apply to their proper
route class. A public booking proof grants only its narrow capability; it is not
an authenticated staff session or access to private files/calendar details.

Offers expose opaque versioned slot/hold identities and canonical times, not private
appointment data. An any-provider booking reserves and returns the actual admitted
resource, not the preview's deterministic first resource. Recheck eligibility,
policy and capacity at confirmation. Define whether pending review reserves capacity
and its expiry; never label an unacknowledged request or approval-pending item confirmed.

Invitation and RSVP state are per participant. Contacting an external attendee,
accepting an invitation and granting access to a calendar are separate operations.
Hash capability secrets, bind scope/purpose/expiry/use policy, redact URLs/tokens,
apply correct referrer policy and invalidate superseded invitations. Recipient
consent/addresses stay private. Core Zero need not integrate a telehealth provider,
Facebook, external calendar account or app-specific patient portal to support this.

## 9. Appointment → Jobs → Torrent → provider integration

The intended pipeline is a short, durable, locally integrated chain—not another
calendar scheduler, per-appointment polling loop or network wait in SQLite:

```text
authorized calendar command
  → same calendar-file commit: reservation + receipt + integration intent
  → bounded source dispatcher → verified Jobs handoff/reconciliation
  → pinned Torrent activity → fresh calendar/domain admission → channel effect
  → reconciled effect outcome → authorized live projection + semantic evidence
```

Calendar command, calendar occurrence/revision, reminder intent, Jobs command,
Jobs occurrence, Torrent run and provider effect have distinct stable identities.
Retry attempts never become new logical send identities. Job inputs contain bounded
opaque references/revisions, not private notes, copied contact lists or user seals
in public views. Source acknowledgments wait only for durable handoff, not AI/send.

Configured domain transitions can trigger code-registered Torrent rules: for example,
accepted cancellation with a reason can enqueue permitted notification/follow-up
work. Rule/version and effect identities are captured in the source intent, not
selected by an arbitrary browser callback. Immediate source-bound Torrent events
reuse the supported enqueue seam; future timed effects use the Jobs bridge below.
Run no provider effect before commit and do not turn a post-commit integration
failure into a false rejection of an already accepted appointment.

### Required new source/service Jobs bridge

Design a fixed source-bound admission/control/receipt capability for calendar-owned
intents: verified source and scope, fixed registered definition and workflow pin,
stable intent key, source-revision fence, current policy and retirement signal.
It must support create/reconcile/supersede/cancel without constructing a synthetic
`JobsAuthority`, retaining a request facade or exposing raw `JobsService`.
An atomic appointment commit and a later Jobs commit remain **two files**;
permanent receipts and reconciliation connect them, not a distributed transaction.

Specify success/replay/unknown and crash recovery before implementing this seam.
Source-bound Torrent enqueue already exists; replacing Jobs with long timer workflows
would be a separate architecture decision, not an implicit workaround.

### Ownership and fresh eligibility

Recommended organizational reminders are explicitly service-owned, with original
human initiation retained as provenance. The scheduler's later logout does not
cancel an independently valid organizational appointment. Actor-owned custom work
remains available deliberately and stops new handoffs when that authority retires.
Neither model falls back from revoked actor authority to SYSTEM.

Existing synchronous Jobs `service.isEligible` can gate fixed code policy and scope
but cannot fetch a live calendar file. Require an explicit asynchronous domain
admission step for the calendar intent and another fresh check in the effect
activity. If an eligibility projection is introduced, specify hydration/readiness,
revision ordering, expiry, restart and revocation; fail closed while stale. No
current-appointment guarantee may be inferred from a captured setup snapshot. An
asynchronous calendar read before a different-file Jobs write is not an atomic
source fence: either establish a reviewed revision/projection protocol or explicitly
tolerate stale scheduling and suppress it at the authoritative domain/effect boundary.

Each reminder has immutable due time, expiry/maximum lateness and recovery policy.
Check revision, recipient eligibility and expiry after provider-pool waiting,
immediately before effect dispatch and before private result publication. Jobs'
pre-handoff lateness check is not a final send deadline. Suppress expired reminders
visibly after downtime; never blindly catch up yesterday's reminders today.

Calendar effects use reviewed fixed adapters over Zero services. Strict activity
capability labels do not expose raw email/AI/database handles. Service work cannot
use the actor-only native Worker facade by pretending to be a user; CPU-heavy
recurrence needs an explicitly admitted fixed trusted worker adapter with fresh
publication fences. AI is optional advisory work, never booking authority.

### Reschedule/cancel and downstream-effect cutoff

Atomically obsolete prior reminder intents when appointment time/status/revision
changes. Stop old Jobs generations through the durable bridge and reconcile any
uncertain prior handoff before new dispatch. Already accepted Torrent work still
checks the intent; pausing a job does not undo an accepted workflow/send.

Define a source-owned dispatch claim/cutoff: pending or claimed intents can be
suppressed; once a downstream effect is dispatched it may be in flight. This
includes a native notification's separate SYSTEM-file commit, not only a network
call. Cancellation still succeeds for the appointment but cannot promise recall.
A source check followed by another-file publication/send has an interleaving
window—do not claim no reminder can arrive after cancellation. Never hold SQL/
Guardian leases over a provider wait.

Track pending, suppressed/superseded, dispatched, accepted, rejected, unknown and
delivery/read evidence separately. Native notifications can use their permanent
duplicate-safe publication API. Email retains actual partial-address outcomes;
provider idempotency/reconciliation is used only where supported. Unknown SMTP
acceptance goes to a private review/reconciliation state, not blind resend.
Local sent-copy/audit failure after acceptance must not become permission to send twice.

Version internal definitions/activities and retain pinned old versions while work
depends on them. Retiring a version or channel yields visible blocked/review state,
not silent re-pinning, message loss or a different provider selected by a browser.

## 10. Capacity and local-first performance

Before production reminder rollout, resolve the retained Jobs lifecycle gate.
Current per-file ceilings are 10,000 schedules, 1,000 per owner, 100,000 receipts
and 100,000 occurrences. These are retained budgets, not only concurrent work.
A concentrated initiating owner—or a future shared service owner if that bridge
design is selected—and minute-level dispatcher occurrences can exhaust them.
Current service-owned Jobs still retain their initiating human owner; execution
principal is not the same as that owner. Concurrency does not solve lifetime growth.

Record realistic appointment/recipient/channel/horizon/revision volumes and choose
a reviewed Jobs lifecycle/capacity design preserving duplicate safety and original
receipts. If this needs a core extension, land and qualify it first. Do not silently
prune identities, rotate scope files to evade limits, invent another calendar timer
system or promise indefinite storage. Expose approaching capacity and blocked work
through safe operational state, with an explicit operator recovery procedure.

File mode must be fast without HOT mode. Keep booking transactions short and index
overlap/range, hold expiry, future intent and wake discovery. No retained-history
scan/count on every viewport refresh; no opening every scope every timer tick;
no source lane waiting on model/provider completion. Use bounded shared fair I/O
pools and separately bounded CPU processes; keep physical occupancy until actual
settlement. Choose per-scope waiting limits below global totals where headroom is
required. One SQLite writer per file is intentional; independent scope files must
continue progressing concurrently.

Define benchmark hardware, cold/warm file-mode fixtures, data sizes and accepted
latency/event-loop/memory budgets before release. Include a 15-resource day viewport,
populated history, multiple scopes and a slow/uncooperative provider alongside
interactive reads/writes. Report measured p50/p95 and queue behavior, not a universal
lightning-fast or exactly-once claim inferred from unit tests.

## 11. Authorized reactive UI and mutation lifecycle

Provide a connected native calendar workspace (working name `CalendarWorkspace`)
over the SDK/hooks and the existing AppProvider, so an app can add its calendar
page without reimplementing every query, command, subscription and overlay.
Keep the existing controlled pieces independently usable. Permit reviewed action/
field/detail composition without substituting raw service handles or bypassing
domain commands. A management/settings surface exposes only currently delegated
catalog/availability controls; an optional public booking surface uses the separate
proof-bound API over the same domain. Routes/AppShell placement remain app-owned.

Geography and other property facets need declared stable field/value IDs and
server-allowed filter operators, with authorized catalogs—not arbitrary SQL,
property reflection or unfiltered directory reads. Reuse appropriate native filter
controls while retaining the reviewed compact location/calendar anatomy.

Use private commit hints plus bounded reauthorized snapshots/live transport, following
the existing Jobs/Fabric contracts. Do not expose raw private realm tables through
permissive Sync or fabricate INSERT/UPDATE events. Snapshots bind authority generation,
scope, authorized resource selection, range, display zone, policy/config revision,
file-local cursor and server time. Enforce range/page caps and return truncation/
continuation explicitly. Cursors are not global across files.

Specify initial load, valid empty, transient same-scope error, disconnected/stale,
denied and retired states. Reconnect reconciles gaps; out-of-order/old-scope results
cannot replace current state. Denial/scope retirement immediately withdraws private
events, details, selection, menus and actions—no exit animation retaining denied data.
Idle heartbeats/rechecks stay quiet. Coalesce actual changes without hiding capacity
or conflict state. Keep day/list multi-resource and week/month one focused resource.

Calendar commit hints alone cannot detect an idle Guardian/domain grant revocation.
Specify authority-change signals and bounded live revalidation, including paused
directory/detail reads. Server delivery/commit boundaries fail closed; clients
withdraw content on observed retirement/revalidation, not instantaneous remote
erasure of an offline browser. Qualify domain assignment/grant changes even when
no appointment row or calendar commit hint changes, including a quiet watch.
Directory search,
facet/count/truncation and receipt paths must preserve the same privacy boundary.

Introduce an additive async controller/adapter instead of passing Promises into
the current synchronous editor/booking/modal callbacks. Keep independently usable
local pieces compatible. One mutation-intent boundary handles editor, card, agenda,
details, status popover, context menu and any future drag/resize. The server supplies
allowed transitions and required reason/approval; no alternate surface skips them.
Declining a reason dialog produces no write. Clinical progress, outcome, lobby and
attention remain separate axes; online presence is not office/telehealth arrival.

UI states: editing → submitting → accepted/rejected/unknown, plus conflict and retired.
Capture request identity/base revision; block duplicate submission; preserve newer
typing while an older request settles; do not replace a dirty draft with live data.
Show conflict resolution/reload explicitly. Retired callbacks cannot apply to another
account/client/scope. Unknown stays reconcilable; do not automatically retry or
pretend dismissal/AbortSignal rolled back an accepted command.

Only a matching accepted domain receipt with no newer unsaved edits may close the
still-current editor/session as saved. If typing advanced, acknowledge the submitted
revision and preserve the newer draft for an explicit next save. Late responses
never close a reopened or retired owner. Zero's manager owns accept/exit/focus
restoration; no second overlay system or arbitrary delay. Use Zero Link for
navigation and preserve the shared AppProvider/collector.
Provide deliberate empty/setup/loading/error states and server-configured types,
hours/zones; never replace the compact reviewed editor with a generic form.

Visual acceptance locks in the compact icon-led/composable anatomy, bounded scroll
viewport and fixed gutter/header, tokenized density/category/same-hue attention
shading, rightmost collapse carets and native Morph Select/date picker/menu/tooltip/
modal/drawer behavior. Use Zero icons first with documented exact-glyph fallbacks.
Pending/reason/conflict/error feedback fits those surfaces. The stored theme
candidate remains separately opt-in; no site-wide theme replacement is implied.

## 12. Audit, files, hooks and service boundaries

Use native configurable logging; calendar must work with logging disabled and obey
required admission when enabled. Source-transaction semantic events describe actual
accepted appointment, availability, hold/booking and transition operations once.
Replays/no-ops, rendering, timer polls, claims and idle stream maintenance do not
manufacture user activity. Provider acceptance, delivery, read and human attention
are distinct evidence. Initiator, service action and affected record remain explorable
under native investigator authorization.

Record safe identities/revisions and declared change categories, not titles, clinical
notes, free-text cancellation reasons, contact details, prompts, credentials, raw
URLs or document contents. Store sensitive domain values only in authorized calendar/
app storage. Native view/list/duration evidence and app extensions follow the existing
auditing APIs, with human-readable resolvers reauthorized during investigation.
Transport success is not proof a person viewed a record. Public assets/booking
artwork never acquire a staff audit-handshake requirement.

Optional attachments use native Storage identities, grants, staged uploads and
authorized private delivery. An appointment reference does not grant object access;
refresh/revoke grants with calendar policy. No filesystem-path or public-URL shortcuts.
Native profiles/avatar/presence integrate through their admitted projections.
Notifications, email and messaging use the same configured Zero service contracts;
none is a mandatory external dependency of a basic calendar.

## 13. Managed lifecycle, recovery and operations

Boot order: pure config/policy admission → explicit migrations/owners → Guardian,
Fabric and configured logging → admitted domain registrations/adapters → Torrent
recovery/Jobs → calendar intent reconciliation and authorized routes/live reads.
Specify exact readiness dependencies to prevent cyclic startup. Recovery may inspect
private receipts without granting an expired user fresh action authority.

Shutdown retires intake/subscriptions, drains short calendar commands/handoffs,
retires provider admission and waits boundedly for physical effects, then closes
calendar logging sources/actors before their Fabric/provider/Guardian owners.
Durable unacknowledged work remains recoverable; forced death cannot run finally.
Qualify the actual supervisor's child containment and source/bundle bootstrap.
Do not create a second calendar-only worker manager or global current-app singleton.

A bounded drain timeout is not physical settlement. Report unknown effects and
unconfirmed resources, retain/quarantine occupancy, retire late publication authority
and use the supervisor's containment policy. Never report a clean stop merely
because the wait deadline elapsed.

Expose safe backlog age, coverage, held/expired counts, capacity pressure, blocked
adapters, unknown effects and reconciliation state—not payloads/seals or noisy
success rows. Define manual-review authorization and actions; resolving an uncertain
effect must not manufacture provider-confirmed evidence.

Document coordinated backup/restore requirements for SYSTEM, calendar, Jobs/Torrent,
logging and referenced Storage. This plan does not implement the separately planned
backup service. A restored stale source must not re-send completed effects or silently
adopt missing identities; reconciliation and operator recovery are mandatory.
Source/receipt divergence after restore blocks automatic effect readmission pending
reconciliation or manual review. A provider acceptance erased by restoring local
history, particularly SMTP, cannot be reconstructed or safely resent merely because
the restored intent says pending.

## 14. Delivery stages and acceptance gates

Each stage gets source/type tests and focused review before proceeding. These are
future acceptance requirements, not results from this planning pass.

1. **Contract decisions.** Approve private scope placement, visibility/delegation,
   generic/clinical defaults, dependency matrix, recurrence guarantees, guest proof
   and reminder ownership. Resolve the three core bridge/eligibility/capacity gates.
2. **Config/ownership.** Typed config, Doctor, permissions/adoption, private realm,
   owner/migration lifecycle, safe disabled/setup state and startup/close parity.
3. **Domain/facades.** Authoritative time/availability/resources, receipts/revisions,
   atomic conflicts/holds, catalogs, status reasons and scoped API/SDK queries.
4. **Durable source/horizon groundwork.** Verified source-to-Jobs seam, pinned
   Torrent handoffs, retained-capacity design, fresh domain eligibility, coverage
   extension protocol, semantic audit and crash/reconciliation qualification.
5. **Series, booking and effects.** Standards-tested recurrence/exception/split and
   bounded coverage; offers/proofs, requests/confirmation, invitation policy and
   concurrency; stale-reminder suppression, channel idempotency/unknown review and
   configured Storage/presence/directory adapters. Automatic future coverage cannot
   ship before stage 4. Pure preview tests alone do not complete this stage.
6. **Native UI.** Async controller and shared transition boundary; authorized live
   snapshots, drafts, dialogs, filters, booking, management and empty/error states.
7. **Qualification/docs/release.** Synthetic real managed runtime, populated upgrades,
   real Chromium and exact installed source/official bundled Linux/amd64 deployment,
   restart/kill/retirement, performance, package/Doctor and normal updater checks.

Minimum matrix:

| Boundary | Required evidence |
| --- | --- |
| Modes/config | Single simple/advanced and multi shared-row/tenant-file; auth:false rejection; disabled inertness; populated enable/disable/re-enable; A→B→A policy retirement; registry-version changes without lost assignments. |
| Authority/privacy | Delegated non-admin scheduler, location constraints, participant/busy redaction, guessed IDs, narrowed native scopes/client revocation, API-key/public proof limits, quiet-watch/paused-read revocation, safe receipt replay after grant loss and no cross-scope late render. |
| Booking | Competing provider+room reservations, buffers/capacity, hold-expiry/confirmation race, stale revisions, override reasons, request-for-review capacity and same-command replay. |
| Time/series | Different viewer/provider/site zones, DST gaps/folds, non-hour changes, leap/month-end/fifth weekday, DTSTART/pattern mismatch, COUNT/UNTIL, all-day/cross-midnight, all/future/one edits, exceptions, moved identity and bounded horizon conflict behavior. |
| Handoff/recovery | Death before handoff, after Jobs/Torrent commit and before source acknowledgment; claim expiry, revoked actor versus service lifetime, restart and retained old workflow definitions. |
| Effects | Cancel while pending/claimed/queued/in-flight; lost acceptance; partial email rejection; unknown SMTP; permanent notice replay; no blind retry after accepted-but-local-failed result. |
| UI | Every status/cancel entry point, pending/unknown/conflict, newer typing surviving older acceptance, catalog/policy change mid-edit/booking, retired/reopened owners, native focus/exit, narrow screens, motion modes, 15 providers and empty first calendar. |
| Reactive/performance | Coalescing, reconnect gaps/out-of-order, resource removal, immediate denied-content withdrawal, no idle audit spam, concurrent scope progress and populated file-mode budgets. |
| Release | Matching actors with empty child env; never boot app in actor; exact installed archive and official bundle; updater preserves application state/themes; owned fixtures clean themselves. |

Do not deploy/migrate PracticeIQ or any other app as part of framework development.
App acceptance and rollout remain separately authorized. Existing UI, demo archive,
source history and conversation history stay preserved. External calendar sync,
payments, telehealth/video, Gantt/timeline, site-wide theme replacement and generalized
backup implementation remain separate work.

## Implementation checkpoint

The initial private realm/admission/ownership foundation is now connected into
a larger managed core vertical path: optional AppConfig, canonical root isolation,
dedicated bounded Fabric runtime, Guardian-scoped namespaces, native private
`/api/calendar` HTTP, SDK retirement, hooks, semantic source-transaction logging,
and `ConnectedCalendarWorkspace` using the preserved UI. Creation, separate
resource grants, redacted busy reads, details, query, reschedule, cancel and safe
receipt reconciliation are implemented. Source migration identity is preserved
by the official JS build plugin; compiled default actor launch fails closed.

Review corrected mismatched config/query ceilings (31 days / 100 rows / 16
resources), raw query errors losing domain codes across worker IPC, native
transport replay after realm upgrades, owner-bind/live-query races and private
snapshot retention behind SSE backpressure. Existing-only file acquisition,
live target reauthorization on receipt replay and unknown-outcome fences remain.

Evidence includes real in-memory native writer/realm transactions, Guardian
service-to-runtime integration, source-audit rollback/replay, transport, hook,
SDK boundary and pure UI-model checks. The physical coordinator/file process
seams are explicitly simulated where used. They do not replace file-backed
worker death/recovery, actual managed compliance, browser, installed Linux/amd64,
bundle and updater acceptance. No qualified calendar artifact is selected yet.

Recurring working-hours/holiday expansion, offer/slot generation/public booking proofs,
participant/catalog/location models, recurrence, clinical statuses,
source-to-Jobs/Torrent effects, notifications,
self-booking and AI are still future stages. Unsupported feature enablement
rejects instead of claiming partial readiness. Existing standalone rich editors
and self-booking previews remain local UI; the connected core never silently
persists their unsupported fields. The default app/public theme is unchanged.

No application or production state was touched. The active filesystem-integrity
hold is unchanged; source edits and memory-only checks continue, but fresh heavy
qualification and packaging remain blocked until storage recovery is verified.

The [November 17 review checkpoint](../backend/calendar/qualification.md) records
the subsequent lifecycle cancellation/close-retry, subscription retirement,
scope-owned reconciliation and bounded interval-index corrections. It separates
passing memory/HTTP/UI/type checks from the then-prepared eight physical actor/file
and two managed-compliance scenario definitions, all unexecuted. These
changes do not make the richer standalone UI, reminders or public booking into
implemented backend capabilities.

### November 17 explicit availability and one-off blocks

The next approved source stage now implements explicit per-resource UTC windows
or unrestricted policy, with bounded normalized windows, immutable policy history
and a resource-revision-controlled current pointer. An explicit empty window set
is closed. New appointment creation and UTC-occupancy changes must fit each
resource's current policy, including buffers. Restrictive policy changes never
cancel or move accepted appointments; unchanged occupancy and zone-only corrections
remain grandfathered. This is not recurring local working hours, holiday/DST
expansion, presence inference or an authoritative slot-offer API.

Appointment, block and availability watches share the current-authority native
subscription/SSE machinery, bounded quiet checks and SDK retirement. Busy reads
bound each resource/store partition before merging a global redacted page rather
than sorting all retained matching rows. The completed checkpoint for this stage was
279 memory/HTTP/SDK/UI/readable-label tests plus four pure migration-transform
tests, with no-emit source/regression compilation; see the qualification guide
for exact counts and the physical scenarios that remain unexecuted.

Private one-off blocks have canonical instants, an explicit zone, title, creator,
revision, fixed resource membership and active/cancelled history. They have no
buffers and are bounded to 31 days. Appointment and block reservations share one
atomic capacity-one conflict domain; creating/rescheduling a block rejects both
reservation kinds rather than cancelling anything. Cancellation releases all
owned block reservations. Current manage on every resource is required for
writes and replay; all-co-resource details authorization occurs before read
membership/truncation. Redacted busy reads combine both stores under one global
limit/order without exposing private record identity or titles.

The additive `002` migration preserves the existing `001` migration source and
receipt constraints. Separate block receipt/effect tables retain true block target
identity while sharing the stable scope/principal/request-key namespace with old
commands; reusing a key across families conflicts. Canonical accepted availability
and block changes append source-atomic opaque semantic facts once; no-op, replay
and rollback produce no false audit change. Effect-reference intents still do not
dispatch work or enable Jobs, Torrent, reminders or notifications.

The block suite passed 16 native-memory tests / 164 assertions on pinned Bun 1.4.4,
using real tracked writer transactions and copied bounded read sessions, including
late-create/update rollback, current-grant replay revocation, mixed busy truncation
and the maximum interval boundary. The completed scheduling-stage checkpoint was
279 integrated tests / 5,765 assertions / 35 files, plus four pure migration-transform
tests / 15 assertions; see the historical evidence in the
[qualification guide](../backend/calendar/qualification.md). No physical fixture,
worker process, build, dependency install or release output was created by this
stage. The storage-integrity hold remains unchanged. Physical additive upgrade,
recovery/contention, managed compliance, browser, bundle, installed Linux/amd64 and
normal updater acceptance still gate release. No production-qualified result,
application migration, hosted-demo change, richer editor persistence or complete
calendar-plan implementation is implied.

### November 17 authenticated temporary holds

Authenticated `holds.acquire/get/query/watch/release/confirm` now join the scoped
server/browser facade. This is not public self-booking, guest proof/slot offers,
or a new native hold UI. `selfBooking` remains false; the connected appointment
workspace, richer local editors and hosted demo are unchanged.

Holds reserve a fixed resource set and buffered UTC occupancy under current
all-resource book, active, availability and conflict checks. The server derives
identity and binds both principal and initiating user. Requested TTL is an integer
1–900 seconds, default 300, clipped to a strictly future start. At server expiry,
the held row is virtually expired for reads, conflict checks and live quota, with
no timer-driven write or cleanup dependency. Expired retained holds for the same
future interval do not block it. Fixed live quotas are 16 per principal and 1,000
per scope, alongside 100,000 retained holds and the global 200,000 receipt budget.

Private reads/releases require the original principal and user with current book
on every co-resource, or manage on every co-resource; authorization precedes
range membership/limit/truncation. Only the exact original subject can confirm,
even if another actor manages all resources. Confirmation requires the hold
revision, an unexpired held state, current book and every captured resource
revision. Grant/availability changes can stale a hold. Its resource membership,
instants, zone and buffers are immutable and sealed by acquisition evidence.

Confirmation supplies title only for the new ordinary appointment. The canonical
appointment writer freshly checks the same conflict/policy domain, excepting only
this owned hold, then atomically creates the appointment/reservations and consumes
the hold. The result is `appointment.created` with the new appointment ID, not a
hold confirmation receipt. Expiry, contention, revision/capacity rejection and
late insertion or audit failure roll the whole decision back. Release never
claims to cancel an already confirmed appointment. Unknown outcomes keep the
original key for receipt reconciliation and a separate authorized current read;
there is no automatic resend/reacquire. Acquire replay after expiry returns the
old accepted receipt, not renewal.

Additive `003` preserves both earlier migration source checksums and schema-map
generations. Private hold receipts/effect references share the existing
scope/principal/request-key namespace across families; they do not enable Jobs/Torrent dispatch.
Source-atomic acquired/released/confirmed facts are distinct and opaque; title,
scheduling times and private subject content are not copied. No-op, replay,
rollback and idle expiry emit no false semantic changes. Quiet watch expiry can
publish a changed authorized page with `invalidated:false`; existing scope/denial
retirement, backpressure and SDK owner boundaries remain in force.

Busy reads now combine three stores with no private target identity or kind. Each
resource/store partition is bounded before global merge, materializing at most
`48 * (limit + 1)` candidates, or 4,848 at 16 resources and a 100-result limit.
Expiry-first hold indexes skip retained expired prefixes before occupancy checks;
range/busy branches may sort the live set bounded by the 1,000 scope ceiling.
Appointment/block start indexes remain unchanged. These are query-plan/algorithm
bounds, not physical throughput or wall-clock benchmarks.

The focused hold suite passed 24 native-memory tests / 234 assertions, including
expiry/replay, co-resource privacy, quotas and expiry-index plans, canonical
confirmation/revision fences, competing transactions, partial rollback and late
source-audit backpressure. The integrated authenticated-hold stage passes 332
tests / 7,049 assertions / 40 files, plus four pure migration-transform tests /
15 assertions and no-emit source/regression-fixture checks; see the
[qualification guide](../backend/calendar/qualification.md); the completed
279-test scheduling checkpoint above is historical, not a new hold-stage total.
Nine native file/actor definitions and two managed-compliance variants now include
prepared hold coverage, but are **not executed** under the unchanged filesystem
integrity hold. Source/memory checks create no physical fixtures, actors, builds,
dependency trees or release output, and do not authorize retained-domain upgrades,
application migration, public booking or normal updater selection.

## 15. Documentation deliverables and open decisions

Create a canonical calendar backend guide/index with configuration/defaults,
permissions/modes, public SDK/server contracts, time/recurrence, availability/booking,
integrations, recovery/errors and populated upgrade instructions. Update the main
agent/start-here guides, server service members, client/hooks/exports, build/actor
guide, Doctor and frontend composition docs. Examples must use public facades and
clearly distinguish accepted, delivered, rendered and unknown outcomes.

Before implementation, review these recommendations with the user rather than
burying product choices in code: private per-scope domain placement; private/detail
visibility defaults and delegated grants; recurrence/dependency defaults and coverage
guarantee; initial self-scheduling proof/approval modes; organizational service-owned
reminders; and which delegated settings belong in the first management workspace.
The source-to-Jobs admission, synchronous eligibility boundary and retained Jobs
lifecycle also require an explicit technical design/qualification decision.

### Source review anchors

- Scope/authority: `src/auth/service-data-scope.ts`,
  `src/auth/service-data-authority.ts`, `src/frontend/server/request-database-client.ts`.
- Owned private feature precedent: `src/messaging/config.ts`,
  `src/messaging/runtime.ts`, `src/jobs/runtime.ts` and owner/persistence configuration.
- Missing source Jobs seam: `src/jobs/service-authority.ts`, `src/jobs/definition.ts`,
  `src/frontend/server/database-automation-execution-services.ts`,
  `src/frontend/server/database-automation-torrent-services.ts`.
- Retained capacity/cancellation: `src/jobs/realm-model.ts`,
  `src/jobs/realm-control.ts`, `src/jobs/realm-dispatch.ts`, `src/jobs/runner.ts`.
- UI boundary: `src/components/calendar/types.ts`,
  `components/appointment-editor.tsx`, `components/appointment-status-popover.tsx`,
  `components/calendar-surfaces.tsx`, `models/booking-model.ts` and
  `models/recurrence-model.ts` within that family.
- Native service constraints: [profiles](../backend/guardian/user-profiles.md),
  [identity projection](../backend/guardian/identity-projection.md),
  [presence](../backend/guardian/presence.md),
  [field access](../backend/resources/field-access.md),
  [Fabric consistency](../backend/fabric/consistency.md) and
  [Torrent activities](../backend/torrent/activities.md).

### Review status

The main pass and independent authority/configuration, execution/recovery and
UI-contract reviews were completed against the source baseline above. A second
cross-review corrected late-save modal closure, catalog preservation, native
credential ceilings, quiet-watch revocation, narrowed receipt replay, policy-owner
retirement, reminder lateness, downstream cancellation cutoffs, dependency order
and restore/drain uncertainty. These are planned requirements, not passed runtime
tests or new framework capabilities.

The original plan-review change was documentation only. Its instruction not to
publish an archive merely for planning still applies to documentation-only edits.
The user has since approved implementation; current source changes and their
actual qualification are tracked above and in the backend guide. Follow the
repository's release gates for an implementation artifact, not the historical
planning-only validation instruction.
