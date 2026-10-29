---
id: zero.work.logging-auditing-replacement
type: architecture
audience: [developer, agent, maintainer, operator]
owner: observability
status: draft
visibility: internal
system: logging
feature: generic-activity-auditing-replacement
maturity: planned
applies_to: ["Proposed replacement of the Zero 2.7.0 auditing product"]
modes: [single-simple, single-advanced, multi-simple, multi-advanced, browser, server, file, Fabric]
reviewed_against:
  package: "@zero/framework"
  version: "2.7.0"
  commit: "534e7a0edf56c44eb0ae62c7a603238840315ded"
  snapshot: clean
  date: "2026-10-29"
  evidence_level: source-observed
---

# Logging and Auditing Replacement Plan

[Working index](./index.md) · [Logging roadmap](../backend/logging/roadmap.md) · [Current APIs](../backend/logging/api.md)

Replace the transport-centered auditing product with a generic, useful activity
trail for any Zero installation. A reviewer must be able to identify who did
what, which page or records were involved, what changed, when it happened and
how long a view was visibly open. The first interface is the existing Zero
DataTable, with readable, clickable, explorable and server-filtered activity.

This is a replacement implementation plan, not an implemented API or a patch
release. Runtime work is paused for design review. Zero 2.7.0 remains the
selected update containing blogging and messaging; this plan changes neither
their release status nor an application's configuration or data.

The product and capture decisions here supersede conflicting directions in the
[original logging plan](./logging-system-plan.md) and
[earlier workspace polish](./logging-workspace-polish.md). Preserve those
documents and [qualification evidence](./logging-compliance-qualification.md)
as history. Passing earlier controls or package tests does not establish the
activity experience specified here.

## Product boundary

Zero supplies one optional core subsystem, not a healthcare-specific plugin.
Native operations are captured automatically. Installations add domain labels,
record navigation, field policies and genuinely custom actions through the same
facade. They must not implement another logger, database, worker or audit UI.

Retain and requalify useful Guardian, Fabric, transactional outbox, integrity,
private Storage, SDK, worker and DataTable foundations. Replace the capture,
correlation, view-history and presentation behavior that fails these requirements.
Do not rewrite unrelated blogging, messaging, routing or database services.

No new dashboards, graphs, session recordings, behavioral heatmaps or elaborate
investigation views belong in the first replacement. Nightly backups and
importable historical-log packages remain separate future work.

## Current findings

The inspected baseline and user reports establish different kinds of findings:

| Finding | Evidence and correction required |
| --- | --- |
| An idle audit page creates activity | [Delivery admission](../../src/logging/logging-admission.ts) appends an acknowledgment for each handshake. Separate routine liveness from user/security actions without removing durable required-delivery checks. |
| HTTP plumbing dominates the feed | [HTTP admission](../../src/frontend/server/app-logging-admission.ts) and [stream release](../../src/frontend/server/app-logging-response-stream.ts) record generic admitted/prepared/completed stages as record activity. Keep relevant technical evidence separate from semantic actions. |
| Public artwork receives recovery HTML | The user reproduced this. The HTTP catch returns recovery HTML for cookie-only GET/HEAD admission failures without checking document intent. [Public classification](../../src/logging/logging-public-request.ts) is not consistently attached to all explicit public surfaces. Reproduce the selected public asset route before fixing it; do not infer publicness from an extension. |
| Generic record edits lack useful differences | [Source capture](../../src/logging/logging-source-capture.ts) records table, row, operation and sequence, not a field-change summary. Implement trusted same-commit differences for pinned and Fabric writers. |
| Record identity is hard to discover | [Main cells](../../src/components/logging/logging-columns.tsx) show the resource category while [detail](../../src/components/logging/logging-event-detail.tsx) places IDs under technical details. Identity, changes and duration belong in the ordinary experience. |
| View bindings do not guarantee usable view history | [The collector](../../src/frontend/client/logging-collector.ts) has one mutable target and interval events; [presets](../../src/logging/logging-config.ts) do not enable views under compliance by default. Replace implicit target ownership and reconcile effective capture policy. |
| Navigation lacks a useful page identity | The collector compares URLs in memory but does not persist a route identity; a navigation can inherit the previous record target. Bind committed router state independently from record views. |
| No historical displayed-list contract | Current observations cannot reconstruct the ordered records and revisions actually presented during a changing DataTable view. Add authorized result receipts and displayed revisions. |
| Counter and selection mismatch | [LoggingWorkspace](../../src/components/logging/logging-workspace.tsx) starts at 25; [standard options](../../src/components/data-table/data-table-pagination.tsx) are 10, 20, 50 and 100. [Its adapter](../../src/components/logging/logging-table-source.ts) omits totals. Reproduce the reported split-digit layout in the actual built CSS too. |

Do not describe a source-level explanation as a verified browser fix. Each
defect requires a failing isolated reproduction and corresponding release proof.

## What one activity represents

A logical activity is a human or service action, not each HTTP stage. It has a
stable operation identity, initiating actor, executing service where relevant,
application or organization scope, target references, event times, outcome,
policy version and links to its supporting evidence.

Separate three responsibilities inside the same subsystem:

1. **Audit activity:** meaningful navigation, list/record access, changes, files,
   security, services and declared business actions.
2. **Operational diagnostics:** errors, timeouts, worker failures and explicitly
   enabled technical tracing, with independent severity and retention.
3. **Delivery control state:** availability probes, short grants, checkpoints and
   recovery bookkeeping. Healthy renewals are not new user actions.

Immutable evidence retains real stages and uncertainty. A rebuildable activity
projection combines only stages with the same trusted operation identity. Do
not group by similar timestamps, user names or guessed URLs. Delayed confirmations
append evidence and update the projection; they never overwrite earlier facts.
An HTTP 200 alone cannot set a business action to Succeeded.

Security-significant interruption, recovery, revocation or logging-policy changes
remain auditable. Routine successful maintenance does not belong in the activity
feed, even under compliance. Simply hiding rows while continuing unbounded
capture is not the replacement.

## Automatic native capture

| Native surface | Required activity |
| --- | --- |
| Router and AppShell navigation | One committed page transition with stable route identity and readable page name. No navigation for prefetch, rerender, hash-only state unless deliberately configured, or a rejected transition. |
| Resource and data-facade reads | Authorized list/search or individual record access, correct source/table/record identities, result receipt and honest preparation/release stages. Server release alone is not a claimed browser view. |
| DataTable and native record views | Actual displayed result revision or opened record, correlated to the authorized read. Page/filter/sort changes and admitted live changes use the same view lifecycle. |
| Tracked ReactiveDB and Fabric mutations | Committed create/update/delete, actual changed fields, approved old/new values, source ordering, initiating user and worker/service attribution. No success for rollback or a no-op. |
| Guardian | Meaningful sign-in/out, failures, MFA, permission/membership/account/session changes and denied actions. Ordinary token/lease renewal is not another interactive sign-in. |
| Storage and exports | Actual authorized upload, preview/read, download/export/share stages where the owner can establish them. A link issued, producer completed and recipient received are different facts. |
| AI, email, messaging, payments and Torrent | Operation-specific outcomes through their native service boundaries, with user versus executor attribution. Do not infer delivery, settlement or job completion from a generic row update. |

For example, changing an invoice's status from Draft to Approved is an ordinary
audited record edit. The app does not emit a second invoice-approved event.
An optional label mapping can make the same action read Approved an invoice.
Bulk actions have a parent summary with explorable affected records and changes;
they do not lose per-record evidence or fill the feed with unrelated child rows.

Publish a coverage matrix for each public read/write path. Tracked commands and
raw SQL are not equivalent. Custom SQL or a custom renderer uses a declared
public integration where Zero lacks semantics; unsupported capture must not be
silently labeled automatic. Doctor should identify known configuration/consumer
gaps, not promise static discovery of arbitrary application behavior.

Carry one interaction/operation context through the native trigger, SDK request,
service operation and resulting view. A button opening a list or record needs
no hand-written click log. Do not log every DOM click or conflate the request,
data release and committed display. Explicit machine/API clients retain data
access activity without inventing a browser view.

## Historical lists and changing tables

Use a list-view session, not a fresh query when the auditor opens an entry.

1. The authorized server read produces an opaque result receipt bound to current
   actor, scope, source, safe query definition, projection and policy. It records
   ordered record identities and revision references, plus approved historical
   display values where needed. Joins use declared result identity and mappings.
2. The native DataTable confirms a committed displayed page against that receipt.
   A button click, request, prefetch or off-screen cache fill is not this event.
3. Every actual displayed revision has ordered membership and an observation
   time. Retain a baseline and deltas for adds, removes, changed revisions and
   order. Pagination, filter, sort and page-size changes identify a new displayed
   revision, including an empty result set.
4. Native held arrivals are not displayed until the table actually reveals them.
   Updates suppressed while a user edits or reads an older page do not enter
   that displayed revision merely because the database changed.
5. Batch delivery while preserving distinct displayed revisions and their order;
   do not retain only the final net difference if intermediate states appeared.
   Bound storage and queues with explicit completeness and failure policy.

Explore records opens the preserved ordered set for the selected revision using
the same DataTable family. Approved snapshots must remain historical after edits
or deletion. Current authorized labels/links can supplement them but must be
marked current, not substituted as past values. If only identities were retained,
say so rather than inventing a historical row body.

Distinguish **the result/page displayed** from **rows in the visible viewport**.
Virtualization does not prove every result was visible. Default auditing records
the displayed page/result; optional viewport observations have their own meaning
and bounds. Neither establishes human attention.

Server receipts prevent a browser from claiming arbitrary private records as
server-confirmed results. The browser supplies observations, never actor, tenant,
authority or a promotion of evidence strength. Custom sources without a native
read receipt require the public source adapter or explicit weaker provenance.

## Record views and time

One view session binds a specific record and revision to a component owner.
Support nested dialogs, drawers, multiple mounted views and separate tabs without
a single global target overwriting another. Opening a parent page must not claim
that a nested record opened, or inherit the record just closed.

Track opened/closed times, observed foreground-visible duration, optional active
duration, idle state and completeness. Visibility, focus, hide/minimize, navigation,
scope replacement, record replacement and unmount have explicit lifecycle rules.
Do not fabricate time across sleep, missing intervals, process death or clock
changes. Stop accumulating while the protected view is masked or not displayed.

Use private bounded checkpoints for a long-lived session and a compact activity
summary, not one top-level audit row per heartbeat. An ongoing duration may update
its derived row; immutable observations remain separate. A missing close remains
an interrupted/incomplete view with its last confirmed observation.

Opening the audit workspace is an investigation action. Its automatic projection
refreshes, counters, heartbeats and self-observed list revisions must not create
recursive audit activity. Explicit filter changes, exports, holds and reviews
still use the applicable investigation policy.

## Edits and approved differences

Compute differences from the actual source transaction's before/after records,
not an untrusted client patch. Share the implementation across pinned and Fabric
writers. Capture table, stable primary key, changed fields and operation/revision
references. Preserve initiating authority across a queued job without holding an
auth or database lease across its external work.

Provide generic schema/resource field policies: include, redact, omit and approved
before/after values. Humanize ordinary table/field names by default. Safe enum or
boolean differences may be enabled by an admitted resource policy; unknown or
sensitive values stay redacted. Passwords, credentials and tokens are never
ordinary diff values. Do not start copying clinical text, prompts, attachments or
arbitrary bodies into scalar metadata.

Large structured/text differences need bounded approved snapshots or immutable
revision references and an authorized comparison surface. Show redaction,
truncation or missing history explicitly. Existing opaque mutation receipts do
not retroactively supply differences that were never retained.

## Application extension tools

Extend `zero.logging` and `client.logging`; do not introduce a parallel logger.
Keep existing `record`, `read` and `run` working while adding the reviewed typed
contracts needed for activities, list results and view sessions. New names and
configuration paths are finalized during implementation, not claimed available
by this plan.

The public toolkit must support:

- Typed custom action definitions with readable labels, bounded payload schemas
  and explicit sensitivity policies. A custom action is needed for semantics
  outside native capture, not every ordinary button or CRUD operation.
- Owned action/read wrappers that carry operation identity, request scope,
  executor attribution, outcomes and asynchronous cancellation. They do not
  replace domain authorization or turn a callback return into provider delivery.
- Native component bindings and small hooks/wrappers for custom record/list
  views. Bind server result receipts and actual displayed revisions; do not make
  applications manufacture Sync INSERTs or supply user/tenant identities.
- Resource/page registries for friendly names, safe record identifiers, permitted
  historical labels, authorized current links and per-field diff policy.
- Source/actor integration for custom tracked transactions and durable jobs,
  with exact-intent idempotency and no false success after an uncertain effect.

UI mappings affect presentation only. A custom label can say Approved an invoice
only for evidence establishing that result. Current lookups enforce scope and
record permissions and cannot expose another tenant or restore a deleted secret.

## Configuration and off behavior

Keep `logging: false` and omission as off for this optional subsystem: no new
logging storage, workers, browser collection or required-delivery gate. Existing
Guardian security history and ordinary console observability are separate
settings/contracts, not secretly disabled by this switch. Disabling does not
delete retained evidence or make an audit workspace publicly accessible.

Separate **capture policy** from **assurance policy**, with presets as convenient
defaults rather than multiple implementations:

| Preset | Product default |
| --- | --- |
| Basic | Essential security events and useful operational warnings/errors. |
| Activity | Basic plus native page/list/record access, committed changes, files and service actions. |
| Detailed | Activity plus selected view duration and additional declared observations, with explicit privacy controls. |
| Compliance | Native activity and foreground record/list view duration by default, plus required durable capture, integrity, scoped access and recovery guarantees. Not debug-level HTTP tracing. |

Define effective controls for families, sources/resources/routes, read/list/view
capture, duration, field diffs, observations, outcomes, metadata, technical
diagnostics, retention/holds, exports and resource storage bounds. Copy/print
remain optional observations. Required scope/resource rules form a minimum
which user preferences and delegated organization settings cannot weaken.
The new compliance default must enable the native record/list view bindings,
not require every installation to rediscover a hidden disabled views family.

Use server-owned startup policy first; future database-backed administration
requires its own authorized precedence and reconciliation contract. Publish the
effective policy and coverage without secrets. Do not require the app to replace
logging internals or maintain a private package patch to configure behavior.

Preserve existing explicit configuration or fail with actionable migration
instructions. A replacement must not silently enable sensitive field values,
broaden browser collection, introduce an expiry cutoff or weaken required audit.

## Public and protected delivery

Correct this boundary before enabling the replacement in an existing strict app.
Explicit public artwork, styles, scripts and public publication routes must work
with or without an ambient staff cookie, during expiry and while audit delivery
is unavailable. This does not classify an authenticated/private file as public.

Determine publicness from the selected trusted route and its effective inherited
policy. A public child cannot erase a required parent. An extension, Accept
header, URL suffix, query flag or a broad prefix must not exempt a protected
handler. Reconcile the existing build-prefix exemption with selected-route policy.
Native endpoints, file routes, plugin assets, discovery routes and deliberately
declared raw-plugin assets need a consistent supported contract.

HTML recovery belongs only to a genuine protected document navigation. Images,
API reads, downloads, scripts and styles must never receive a substituted HTML
confirmation page. Preserve HEAD, MIME, caching and range behavior where offered.
Public requests may still execute their ordinary domain/auth policy; audit
classification is not permission to use a protected service facade.

Required work retains fresh authority, expiry, session/scope/policy binding,
source durability and final release/commit fences. Keep sign-in, health,
handshake and recovery reachable. Pending healthy admission is not a failure
panel. Expired/revoked/unavailable protected work remains closed and recoverable.
Optional capture must not accidentally acquire strict access restrictions.

Routine liveness renewal needs a fresh durable control acknowledgment, bounded
state and generation fencing without appending another human activity. Do not
replace this with a timer, cached prior success or weaker authorization. Preserve
meaningful interruption/recovery evidence once per transition and qualify disk,
worker, custody and revocation failures on the revised protocol.

## Persistence and processing

All persistent logging data uses private Fabric-owned databases, separate from
application data and canonical Guardian state. Reuse existing actor supervision,
private Storage and identity ownership; no browser-selected database, independent
SQLite logger or second identity store is permitted.

| Responsibility | Persistence and ownership |
| --- | --- |
| Source capture | Small same-transaction outbox entries for committed native mutations, with rollback, source order and bounded backpressure. |
| Immutable evidence | Versioned source/event identities, original attribution, stage/provenance and retained duplicate/integrity proofs in the audit plane. |
| Readable activities | Rebuildable indexed projections, operation grouping, target summaries, outcomes, changed fields and view summaries. An update to a summary is not a fabricated INSERT. |
| Lists and differences | Bounded manifests, historical projections, revisions and permitted differences; larger artifacts use private managed Storage with explicit publication/recovery. No full record bodies in event metadata. |
| Delivery control | Expiring bounded state and real availability probes, independently represented from ordinary activity. State is not a restored authorization grant after restart. |
| Diagnostics | Independent Fabric stream/database, severity, capacity and retention. Debug volume must not consume required-audit capacity unchecked. |

The dedicated delivery process and Fabric read/write workers perform heavy
ingestion, projection updates, exploration queries and exports. Atomic evidence
and activity-projection publication must share a committed owner transaction or
an explicit duplicate-safe outbox/recovery boundary. Do not promise a distributed
transaction between application, system, audit and Storage files.

No network/provider await, large artifact build or whole-history scan may hold an
application transaction or Guardian authority lease. Maintain independent progress
across databases, one ordered writer per file and bounded concurrent readers/jobs.
Keep queues and artifact/session limits explicit; exhaustion becomes documented
backpressure or incomplete optional capture, never silent loss of required data.

Subscriptions follow committed projection changes and revalidate current scope.
Coalesce notifications/reads and use indexed server filters and totals. Snapshot
and cursor admission must close the read/subscribe race. Transport reconnect must
not duplicate actions, skip displayed revisions silently or revive retired data.
No idle whole-history polling or source-capture recursion is allowed.

Retention, holds, verification and exports cover referenced list manifests,
differences and view observations as well as their parent evidence. An event
must not claim an explorable artifact whose bytes expired behind an active hold.
Artifact publication, orphan reconciliation and cleanup have explicit receipts;
export manifests retain versions, completeness and references needed to inspect
the selected historical activity. No new automatic deletion schedule is implied.

## First interface using DataTable

Reuse `LoggingWorkspace`, native DataTable, Filters, Morph Select, ScrollArea,
managed dialogs, animated counters, Zero icons, tokens and existing insertion/
pagination motion. No parallel table engine, global theme change or bespoke
incoming-record button is needed.

The ordinary row provides **When, Who, Activity, Item, Details and Result**.
Details includes the useful change or view-duration summary. The item is a page,
identifiable record, explorable list or file, not merely a category. Current
authorized names/photos identify people; service and system actions distinguish
their executor and initiating user. Missing people/records have retained readable
references rather than invented current profiles.

- Clicking a person filters the same table to their activity.
- Clicking a record explores its audit history and can use an authorized
  installation-provided link. Losing record access does not grant it through logs.
- Clicking a list opens its preserved membership/revision in a native managed
  surface with DataTable. Show count, observation time and completeness.
- Clicking an edit shows human field names and policy-approved differences,
  including clear redactions and the original operation outcome.
- Expanding evidence shows source/release/observation stages and technical IDs.
  Record identity and meaningful facts are not hidden under technical details.

Expose real server-side filters for person/service, action, target table/type,
specific record, page, time range, outcome, changed field and observation kind as
supported by the reviewed predicate/index contract. Use existing filter components;
never present unsupported nested operators or local-page text matching as a
server investigation. Audit criteria contain approved values/digests, not raw
sensitive search strings. Use clear/reset/apply behavior with valid typed criteria.

Totals count matching **activities**, not evidence stages, loaded rows, ordinal
differences or an unfiltered database. Use an authoritative snapshot/count boundary
and the standard rolling-number presentation. Coalesce live counts without
pretending unavailable counts are zero. Older-page cursor navigation stays stable
while the total increases; do not invent absolute positions or a last-page cursor.

Use a valid standard default such as 20 from the standard page-size choices, and
always render the selected value. Explicit custom sizes must be included in the
effective choices. Qualify real built styles so multi-digit numbers remain on one
line and only changed digits animate; reduced motion remains supported.

Keep retained rows mounted during live appends and summary updates. The native
incoming-record policy handles arrivals while a user reads older rows; initial
entrance motion must not replay. Loading, empty, filtered-empty, failed, revoked,
incomplete and reconnecting states are distinct. Keyboard, touch, focus return
and narrow layouts must work through the existing components.

## Installation boundaries and privacy

Support single tenancy and current-organization multi tenancy under simple and
advanced RBAC. Server-owned identity and scope follow a request, component view,
source commit and queued job; an API-key principal retains its initiating user.
Reviewing another user's activity requires explicit authority, not client filters.

Investigators may see only admitted audit evidence. Resolving a current record,
private avatar, historical value artifact or download rechecks its own applicable
policy. A cross-tenant label lookup, guessed ID or current membership cache must
not bypass these checks. Auditors do not automatically receive edit permission.

Use opaque references and minimum safe historical values. Do not collect raw URLs,
passwords, tokens, arbitrary search text, patient contacts, clinical bodies,
clipboard contents, prompts or provider payloads by default. Sensitive-value
capture, where permitted at all, requires explicit field/retention/read policy
and protected artifact handling, not another permissive metadata key.

Retained evidence stays historically attributable after renaming or deletion.
Show whether a label is historical or current. No interface may claim browser
observations prove attention, clipboard contents, physical printing or recipient
delivery. Required controls and useful capture do not constitute legal certification.

## Replacement and compatibility

Develop on a focused main-based feature branch. Do not merge a planned design or
select a new archive as if implementation were complete. Blogging and messaging
stay available through the existing qualified update while this work proceeds.

Use additive, reviewed migrations and an explicit policy/projection version.
Keep every existing migration definition and historical checksum unchanged;
new schema, query and policy contracts require their own admitted versions.
Preserve existing evidence, source/event identities, hashes, custody keys and
checkpoints, scopes, holds, exports, mutation receipts and source recovery state.
Do not rewrite or delete old transport/heartbeat events to tidy the new feed.

Historical evidence can feed a read-only compatibility projection. Mark its
unsupported record sets, differences and duration as not captured; do not backfill
them from current application records. Technical historical entries remain
inspectable, without masquerading as newly captured business activity.

Retain supported `zero.logging`, `client.logging`, browser hooks and
`LoggingWorkspace` entry points. Provide adapters/deprecations and explain any
necessary app integration change. Finalize whether unavoidable breaking changes
require a major release under the normal versioning policy; do not assume a patch
can safely reinterpret current policy, realm identity or retained API contracts.

Doctor and migration planning must inventory effective capture, known unbound
custom views/sources, field policies, required worker/source readiness, artifact
bounds and current schema/projection versions. Plan read-only first. No production
conversion, config activation or deployment occurs as part of package installation.

Qualify restored state and projected counts before cutover, then reconcile writes
during any shadow/projection catch-up. A legacy and replacement collector must
not both publish actions or renew incompatible policies. Retire old capture hooks
only after the new owner has an acknowledged transition; preserve in-flight
unknown outcomes and queued delivery. The supported disable/drain and rollback
boundary must state which old runtimes can reopen the upgraded files.

## Implementation order

| Phase | Work | Exit requirement |
| --- | --- | --- |
| 0 Contract | Approve meaningful activities, list/view/change semantics, privacy defaults, configuration and UI examples. Inventory native coverage and app extension points. | One agreed generic contract and exact acceptance scenarios; no application-specific replacement logger. |
| 1 Reproductions and admission | Reproduce public image HTML, protected access, idle self-generation, missing diffs/views, historical lists and counter/selection failures. Correct trusted route classification and isolate control renewals. | Actual browser image decoding works while strict protected work still fails closed; healthy idle renewals create no activity rows. |
| 2 Evidence and projections | Add typed operation/evidence/activity/view/list/diff contracts, source atomicity, durable control protocol, indexed totals and additive migrations. | Deterministic replay, no false success, recoverable projection and no mutation of old evidence. |
| 3 Native capture and extensions | Wire router, read facade, pinned/Fabric writes, DataTable, record views and existing service adapters. Add the public custom-action/view/source toolkit and coverage diagnostics. | Generic fixture works without per-button audit calls; custom fixture uses public APIs only. |
| 4 Exploration UI | Implement readable identity, list exploration, differences, time, filters and live counts using the existing components. | Real browser workflow is understandable and all drilldowns/filters execute under current authority. |
| 5 Upgrade and release | Rehearse retained-state migration, recovery, deployment, package/updater and complete normal release gates. Update canonical manuals and agent guidance. | Exact qualified commit/archive, normal updater handoff and separate application acceptance; not merely unit-test success. |

Use independently reviewable commits, but do not publish an incomplete mixed
capture protocol. A narrower public-asset safety patch can be independently
qualified if requested; it must not be described as completion of this replacement.

Implementation ownership stays in existing families: `src/logging` owns contracts,
policy, private persistence and delivery; router/server composition owns trusted
public classification and native request correlation; `src/sync` and
`src/databases` own transactional capture integration; `src/frontend/client`
owns scoped SDK/collector/view lifetimes; the existing DataTable and logging
component folders own display commits and exploration. Existing service owners
emit their semantic stages. Doctor, migrations, build and package docs are
integrated consumers, not a second logging implementation in each layer.

## Acceptance scenarios

Use synthetic applications and identities, not live customer or patient data.
Keep two fixtures: an ordinary generic records app with no special audit UI,
and a custom-source/action app using only public extension tools. Exercise both
tenancy modes and RBAC profiles rather than infer them from one administrator.

### Exact user workflow

Open a records page, select Completed, display a list, open one record, view it,
close it and return to Audit. The reviewer must identify the correct user, page,
displayed ordered list, exact record/revision, action times and observed duration
without understanding internal codes. No edit appears if nothing was edited.
If an enum changes from Draft to Approved, one committed action exposes that
difference; no manual duplicate approval event is needed.

### Required regression matrix

| Scenario | Passing result |
| --- | --- |
| Public image with staff cookie | Genuine image bytes, expected MIME/status and real browser decode before/after admission expiry and during delivery outage. No recovery HTML and no protected-parent bypass. |
| Protected data/private file | Missing, expired, revoked or cross-scope authority/admission never releases protected data; normal recovery works. Headers and extensions cannot claim publicness. |
| Idle audit workspace | Across multiple real renewal cycles, no new activity for a heartbeat, counter refresh or self-observation; no recursive read/append loop or hidden unbounded technical capture. |
| List, search, page and sort | Preserved authorized result receipts, ordering and displayed revisions; safe filter context, explicit empty sets and no false views for prefetch. |
| Reactive list | Add/remove/edit/reorder while open; explore each actually displayed revision later. Held arrivals are not shown early; delivery batching preserves observed order. |
| Historical exploration | Later edits/deletion do not change a recorded historical set or approved value snapshot. Uncaptured historical fields are labeled unavailable. |
| Detail view | Correct record/revision and time across page, dialog and drawer; no stale parent target, multi-tab collision, duplicate open or accumulation while masked/backgrounded. |
| Changes | Real before/after fields for admitted values, correct initiator/executor, rollback/no-op/denial/unknown handling, bulk exploration and no secret capture. |
| Native and custom paths | Default native integration needs no custom CRUD events. Public wrappers cover declared custom SQL, joined data, views and business actions without identity forgery. |
| Filters and identity | Person/table/record/action/time/change filters match server truth; deleted users, denied record links and tenant/scope replacement remain safe. |
| Totals and pagination | Exact filtered activity totals, standard selected page size, correct multi-digit rolling display, cursor stability, native live-row behavior and reduced motion in actual built CSS. |
| Service stages | Provider acceptance is not delivery; a failed/unknown terminal stage is not turned into success or a fresh automatic repeat. |
| Off and lower presets | No optional logger files/workers/collector/gate when off; lower capture remains usable without strict access restrictions; Guardian's independent contract remains explicit. |
| Backpressure and recovery | Source rollback, disk-full, actor/main death, response loss, duplicate replay, missing chunk and out-of-order observations retain exact outcomes and explicit completeness. |
| Retained upgrade | Evidence/custody/holds/exports/source receipts and realm ownership survive; old unavailable semantics are not invented. Restore and compatible rollback are demonstrated. |
| Deployment | Official source setup then Linux/amd64 bundled boots with matching retained actors, empty child environments and no accidental main-app boot/provider secrets. |

### Performance and release evidence

Measure source commit latency, foreground work during heavy logging, independent
database concurrency, high-rate list revisions, live-query/count latency, memory,
queue bounds, artifact size and recovery time. Agree measurable budgets before
implementation; do not claim logging can have zero resource cost. Required
evidence cannot be sampled away to meet a throughput number.

Use representative growing datasets and filters, not only empty tables. Query
and count work must use the dedicated readers and coalesced updates rather than
full-history work on the main application thread. Verify private-source writes
and foreground reads continue while providers and export jobs wait concurrently.

Run focused failing reproducers first, then native browser, installed package,
retained-state and Linux deployment tests. Finally follow the
[normal release procedure](../../docs/releasing.md) from an exact clean commit.
Record actual inventories, failures, timings and archive identity. Do not exclude
failed files, replace a failing run with retries or call UI fixture mocks a deployed
end-to-end proof. Preserve blogging, messaging, authentication, migrations and
existing public APIs through the complete regression gate.

## Documentation and delivery

Replace canonical logging configuration, coverage, browser, delivery, operations,
evidence, API and workspace guidance together with implementation. Document
supported native defaults and custom integration separately, including how to
disable, migrate, recover, scope permissions, configure diffs and explore history.
Use real public imports and executable examples; proposed names do not become
API by appearing in this plan. Update Doctor and the main upgrade/agent guidance.

The final handoff must contain the implemented coverage matrix, effective policy,
remaining limitations, real browser/deployment/migration results and the exact
released commit/archive SHA selected by normal update. No application or
production data is changed by the Zero release task.

## Plan status

This pass records the replacement design and source findings only. It introduces
no runtime behavior, migrations, collector, permissions, package-version change
or new selected release. Implementation and product acceptance remain pending.
