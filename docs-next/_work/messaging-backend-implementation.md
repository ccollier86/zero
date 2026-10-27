---
id: zero.work.messaging-backend-implementation
type: roadmap
audience: [developer, agent, maintainer]
owner: messaging
status: draft
visibility: internal
system: messaging
feature: durable-messaging
maturity: experimental
applies_to: ["feature/messaging-backend; not a selected stable update"]
---

# Durable messaging implementation checkpoint

[Working index](./index.md) · [Messaging architecture](../backend/messaging/index.md)

Finish and qualify publishing first, then the native logging investigation UI,
then this subsystem. Worktrees isolate their release candidates. No production
application, database, migration or deployment is changed by these fixtures.

## Implemented private persistence slice

`src/messaging/realm.ts` is a side-effect-free named Fabric realm. Its dedicated
actor entry imports no application configuration. Closed tracked commands own
conversations, bounded membership, accepted contact requests, independently
owned blocks, monotonic read positions, messages, revisions/tombstones, reactions,
support claims and ownership epochs. Durable intent receipts outlive transport
receipt retention. Every read/write rechecks canonical membership; server-issued
authority will be bound by the managed service, never copied from HTTP input.

History uses keyset pagination and indexed reads. Public and staff search have
different FTS indexes. Private notes do not advance a customer's visible sequence,
last activity, preview or unread state. Global support authority is not private
conversation membership; an explicit successful support claim adds membership
and fences the old ownership epoch in the same transaction.

The real-file/WAL actor suite initially passed five scenarios / 44 assertions,
including concurrent insertion, restart, replay with a new transport key,
conflicting intent, contacts/blocks, cross-scope admission, history boundaries,
author-only editing, reactions, removal, competing staff claims, and private-note
non-disclosure, plus content-free receipt recovery after membership removal.
This is not Guardian, browser, attachment, provider or deployment
qualification and does not make the unfinished API available to applications.

## Managed foundation checkpoint

Opt-in configuration, guarded SYSTEM owner receipts, per-scope file recovery,
native HTTP, request-scoped backend facade, SDK boundaries, bounded SSE and a
safe current-organization directory are implemented. Native integration and
retained-file tests pass six scenarios / 37 assertions, including strict audit
admission, accepted replay/reactions, monotonic read positions, safe retained
transaction evidence, source restart and scope-local invalidations. An additional
producer test qualifies exact transport replay after audit acknowledgments.
The managed native gate caught and helped reproduce the core FIFO async-context
bug; its repair lives in the independent blog/logging release branch as well.

Reserved typing now has a canonical membership adapter and a separate staff-note
topic; native consent scopes and a dedicated hook are present but still need
actual socket/browser qualification. The latest full root typecheck passes.
This is a committed development foundation, **not full messaging completion or
a selected stable update**. Attachment I/O, worker/Torrent/AI/provider dispatch,
customer/channel ingress, notification and final UI/deployment gates remain.

## Private attachment implementation in progress

The next slice adds typed allocation/upload/association/download/remove methods
under the same Guardian/SDK facade. Fabric owns conversation/history admission,
declared integrity, visibility, bounded per-actor reservations and the immutable
message association. Existing Storage private CAS artifacts own bytes: there is
no generic drive, object grant, public URL or browser-selected namespace. The
trusted streamed-artifact extension keeps the existing small `put()` ceiling
unchanged and caps streamed declarations at 256 MiB; messaging defaults to 16 MiB.
Each attachment's exact checksum and length are checked before private-byte
publication. Declared MIME is not a malware/content-verification verdict.

Native binary downloads are attachment-only with `nosniff`, sandbox/CSP and no-store;
the stream rechecks canonical membership/history before releasing each chunk.
SDK download additionally verifies length and SHA-256. Unattached stages are
owner-only and expire after 30 minutes. Allocation reserves at most ten stages
per actor/scope; association and reservation release are one commit. Removal and
expiry fence against association before deleting bytes. Lease recovery is bounded
and wakes at actual expiry rather than polling an empty queue. Tombstoned-message
bytes are retained, not automatically or securely erased. No aggregate namespace
quota or malware scanner is claimed by this slice.

Core migration `050` and private realm migration `002` are additive; committed
`049` and private `001` remain unchanged. Byte I/O uses a short durable lease,
never a SQLite transaction or auth-exclusive lock across network work. Shutdown
cancels owned uploads/downloads; cleanup preserves uncertain/quarantined stages.

The initial native run catches a missing HTTP projection for Fabric's changed
idempotency-key conflict. The safe specific 409 mapping and the complete native
attachment scenario now pass. The five-file follow-up passes all 22 scenarios /
152 assertions: four managed native cases (47 assertions), five private Storage
cases (37), attachment/HTTP validation (31), and nine presentation cases (37).
Actual upload/delivery, immutable association, membership revocation, retained
restart, strict admission and live inserts are exercised, not mocked completion.
The full root typecheck also passes. This is a development slice, **not an
installed/Linux/browser-qualified messaging release**.

Further review found that Fabric's exact transport cache can bypass a replayed
command handler. An old acknowledgment therefore cannot be used as continuing
permission to read its retained body. Sends/edits/removals and attachment stage
projections now re-read under current canonical membership/history; a removed or
since-join-readmitted member gets no old body, but can reconcile the content-free
receipt. A send replay after deletion projects the current tombstone instead of
resurrecting cached text. An actual native regression for those three boundaries
passes through the actual native facade. Native attachment presentation composes the
existing bubble renderer with typed domain references, without changing the old
Storage-backed bubble contract or fabricating private drive/path coordinates.
Private Storage also rejects yielded authorization callbacks before provider I/O
and within publication transactions. Owned attachment readers are cancelled when
their task/stream retires, including early provider-admission failures; unrelated
request controllers are not aborted.

## Remaining release work

- [ ] Managed configuration, private root/realm ownership and missing-file
  recovery; source/bundle worker launch with an explicit empty environment.
- [ ] Guardian/current-authority request and machine facades, native scopes,
  transport limits, HTTP/SDK/hooks, SSE revalidation and real UI/controller wiring.
- [ ] Directory discovery and bounded contacts; receipt reconciliation without
  regranting removed membership or disclosing retained message bodies.
- [ ] Private Storage stage/upload/finalize/attach/download and orphan recovery.
- [ ] Detailed typing bound to canonical membership, not a delayed room shadow.
- [ ] Short durable job starts, independent Torrent/provider concurrency,
  current BYOK/model rules, assistant epoch fences and private-note exclusion.
- [ ] Notifications and verified Messenger ingress/outbox; unknown sends retain
  their identity and require reconciliation rather than automatic duplicate sends.
- [ ] Native workspace live history/backfill, scroll anchoring, takeover,
  keyboard/touch/reduced-motion and actual installed Linux/browser acceptance.
- [ ] Documentation, full review, normal qualified archive/update release.

## Durable jobs implementation in progress (not qualified)

The current branch slice implements private realm `003`, a fixed versioned
Torrent activity, bounded short idempotent starts, and a 100-slot default I/O
pool (`jobs.concurrency` can reduce it; `max` selects the supported maximum).
The core slice passes root typecheck, pool/config/wire validation and private
native job-protocol checks. Do not activate or advertise it as a supported
release: the complete backend and installed deployment qualification are still
unfinished.

Public-turn/context revisions and ownership epochs fence generation and final
publication. A newer customer turn, public edit/removal, or human takeover makes
the old result ineligible; private notes do not enter or invalidate the model's
public context. Provider admission is durable before invocation. A saved private
result can resume finalization; an uncertain call is retained for review rather
than automatically generated again. Invocation attempts are separate facts, not
overwritten by a later attempt. Current native user/organization eligibility is
checked before model use and publication. AI requests go through the real Zero
AI gateway with provider-stage logging and zero automatic provider retries; the
bounded recent-context default has no attachment reading, tool execution or RAG.

Managed composition now prepares Storage/private messaging before Torrent
recovery, registers the fixed activity before recovery, starts new dispatch
after publication, and drains Torrent before closing its providers. The fixed
activity remains registered when generation is disabled so retained work can
reconcile instead of vanishing from the registry. Its handler requires a sealed
system principal; an ordinary actor/admin HTTP start cannot invoke it. Workflow
input/output contain only opaque job IDs and safe states, never transcript or
generated text. The managed bundler preserves source migration identities for
the matching retained source actors, just as it does for Logging and Blog.

The current worker still sends notification/channel jobs to explicit review;
those delivery integrations, the operator resolution facade, Portal/Messenger
ingress, native controller/workspace, socket/browser and installed Linux proofs
remain unfinished. The canonical bundled-realm regression has been added and
still needs execution; a same-source native pass is not a source-to-bundle proof.

Focused evidence is retained under the normal external `blog-publishing`
diagnostics directory. `messaging-jobs-focused.log` passes four files, including
four actual-file protocol scenarios (saved-result restart, uncertain invocation,
policy change and stale-turn/takeover fences) plus the pool and capability
validation. `messaging-jobs-managed.log` passes all five managed scenarios / 59
assertions. Its new loopback HTTP provider test uses the actual Zero AI gateway,
Torrent, Guardian and private messaging/logging actors: two held calls enter
concurrently, the second finishes while the first is held, foreground reads and
accepted sends finish without waiting, and human takeover excludes the old
reply. Provider completion retains its trusted origin/evidence and neither
logs nor workflow records contain transcript, generated text or provider keys.
All identities, messages, files and provider requests are synthetic and local.

## Fixed integration decisions

Use a dedicated private Fabric root. Single tenancy owns one messaging database;
multi tenancy owns a canonical database per admitted organization, enabling
independent writer concurrency and correct fixed-scope transactional audit
sources. Do not put all tenants in an application-scope audit source or project
memberships into an eventually-consistent authorization substitute. SYSTEM keeps
only owner/namespace receipts; Storage owns bytes and logging retains safe audit
metadata through its existing dedicated workers.

No long AI/provider call runs in a database automation handler or SQLite commit.
Accepted messages and their deterministic jobs commit together. Source handlers
acknowledge durable starts quickly; Torrent/work pools execute network work
independently. Check ownership before generation/publication and dispatch; an
already accepted remote request cannot be retroactively unsent.

No private message text, notes, upload capabilities, credentials, customer contact
details, prompts or responses belong in operational/audit metadata. Optional
public widget admission must mint an expiring connection-bound customer session;
the browser cannot select a tenant, external identity or staff role.

## Next orchestration boundary (reviewed, not implemented)

The existing Torrent registry finishes activity registration before recovery.
Currently platform composition recovers workflows before mounting messaging;
simply registering a late handler is not sufficient. The jobs slice must split
service readiness from dispatch readiness: register fixed versioned messaging
activities before recovery, initialize Guardian/Storage/private messaging before
allowing their recovered activities to run, and start source dispatch only after
Torrent publishes its service. Never introduce a circular initializer wait.
Shutdown must drain Torrent's activities before closing their messaging owners.

Use `enqueueAsSystemOnce()` for the short permanent source effect receipt, with
only an opaque job identity in workflow input/output. A MAC-verified execution
scope selects the realm; there is no HTTP tenant/principal selector. Message text,
notes, credentials and generated replies must not enter Sync-visible workflow
instance/step input/output. An activity loads its bounded private context only
when executing. Provider work does not hold a source automation queue or SQL lock.

The durable job protocol must distinguish pending, claimed, calling, received,
accepted, cancelled and needs-review facts. Persist the invocation boundary before
a non-idempotent network call. After a crash, a possibly executed send/generation
cannot become an automatic fresh provider call. Reconcile a known provider/run
identity or send it to review. A received assistant result belongs in private
Fabric state until the final reply/ownership transaction; never return its body
as a workflow step result. Provider acceptance is not customer delivery or human
attention. Use the existing actual AI/provider stage instrumentation.

Independent conversations execute concurrently. A bounded configurable work pool
must not default to one global serial lane. Newer customer turns supersede old
assistant work in the same conversation; takeover advances the canonical owner
epoch and requests cooperative cancellation, while the final publication fence
remains authoritative even if cancellation is ignored. Check both the owner epoch
and latest customer-turn identity before generation/publication/dispatch. Private
notes never enter default assistant context or customer/channel/notification jobs.

Notifications use the existing native service and an atomic SYSTEM effect receipt
for duplicate safety. They target only current eligible recipients and declared
preferences, not the whole organization. Keep their retained payload generic and
content-free so a later conversation-membership removal does not leave transcript
previews in another service. Clicking a notification still needs current canonical
conversation authorization. Notification receipts and transcript read positions
are distinct facts.

Public widget and Messenger adapters come after these durable boundaries. Widget
admission must bind an expiring server-issued customer session to a configured
connection/scope/conversation, not accept an existing identity from browser input.
Messenger requires current official provider-contract verification, raw-body
signature checks, connection-bound page/customer mapping, permanent event dedup,
a real outbox, provider-ack reconciliation and truthful policy/capability failures.
No real providers or production connections may be used by qualification tests.

Reactive invalidations now use a canonical private sideband computed inside the
accepted writer command. Before/after membership includes removed participants;
only canonical staff participants receive private-note hints. The parent strips
that metadata from the public acknowledgment, targets actor/conversation readers,
and treats malformed advisory metadata as revalidation rather than a new row fact.
Internal audit acknowledgments no longer wake public readers. Exact transport
replay is not announced as a new mutation. Existing coalescing, one-packet
backpressure, fresh projection authorization and periodic authority checks remain.
The native follow-up passes all ten cases, including 100 distinct conversations,
unrelated-reader isolation, removal invalidation, private-note non-disclosure and
the full Guardian/attachment/restart/strict-admission scenarios. Root typecheck
passes. This still requires installed/browser/deployment qualification, not a
claim that any commit hint proves delivery or human attention.
