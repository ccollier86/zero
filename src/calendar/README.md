# Managed calendar core

Feature-branch implementation, not a qualified release. `calendar` configuration,
private Fabric lifecycle, current-Guardian service, native HTTP/client facades and
connected UI are now composed. Qualified 2.11.1 main still has only the experimental
frontend and released shared scheduling foundation, not this Calendar backend.
Read [normal-project availability](../../docs-next/backend/calendar/configuration.md#availability-in-normal-projects)
before telling an application to adopt branch-only APIs.

The [integration plan](../../docs-next/_work/calendar-integration-plan.md) remains
the contract for the remaining work.

Private recurring materialization is now being integrated under the separate
`series-*` modules and unregistered020/021/022 profiles. It has real plan acceptance,
native owner/signature/final-fence composition, bounded immutable child/resource
projection and whole-interval pending claims. Publication, continuation and
cleanup have passed their coherent native MEMORY review. These internals neither activate
the default realm nor complete exceptions/splits, sparse UTC coverage, managed
Jobs/reminders, booking or the connected management experience. The additive022
profile composes selected child/ordinary reads, whole-interval busy/conflict
projections and matching native controller budgets; canonical recurrence edits
are still unfinished. See the
[native materialization review](../../docs-next/_work/calendar-integration-plan.md#private021-native-materialization-review--november-25).
Do not import them as a supported application shortcut or call this backend
end-to-end finished while those gates remain open.

The [backend guide](../../docs-next/backend/calendar/index.md) documents the
implemented core and its explicit limitations. This is not the complete plan:

- Timed bookings accept canonical UTC instants and a scheduling zone. Canonical
  `017` also supports untyped all-day LocalDate intervals with explicit authored
  boundaries and indexed date reads, not a timed-midnight shortcut. The private
  recurrence implementation is not yet an enabled series API or a UTC
  availability certificate. See
  [all-day appointments](../../docs-next/backend/calendar/all-day.md).
- Availability is an explicit unrestricted policy or at most 100 positive UTC
  windows normalized by merging overlap/adjacency. Full buffered appointment
  occupancy must fit current policy on each resource; restrictive changes
  preserve existing appointments. Versioned `availability.policy` also admits
  weekly-local rules with finite date coverage and explicit exceptions; the source
  freezes their UTC expansion once, then bookings use an indexed current window.
  The legacy whole-policy facade cannot silently overwrite weekly state. This
  is not an automatic horizon, appointment series or slot-offer API. See
  [working hours](../../docs-next/backend/calendar/working-hours.md).
- Private one-off blocks share appointment conflicts, require current all-resource
  manage for writes and details for private reads, and retain cancelled history.
  They have no buffers and cannot overlap or silently cancel other reservations.
- Versioned locations and resource assignments support permission-filtered
  catalogs and same-location region/ID facets, never geographic authority. Scope
  managers own catalog edits; current resource managers replace bounded location
  sets with live, transaction-checked visibility witnesses. Current projections
  keep queries off retained history. Resource revisions fence older holds.
- Optional visit bindings attach exact in-person location versions or phone/video
  modes to appointments/holds, with no inferred provider or manual URL. New/relevant
  changed bookings verify current all-resource assignment compatibility; old
  labels/regions remain immutable snapshots. The active visit picker starts from
  at most 16 current assignment candidates, not the entire scope catalog. This is
  not medical/geographic eligibility or a location capacity reservation.
- Versioned appointment types supply exact minute durations, buffer defaults and
  optional presentation keys. Scope managers control catalogs and resource
  unrestricted/optional/required policies; owning a resource cannot weaken its
  type policy. Typed bookings/holds capture historical generations, while new
  bookings, changed occupancy/bindings and confirmation check current policy.
  Catalog changes never relabel accepted appointments or change their occupancy.
- Generic lifecycle policy defaults to ordinary confirmation/cancellation with
  optional reasons; scope management can enable tentative/completed/no-show and
  required reasons. Server action discovery and canonical transitions enforce
  all-co-resource management, exact appointment/policy revisions and terminal
  states. Only cancellation releases occupancy. Private reasons stay out of busy,
  receipt/effect and audit payloads; visit/lobby/attention are separate future axes.
- Authenticated holds expose acquire/get/query/watch/release/confirm. Acquisition
  reserves fixed resources and buffered occupancy with current all-resource book,
  active state, availability and conflict checks. Requested TTL is an integer
  1–900 seconds, defaults to 300 and is clipped at a strictly future start.
  Expiry uses the server clock on reads/commands, never an input clock or idle
  expiry write. Expired retained history consumes neither occupancy nor live quota.
- Hold private reads/releases require the original principal **and** user with
  current all-resource book, or current all-resource manage. Only the exact
  original subject can confirm, even when another actor is a manager. The hold
  revision and all captured resource revisions fence confirmation; grant changes
  can stale it. Instants, zone, buffers and membership are fixed and sealed by the
  acquisition receipt. Title arrives only on confirmation, not on the hold.
- Confirmation invokes the canonical appointment writer and atomically creates
  an ordinary appointment, consumes the hold and releases its reservations. It
  returns `appointment.created` with the new appointment ID, not a hold receipt.
  Expiry, contention, capacity and late source-audit failure roll everything back.
  Release is deliberate and revision-controlled; a confirmed hold cannot be
  released to claim cancellation of its ordinary appointment.
- Fixed live hold quotas are 16 per principal and 1,000 per scope, alongside a
  100,000 retained-hold budget and the global 200,000-receipt budget. Replaying
  acquisition after expiry returns the old receipt, not renewal. Unknown outcomes
  keep their original key for reconciliation, never automatic resend/reacquire.
- Configuration is detached, bounded and connected to managed startup. A
  configured object is not proof of actor/storage or release readiness.
- Realm commands run in the native tracked transaction boundary. They are not
  routes: actor fields and creation IDs must come from a trusted broker, never
  browser input. The managed broker derives them from current Guardian authority.
- Safe receipts preserve identity and outcome, not historical access rights.
- Scoped `capabilities.get/watch` projects current UI flags and configured limits
  without allocating owners/files/actors or enumerating accounts. It is not a
  resource grant. The connected one-off editor now composes native type defaults,
  visit/location and optional account selection. The rich atomic edit also
  supports participant replacement; its separate revision-controlled dialog
  remains available. Neither hides a participant write in legacy rescheduling.
  See the [connected workspace guide](../../docs-next/frontend/calendar/connected-workspace.md).
- Additive `002` preserves `001` migration/evidence identity. Block receipts and
  effect references have separate private tables with the same cross-family
  scope/principal/request-key namespace and current-target reauthorization.
- Additive `003` similarly preserves both preceding source checksums and declared
  schema generations. Hold receipts/effect references join that same namespace
  without rebuilding earlier evidence. Source/memory upgrade checks are not a
  passed physical existing-file upgrade.
- Additive `004` preserves all three older migration/schema generations and
  adds immutable location/assignment history, bounded current projections and
  true location receipts in the existing global command-key namespace.
- Additive `005` preserves all four preceding identities and adds catalog/policy
  generations, typed appointment/hold bindings and the fifth true receipt family.
  Typed reschedule history and original receipts survive subsequent type changes;
  cleared or cancelled bindings are retained, not silently erased.
- Additive `006` preserves all five prior identities and adds immutable lifecycle
  policy/outcome/reason history. Its sixth receipt family has a real policy target,
  while appointment transitions keep the existing appointment receipt family.
  Legacy cancel digests/default wire shapes and current-right replay are retained.
- Additive `007` preserves all six prior identities and adds appointment visit
  generations/current pointers plus fixed hold capture, without a new receipt
  family or backfill. Confirmation exactly transfers the captured visit; a stale
  location rejects atomically. Earlier no-visit command digests stay unchanged.
- Optional native participants require an explicit offline Guardian subject policy
  and current scope management. Additive `008` retains only opaque references,
  seals immutable appointment generations and exactly transfers held sets. Current
  SYSTEM names/tombstones resolve separately after the final authority wait; busy
  and ordinary detail DTOs never include them. New target admission joins the real
  synchronous final commit guard and canonical provisioning eligibility clock.
  There is no guest/contact/invitation adapter or copied identity projection.
- Private effect references are handoff groundwork, not another audit system or
  a working notification pipeline.

The runtime uses fixed empty-environment actors, existing-only acquisition for
established files, immutable scope ownership, bounded queues and commit-only
invalidation. Authorized appointment, block, hold, location/resource/type catalog
and detail, availability, type-policy, lifecycle policy, visit choices and transition watches use the same
coalescing, quiet revalidation, private SSE and SDK-retirement machinery. Busy
reads combine three stores with no titles, target IDs or kind discriminator. They
bound each resource/store partition before merging a redacted page: at most
`48 * (limit + 1)` candidates, or 4,848 at the fixed range/page ceilings. Hold
indexes first exclude expired history; remaining hold candidates may sort, but
the live scope set is bounded at 1,000. This is not a wall-clock benchmark.
Semantic changes use the existing transaction-bound logging outbox;
hold acquired/released/confirmed are distinct opaque source facts. Idle expiry,
watch renewal, no-op, replay and raw reservation rows do not manufacture audit
events or copy titles/times/subjects. Quiet expiry can publish an authorized hold
page with `invalidated:false`; scope/account replacement and denial still retire
private snapshots and callbacks.

`index.ts` exports setup/facade types and errors only; raw owner, actor, database
and command capabilities remain private. `@zero/framework/calendar` remains the
browser UI entry; `calendar/server` and `calendar/client` are separate entries.

Private F5 work is deliberately not registered or enabled: candidate020 adds
retained series source/grant/acceptance/publication facts; the initial source
writer records accepted preparation, not booked children. Separate status reads
preserve that distinction. The fixed native source reader captures an exact
scoped generation without Temporal inside SQL; detached compilation produces
bounded, runtime-branded candidates/progress and stable nominal child IDs.
Private broker/actor COMMIT wiring, durable cursors, versioned children, staged
occupancy publication and selected-child read composition are source implemented.
Exceptions/splits, complete one/future/all edits, sparse UTC coverage and Jobs
continuation must still land before recurrence/facade/UI activation. No app
should import these private files as an interim series API. See the
[finish-line ledger](../../docs-next/_work/calendar-integration-plan.md#finish-line-execution-ledger).

Still required before release: actual file/actor, managed compliance, real-browser,
official JS bundle, Linux/amd64 installed archive and normal updater qualification.
Compiled executables fail closed with the default source actor launch. Complete public recurrence,
automatic working-hours coverage extension, slot offers/public booking proofs, domain-contact/guest participants,
clinical visit/lobby/attention states, invitations, reminders, AI and public self-booking are not
available end to end; unsupported enablement rejects. Authenticated holds do not enable
`selfBooking`; public booking remains off. Availability/block/hold management is
scoped facade-only in this stage; the connected appointment workspace and hosted demo do
not acquire a richer management editor. Source/memory checks do not qualify the
new physical upgrade/recovery paths, clear the storage-integrity hold or select
a production/updater artifact.
