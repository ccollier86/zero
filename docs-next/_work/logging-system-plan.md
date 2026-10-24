---
id: zero.logging-system-plan
type: architecture
audience: [developer, agent, maintainer, operator]
owner: observability
status: draft
visibility: internal
system: logging
feature: configurable-activity-and-compliance-logging
maturity: planned
applies_to: ["Unreleased feature/core-logging implementation and remaining subsystem plan"]
modes: [single tenancy, multi tenancy, browser, server, file, Fabric]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "af5554b750affc48645889debf3680bee29c2ef5"
  snapshot: clean
  date: "2026-10-24"
  evidence_level: implementation-verified
---

# Configurable Core Logging and Compliance Plan

[Working plans](./index.md) · [Documentation index](../index.md)

Build one first-party logging system that scales from basic operational logs
and security events to detailed user activity and a compliance-oriented audit
configuration. It belongs in Zero core, with easy presets and granular controls;
applications do not install a separate compliance plugin to obtain the foundation.
Healthcare and HIPAA audit use cases guide the strict configuration without
turning ordinary applications into healthcare-specific products.

All persistent Zero log streams use Fabric-managed dedicated databases, separate
from application and Guardian data. A managed ingestion worker performs bounded
delivery, batching and recovery. The investigation UI composes Zero's DataTable,
filter builder, detail surfaces, tokens and motion rather than a second UI stack.

This is the full subsystem implementation plan. The branch-only
[logging preview](../backend/logging/index.md) describes the implemented
contracts, capture, APIs, browser collection, workspace and evidence lifecycle.
The remaining controls and qualification work below are release requirements,
not capabilities implied by enabling the preview.
It supersedes the earlier optional compliance-logging plugin direction in the
payments, messaging and email roadmaps. Existing Guardian audit and operational
observability remain authoritative until a separately qualified transition.

## Branch Implementation Status

The `feature/core-logging` branch implements event/configuration contracts,
safe validation, dedicated Fabric/ReactiveDB audit and operational realms,
idempotent append, scoped cursor queries, bounded batching and managed
`createApp({ logging })` lifecycle. Pinned application/Guardian contributions
capture durable source events; `zero.logging` and `client.logging` expose
authorized APIs, authenticated SSE and browser collection. A shared DataTable
workspace, bounded exports, holds, reviews and retained integrity/replay proofs
are also implemented. Backend diagnostics use a privacy-minimal adapter.

Compliance requests still fail closed with `LOGGING_NOT_READY`. Independent
tenant-actor capture, required browser-delivery admission, complete evidence
management and production qualification remain release gates. Real
subprocess/app tests cover restart, isolation, acknowledgment loss, scoped
release, partial construction, drain and payload limits. The
[branch review](./logging-foundation-review.md) records current verification
and the remaining work. Neither main nor saved upgrade packages include this
preview.

## Product Levels and Granular Configuration

Presets choose coherent defaults, not different products or arbitrary numeric
verbosity. Application configuration can refine each category. Increasing
capture does not authorize storing secrets or clinical content.

| Preset | Intended coverage |
| --- | --- |
| Basic | Operational errors/warnings, service health and standard security/account/session events, including successful and failed login, logout and revocation. |
| Activity | Basic plus meaningful application actions: authorized record access, create/update/delete, storage access, workflow actions and declared navigation. |
| Detailed | Activity plus view sessions and visible/active duration, observed copy and print actions, download/export/share actions, edit start/save/cancel and declared UI interactions. |
| Compliance | An explicit, reviewed activity policy plus strict durable admission, coverage inventory, attributable evidence, controlled investigation/export, integrity checks, retention/holds and documented review procedures. Detailed capture is selected by sensitivity and purpose, not indiscriminately enabled. |

The compliance preset packages capture and evidence guarantees together. It must
not merely mean trace-level debug logging or enable every browser event. Security
and compliance retention/failure policy are independent of diagnostic severity.

Granular controls cover event families, severity, resources/routes, sensitivity,
outcomes, duration tracking, permitted metadata, redaction, retention, live
presentation and destinations. Configuration can apply deployment defaults and
authorized organization-specific refinements. Mandatory deployment/resource
requirements form a minimum that delegated settings cannot weaken. User-level
privacy preferences apply only where the governing policy permits them.

An off setting for optional capture does not silently disable Guardian's existing
security audit. Sampling may be allowed for diagnostics and selected low-value
telemetry; required security or sensitive-access evidence is not sampled away.
Policy changes are versioned, authorized and audited, including who changed
coverage and when it took effect. Startup settings and any future database-backed
runtime settings need explicit precedence, effective-time and restart semantics.

## Event Coverage and Evidence Meaning

| Family | Events and required distinctions |
| --- | --- |
| Identity and sessions | Login attempts/success/failure, MFA, recovery, password/account changes, logout, session expiry/revocation, tenant switch and machine/API-key actions. Refresh activity must be configurable and not masquerade as a fresh interactive login. |
| Authorization | Grants/revocations, role/membership changes, denied requests, emergency-access invocation and approved purpose. The app owns its actual emergency-access policy; a log never grants access. |
| Record access | Exact resource identities where known; list/search versus individual read; authorization, data release and browser display are different events. Sensitive reads require declared instrumentation, not inference from a GET URL. |
| Data changes | Attempt, committed change, rollback, denied and unknown outcome. Record affected field names and permitted redacted differences; editing a form or issuing SQL is not proof of a committed update. |
| View sessions | View opened, visible/foreground intervals, active/idle transitions, periodic bounded heartbeats, close and incomplete termination. An open background tab is not active review. |
| Copy and clipboard | Declared copy button request/result and observed in-app copy events. Keep the method and observation strength; do not persist copied text by default or claim to detect external capture/screenshots. |
| Printing | App print request, server-generated print artifact and available browser dialog lifecycle. Browser events cannot establish that a physical print completed. |
| Files and transfers | Upload, read, preview, download, signed-link issue/use where observable, export, share, recipient/destination category and attachment access. Issuing a link is not proof it was used; downloading is not proof the person read it. |
| Communication and automation | Message/email send attempts and actual acceptance/delivery states, AI tool/model access, background jobs and workflow actors. Distinguish the initiating user from the service executing the work. |
| Investigation and administration | Log query/detail access, export, saved investigation changes, review acknowledgment, holds, retention changes, integrity checks and logging configuration changes. |

Optional navigation/search/filter tracking records safe action metadata, not raw
search terms, selected text, URLs containing patient identifiers or every keystroke.
Declared form events can include field names; passwords, token values and clinical
draft text do not become log fields. Source and instrumentation gaps must be
visible rather than filled with guessed activity.

Every event has a schema/version, stable event ID, stream, source identity,
event/receipt times, action, outcome, actor and executing service, tenant/scope,
session or machine principal, target, safe request/trace/operation correlation,
policy version and bounded allowlisted metadata. Evidence provenance distinguishes
server-confirmed, provider-confirmed, browser-observed, estimated and incomplete.
An unknown outcome is neither success nor definite failure.

The server derives actor and tenant attribution from live admitted context. A
browser cannot supply another actor, choose its database, upgrade an observation
to a server-confirmed event or mark a protected write successful. Historical
events preserve their original identifiers through account deletion and role
changes; authorized display-label resolution does not rewrite the evidence.

## Fabric Storage and Worker Ownership

Persist operational events and security/activity evidence in separate logical
Fabric service planes with independent databases, permissions and retention.
Diagnostic volume must not consume required-audit capacity unchecked. Begin with
centrally managed, tenant-scoped stores; deliberate physical tenant partitioning
can be added where a deployment requires it. The browser never chooses a ref/path.

File/WAL is the initial write-heavy placement. Required evidence and its source
admission use reviewed durable commit settings, not an acknowledged memory queue
or periodic image that can disappear after acknowledgment. Fabric owns migrations,
identity, actors, queues, readers, recovery and shutdown. Do not open an unrelated
SQLite connection inside a logger or reuse the app's schema as the log realm.

Use a lifecycle-owned ingestion worker alongside Fabric's existing database
actors. It validates/redacts envelopes, batches independent records, admits
idempotent writes, advances delivery receipts and schedules retention/export work.
Heavy export, hashing and compression stay out of request and SQLite transaction
critical sections. Separate database queues permit progress independently; each
file still has one ordered writer. No global logging lock may serialize every
tenant's application writes or hold Guardian's exclusive authority turn.

Existing foundations include managed
[data planes](../backend/runtime/data-planes.md),
[pinned service runtimes](../../src/databases/pinned-database-runtimes.ts),
[realm declarations](../backend/fabric/realms.md),
[realm composition](../backend/fabric/realm-composition.md) and
[actor concurrency](../backend/fabric/concurrency.md).
The current plane lifecycle is not already a configured logging product.
Implementation must add explicit log realms, service ownership and worker wiring,
including actor bootstrap in applications that do not otherwise enable multiple
application databases. Never hide actor I/O behind a synchronous readable-store
interface or require the application to manufacture privileged raw handles.

## Durable Admission and Delivery

For a protected mutation, capture an event/outbox record in the originating
transaction. Only committed records are forwarded after the writer releases its
transaction and authority lease. A rollback rolls back the corresponding success
evidence. Denied/failed attempts use their own admitted path. The source holds a
bounded delivery receipt, not a second permanent logging database.

Deliver at least once to the dedicated audit database, deduplicating the stable
source/event identity and checking that duplicate input agrees. Retain that proof
through the permitted retry horizon; retention must not allow an old delivery to
create a duplicate event or resurrect deleted evidence. Process death after sink
commit but before receipt acknowledgment must be safe. Source ordering and sink
ingest order remain distinct; Fabric does not provide a cross-database clock or
atomic transaction. Capture and display delayed delivery honestly.

Reuse the [durable source outbox and recovery boundary](../backend/database-automations/delivery.md)
where its semantics fit, but do not expose private automation tables or reuse
bounded terminal receipt retention as an eternal audit uniqueness guarantee.
Any missing synchronous capture/outbox contract is an explicit core deliverable.
An awaited audit write must never run inside a synchronous SQLite callback or
repeat the previous authority-lease/post-commit deadlock pattern.

Sensitive reads need durable audit admission before the protected response is
released, plus final authority revalidation. Record the observable stage: audit
admission may precede a disconnected client, and a streamed response can terminate
partway. Downloads, bulk exports, GraphQL/MCP and Sync subscriptions require their
own boundary definitions, not a generic middleware claim of complete coverage.

Bound queue bytes/records, event size, batch size, work concurrency, retry budgets
and shutdown drain. Diagnostics can have explicit drop accounting; required audit
admission must reject/backpressure or invoke a deliberately reviewed emergency
policy rather than silently drop. A disabled optional diagnostics stream must not
block login. A configured required audit guarantee may deliberately block a
protected action when admission is unavailable; show the exact reason and
recovery path, not a misleading credential error.

Sink failures must not recursively log themselves into the failing sink. Provide
bounded health counters and a content-free emergency signal. Console/external
adapters are controlled projections, not a competing canonical log database.
The audit append mechanism does not recursively audit its own internal writes;
human queries/exports of audit evidence remain auditable.

## Browser Activity Collection

Use one optional app-shell/provider collector with declarative record/document
bindings and opt-in action hooks. Compose router transitions, visibility/focus,
inactivity and supported component actions without attaching a second collector
per table row or altering existing keyboard/clipboard behavior.

View duration uses monotonic local intervals and bounded heartbeats. Store
observed visible and active intervals separately from wall-clock open duration.
Reconcile duplicate/reordered heartbeats, multi-tab sessions, sleep/resume,
offline gaps and missing close events. The server caps implausible durations and
marks unconfirmed tails incomplete; it cannot prove attention or offline actions.

Clipboard/print instrumentation observes only supported in-app/browser signals.
It is evidence collection, not copy prevention, DRM or OS surveillance. Required
server audit never depends on successful browser unload/beacon delivery. Client
buffers are bounded, scoped and retired on logout/tenant change; do not cache
sensitive event bodies in local storage by default. Server validation, size/rate
bounds and authority fencing apply to frontend ingestion like any public input.

## Core Integration and Facade

Keep operational emitters and stable `OBS_CODES`; adapt their sink to managed
storage instead of rewriting every subsystem's logger. Guardian's existing audit
retains its transaction and access guarantees. Bridge/migrate it using original
event identities and provenance, with checkpointed backfill and rollback. Do not
delete the old trail, double-count mirrored events or change `client.audit`
semantics as a side effect of enabling broader logging.

The proposed `zero.logging` facade owns structured emission and declared domain
activity; ordinary request use is actor/scope-bound. A separate trusted setup
boundary owns worker/storage configuration. The proposed `client.logging` query
facade uses Zero's normal authenticated transport and contains no raw store,
SQL, file selector or privilege to append authoritative server events. Preserve
`zero.observability` and existing sinks through deliberate compatibility adapters.
Do not add these names to public export catalogs before implementation.

Build a capture matrix for Guardian, managed endpoints/router, resources,
ReactiveDB/Fabric mutations, Sync, storage/signed downloads, Data/Storage Studio,
workflows/functions/triggers, messaging/email, payments, AI and machine transports.
Capture service actors, delegated initiators, retries and outcome transitions.
Do not copy mail/message bodies, payment credentials, prompts or retrieved
clinical content into logs simply because those services handle them.

App-owned raw SQL, custom routes, external services and semantic patient-record
views need explicit declared instrumentation. Publish covered/partially covered/
not instrumented states per surface. Database change history is not an enduring
activity audit, and a SELECT by itself does not identify which patient the user
saw. Reuse current error/observability, storage and notification boundaries for
health and review delivery without making notifications the audit store.

## Complete Subsystem Integration Map

The deliverable includes backend, client and operational ownership. A working
append command alone does not complete any preset's end-to-end coverage.

| Layer | Required implementation and boundaries |
| --- | --- |
| Configuration | Typed capture presets, per-category/resource overrides, deployment floors, metadata policy, retention, privacy, queue limits and readiness validation. Clearly define opt-in/default and runtime-setting precedence without disabling existing Guardian audit. |
| Managed server lifecycle | Register immutable log realms and their dedicated Fabric service planes, actor launch/credential allowlists and worker ownership. Validate before serving; clean up partial construction and drain intake before closing dependent databases. |
| ReactiveDB source transactions | Capture mutation evidence and a durable outbox entry atomically in each originating database. Track private-source writes correctly in file/hot modes. A post-commit listener alone cannot supply crash-safe capture. |
| Fabric storage | Separate operational/audit files and per-file writer ordering, WAL readers, bounded actor operations, stable event identity, restart and idempotent delivery. New tenant files must receive their declared capture contribution at admission, not after a first unaudited write. |
| Guardian and authority | Preserve the current audit and derive actor/tenant/service attribution from live trusted context. Revalidate protected reads, export delivery and streams; do not hold authority leases across asynchronous sink delivery. |
| Core service capture | Define exact events and outcomes for auth, routes/resources/Sync, storage, workflows, communications, payments and AI. Report declared custom-handler/raw-access gaps instead of claiming universal instrumentation. |
| Server facade | One structured logging/capture boundary with stable errors and complete promise outcomes; separate normal scoped request use from privileged setup and maintenance. App-only domain action helpers must not bypass metadata policy or forge server evidence. |
| HTTP and machine APIs | Validated bounded query/detail, field/filter capabilities, status, export/review/hold operations and write-only browser observations. Enforce live Guardian/API-key permission at each operation; expose no raw SQL, path or client-chosen actor/scope. |
| Realtime transport | Subscribe to committed changes in the dedicated log source through a scoped service projection. Carry source identity, sequence/epoch and snapshot watermark; reauthorize each delivery and recover history gaps with a fresh admitted baseline. |
| Client SDK | Use Zero's existing authenticated transport, refresh, cancellation and tenant-generation boundaries. Separate querying evidence from submitting untrusted browser observations; never bundle server/Fabric/SQLite or keys. |
| Browser collector | One lifecycle-owned collector, declarative record/document bindings, router visibility/idle intervals and explicit copy/print/action hooks. Bound buffers/heartbeats and retire old identity/scope state immediately. |
| React hooks and providers | SSR-safe, stable query/detail/live/export/collector state; one cache/query owner, cancellation, loading/error and scope masking. No component-created secondary auth or database clients. |
| Components | Self-wired workspace plus reusable DataTable, toolbar/filter, detail and review/status parts. Source rows stay server-filtered; private query values and safe field discovery use the same authority as the result. |
| Jobs and evidence | Durable export/review/hold/retention/integrity work, private Storage artifacts and optional notification/archival adapters. Retries and incomplete outcomes preserve their original identity and provenance. |
| Doctor and operations | Shared startup/config validation, actor/package readiness, capture gaps, queue/age/capacity health and precise recovery guidance. No misleading compliance certification or unaudited destructive repair commands. |

Backend queries must not join every tenant's live application database to render
the log list. Retain bounded attribution and target references in the log plane;
resolve permitted display labels through explicit scoped services. The worker may
deliver sources concurrently under bounded budgets, without claiming distributed
ownership across multiple independent servers sharing one local directory.

ReactiveDB's [committed subscriptions](../backend/reactive-db/subscriptions.md)
provide invalidation/wakeup hints; its [bounded change history](../backend/reactive-db/change-history.md)
is reconnect history, not the audit retention store. A lost hint cannot lose the
durably admitted event. A browser stream consumes authorized projections, not
the raw engine's `onChange` payload. Fresh snapshots, catchup and replay must not
be presented as new user actions or inflated new-record counts.

The lifecycle sequence is explicit: validate policy and schema/actors; open the
owned log planes; recover source/sink delivery state; attach capture before
protected application admission; publish route/stream readiness. Shutdown stops
new admissions, preserves or settles already admitted receipts, detaches collectors
and streams, drains bounded work and closes Fabric ownership in dependency order.
Early boot failures use the bounded safe fallback rather than silently losing
evidence or recursively starting a logger while it is being constructed.

## Access Privacy and Retention

Separate permissions for reading events, resolving sensitive identifiers,
exporting evidence, managing policy/retention, managing holds and recording a
review. Derive tenant scope server-side, enforce API-key/service ceilings and
recheck authority before response, stream batches, exports and downloads. A tenant
administrator is not automatically a cross-tenant auditor.

Logs can themselves expose sensitive relationships. Default to opaque resource
IDs and bounded metadata. Explicitly classify IP addresses, user agents, actor
labels, destinations, query values and changed fields; allowlist before persistence
and redact recursively. Never retain bearer/API-key secrets, session cookies,
MFA seeds/codes, raw clipboard contents or full before/after clinical records.
UI hiding is not field authorization. At-rest protection, key custody and network
security need actual deployment prerequisites and verification, not a checkbox
that claims SQLite is encrypted when it is not.

Retention is configured per stream/evidence class and applicable scope. Diagnostic
retention is not the compliance policy. Required-audit readiness needs an explicit
reviewed retention policy, archive/custody requirements where applicable and
bounded pruning that respects legal holds. Holds, releases and retention changes
are attributable events. Tenant closure/user deletion must not bypass a hold or
erase retained history. Exact defaults and allowed bounds are implementation
contract work; do not invent a universal six-year raw-log rule.

## Integrity Review and Evidence Export

Provide append-only application semantics with separately recorded corrections,
policy decisions and investigation notes. Do not edit an original event to mark
it reviewed. Versioned canonical serialization and per-stream integrity chains
can support verification; independent signed checkpoints/archives are needed for
stronger custody claims. A hash stored beside data in the same writable database
cannot by itself prove that a privileged operator did not rewrite the entire
history or truncate its tail. Address key rotation, restore and retained proofs.

Exports run as bounded scoped jobs with captured query/policy, snapshot or explicit
high-water semantics, event IDs, counts, format/schema versions and integrity
manifest. Deliver private artifacts through scoped Zero storage; authorize
creation and later download independently, record both, expire access and
mitigate spreadsheet-formula injection for CSV. Generating an export is not
confirmation that the reviewer received it or that all sources have caught up.

Support a lightweight review record containing reviewer, reviewed interval/query,
evidence watermark, result and follow-up reference. Do not claim that storing
logs proves anyone reviewed them. Any detection rules or alerts have their own
version, evidence and review status; they do not automatically declare a breach
or use a model's confidence as authorization. A full SIEM/GRC platform is not a
prerequisite for the first complete logging release.

## Investigation UI and Shared Filters

Deliver one self-wired logging workspace and composable table/toolbar/detail
parts. It adapts to enabled categories and permissions instead of requiring an
app to reconstruct authorization, fetching and realtime behavior. The simple
view can show a compact activity/error list; the compliance view adds evidence,
coverage, review, hold and export controls only when configured and authorized.

Use a dense DataTable with time, actor, action, target, outcome and evidence
strength; show tenant/source/session/correlation only when useful. Start with
search, date range, actor, action, outcome and resource filters; support nested
conditions and saved private investigations through the shared builder. Example
questions include who accessed a record, all copies/print requests by a user,
failed access attempts, changes during a session and incomplete viewing periods.
Opening a row uses existing managed detail surfaces, not a separate navigation
system. Keep IP/device metadata behind the relevant permission.

The [Filters integration plan](./filters-integration-plan.md) is still planned on
the inspected main baseline. Existing DataTable schema filters and Data Studio's
scalar control are not a shipped generic advanced builder. Qualifying the shared
filter family is an explicit UI dependency; do not invent working imports or
ship decorative advanced operators that the server cannot execute. Reuse the
planned typed grammar, editors, capability discovery and policy composition.

Use authenticated server queries over the log service, with an explicit
[DataTable custom adapter](../frontend/data-controls/data-table/server-sources.md)
and scoped change subscription. Do not expose internal tables through unrestricted
`/api/data` or download every event into the browser for filtering. User criteria
always narrow mandatory policy. Protect field/facet discovery, saved queries and
counts just like rows; sensitive filter values stay out of URLs and telemetry.

Keep stable cursor/snapshot semantics while an investigator reads older events.
Live insertions update an accurate new-event indicator; they do not blank the
table, replay first-load animation or jump the reader. Exact totals/progress are
optional and must come from the authorized query. Explain unknown totals and
indexing/ingestion lag honestly. Correlation views preserve per-source ordering
rather than inventing one cross-database timeline sequence.

Use Zero's current tokens, compact controls, magnetic option highlights, defined
popover/select motion, tooltips, managed dialogs/drawers and ScrollArea treatment.
Include accessible keyboard/touch behavior, narrow layouts, reduced motion,
long labels, safe empty/error states and signed-out/scope-replacement masking.
Avoid huge summary cards, raw payload dumps and a custom second table engine.

## HIPAA Focus and Deployment Responsibilities

The engineering profile supports recording and examination of relevant ePHI
system activity under [45 CFR 164.312(b)](https://www.ecfr.gov/current/title-45/subtitle-A/subchapter-C/part-164/subpart-C/section-164.312),
and documented ongoing activity review under
[45 CFR 164.308(a)(1)(ii)(D)](https://www.ecfr.gov/current/title-45/subtitle-A/subchapter-C/part-164/subpart-C/section-164.308).
Neither provision is a universal list requiring every browser interaction; the
deployment's risk assessment and approved policy determine its coverage.

[45 CFR 164.316(b)](https://www.ecfr.gov/current/title-45/subtitle-A/subchapter-C/part-164/subpart-C/section-164.316)
sets retention for required Security Rule documentation. Do not equate that
six-year documentation rule with one mandatory lifetime for every raw technical
event. Retention choices and required review evidence need deployment-specific
approval. HHS identifies compliance as an ongoing organization-specific process,
not a property established by installing software:
[HHS Security Rule guidance](https://www.hhs.gov/hipaa/for-professionals/faq/how-will-we-know-if-our-organization-and-our-systems-are-compliant-with-the-security-rule/index.html).

The [HHS Security Rule proposal](https://www.hhs.gov/hipaa/for-professionals/security/hipaa-security-rule-nprm/index.html)
is tracked separately from effective requirements. Recheck the effective rule
before the healthcare profile is released and have the control/evidence mapping
reviewed by qualified security/privacy specialists. Infrastructure custody,
backup/restore, contracts, workforce procedures and incident response remain
part of the deployment responsibility map. The package does not promise legal
certification, universal disclosure accounting or operating-system surveillance.

## Implementation Stages and Acceptance

The current branch's implemented contract is indexed under
[core logging](../backend/logging/index.md). It now includes pinned source
outboxes, Guardian mirroring, scoped APIs/SSE, a browser collector, an early
shared DataTable workspace and bounded evidence lifecycle operations. The
remaining strict-profile gates are recorded in its roadmap; these stage goals
must not be used to imply that every surface below is already instrumented.

### Required Browser Delivery at the Strict Level

Only the explicit highest/compliance policy requires successful authenticated
audit delivery before protected work continues. Basic, activity and detailed
collection do not lock an application because optional browser delivery fails;
enabling views, copy or print capture does not implicitly enable a gate.
Existing required server-audit admission remains independent of optional
browser delivery at every level.

If an extension, relevant site setting, proxy, offline connection or service
outage prevents acknowledgment,
pause the protected workflow and show a retry/recovery screen. Ask the user to
check blocking extensions for this application, relevant settings, connectivity
and service status. Do not present it as a dismissible informational toast.

Use a short server-backed admission bound to the current session, organization,
policy version and expiry. Enforcement must cover SSR/loader release, protected
HTTP/machine access, Sync/data subscriptions and the visible UI. A browser-only
overlay or a successful SSE connection is insufficient: SSE is server-to-client,
whereas observation delivery is an authenticated first-party HTTPS upload.
Test the case where downloads/SSE work but observation uploads are blocked.

Keep sign-in, health, the audit handshake and recovery available without making
a circular dependency. Resume protected work only after fresh server validation;
record the interruption/recovery without fabricating observations in the gap.
Non-browser integrations need an explicit transport-appropriate admission policy,
not an accidental bypass through an API key or native client.

There is no reliable browser API to identify every installed extension or prove
that all listeners ran. A healthy handshake is not browser integrity attestation.
Do not label a server/network failure as a specific ad blocker, request unrelated
permissions, read clipboard contents, or weaken server authorization. Source-side
access/release evidence remains necessary. Ordinary lower-level collection can
remain optional/best effort; the strict profile stays unavailable until all of
these fail-closed paths are implemented and qualified together.

### Delivery Stages

1. Lock configuration presets, event/provenance schema, coverage matrix and
   failure policy. Type and test domain contracts before adding UI-only switches.
2. Add dedicated Fabric log realms and worker lifecycle, durable source capture,
   idempotent ingestion, recovery, redaction and bounded health reporting. Keep
   existing Guardian audit working throughout the migration qualification.
3. Wire core services and browser collection with explicit coverage tests. Build
   the shared Filters dependency and an early styled workspace using synthetic
   events while backend contracts stabilize.
4. Finish scoped query/live APIs, filters, detail/correlation, export, reviews,
   retention/holds and integrity verification. Match advertised preset readiness
   to real configured capabilities and evidence.
5. Run production-like disposable load/crash/browser/package qualification,
   publish exact documentation and upgrade instructions, then separately approve
   merging/releasing and application adoption. Do not test on live patient data.

| Gate | Required evidence |
| --- | --- |
| Capture | Login outcomes, true committed changes/rollback, sensitive read/release stages, server tasks, declared copy/print/view actions and explicit instrumentation gaps. |
| Identity and privacy | Actor versus service/delegation, tenant and API-key ceilings, revocation during awaits/stream/export, malicious browser events, secret/clinical-content redaction and protected facet counts. |
| Durability | Crash before source commit, after source commit, after sink commit and before ack; exact replay, stale workers, source restart/clone identity, outbox pressure and no false success. |
| Fabric and performance | Multiple app DBs progress while logs ingest, no global writer lock/auth lease regression, bounded batches/queues/IPC, read/write overlap, full disk, worker SIGKILL and controlled drain. Measure cost at each preset with realistic row sizes and rates. |
| Browser truth | Multiple tabs, hidden/idle/sleep/offline intervals, duplicate/reordered/missing heartbeats, logout/scope replacement, blocked clipboard, cancelled print and absent unload. Never claim attention or physical print proof. |
| Evidence lifecycle | Integrity/tail/restore checks, key rotation, holds versus prune, corrections/reviews as separate records, resumable exports, permission loss and retention without duplicate resurrection. |
| UI | Styled light/dark mobile/desktop, filters and execution parity, keyboard/touch/reduced motion, stale queries, safe detail masking, no blank-table reload on live arrival and no full-dataset client download. |
| Upgrade | Guardian event/SDK/viewer compatibility, deliberate deduplicated bridge/backfill, existing log sinks, no source DB deletion and independently verified rollback. |
| Distribution | Fresh installed core imports, browser/server dependency isolation, actor bootstrap and configurable single/multi-tenant apps; no separate logging-plugin installation step. |

## Documentation and Doctor Deliverables

The implementation gets a canonical backend logging index, configuration,
events/provenance, coverage, durable delivery, activity collector, query/export,
retention/integrity, operations and roadmap guides. Frontend manuals cover the
workspace/table/filters/detail components and headless hooks. Document exact
defaults, permission requirements, failure semantics and capture limitations.
These paths are future deliverables, not links to nonexistent APIs.

Doctor/startup checks should share configuration validation and report required
coverage gaps, unsupported transports, unsafe raw access, missing realm/actor
registration, privacy-policy conflicts and inadequate required-audit durability.
They cannot prove a production application is legally compliant from static
imports or automatically understand the semantics of an arbitrary patient page.
Runtime readiness reports backlog/age, required-admission availability,
retention/hold state, last integrity verification and incomplete source coverage
without leaking event bodies. Missing requirements must never show a green
compliance badge just because a database opened.

## Related Guides and Next Steps

- [Current observability](../backend/observability/index.md) owns the existing
  event/sink compatibility boundary and operational diagnostics.
- [Guardian audit](../backend/guardian/audit.md) owns today's security event,
  query, retention and access guarantees that the transition must preserve.
- [Fabric operations](../backend/fabric/operations.md) and
  [consistency](../backend/fabric/consistency.md) define bounded actor queries,
  writes and source-specific sequence semantics.
- [Durable delivery](../backend/database-automations/delivery.md) supplies the
  existing source/outbox/recovery foundation, not a prebuilt logging feature.
- [Filters plan](./filters-integration-plan.md) and
  [DataTable](../frontend/data-controls/data-table/index.md) own the shared UI
  and query contracts the investigation workspace must compose.
- [Core platform roadmap](../../docs/platform-roadmap.md) records the product
  boundary; this plan owns the proposed integrated logging implementation.
