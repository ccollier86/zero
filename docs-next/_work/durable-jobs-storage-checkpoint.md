---
id: zero.work.durable-jobs-storage-checkpoint
type: reference
audience: [developer, agent]
owner: scheduler
status: draft
implementation_state: in-progress
visibility: internal
system: scheduler
feature: durable-jobs-and-workers
maturity: planned
applies_to: ["feature/core-worker-runtime-upgrades; private implementation, not a published API"]
---

# Durable Jobs — Private Storage Checkpoint

[Working evidence](./index.md) · [Full execution plan](./durable-jobs-and-workers-plan.md)

Calendar backend work remains paused. This is an implementation/review record,
not a configuration recipe for a consuming app or a claim of updater readiness.

## Implemented Boundaries

- `src/jobs/definition.ts`: pure code-owned, explicitly versioned contracts,
  exact registered references, detached canonical input, default administrator
  access, fixed workflow version and opt-in service eligibility. A fingerprint
  covers portable metadata, not parser executable integrity; bump the code-owned
  version whenever parser/policy behavior changes. Service policy is deliberate
  at creation, not fallback after actor expiry. Guardian compilation and actual
  execution still need the managed adapter.
  Multiple retained versions can coexist; exactly one explicit default is used
  for name-only admission. Changing the default alone does not rewrite an old
  version's fingerprint. Missing old code blocks recovery rather than executing
  the new version in its place.
- `src/jobs/realm.ts`: fixed private Fabric schema/commands/queries. Import starts
  no app, actor, database, cron timer or provider. The dedicated actor imports only
  that realm and the native Fabric bootstrap with an explicit empty child env.
- `src/jobs/runtime.ts`: scope-bound files, SYSTEM ownership catalog, FULL/WAL
  writes/readers, current-authority fences, shutdown drain and content-free
  revalidation hints. Inputs/seals are never public list/view fields. Missing
  established files or changed roots fail closed for recovery, not replacement.
- `src/jobs/persistence-config.ts`: private composition helper only. There is
  still no enabled managed `AppConfig.jobs` or public `zero.jobs` in this checkpoint.

## Private Records And Ownership

`job_schedules` stores human control/provenance/revision metadata. `_jobs_*`
records store the immutable generation, validated private input, domain-bound
authority seal, cursor, occurrence/claim, permanent intent receipt and budgets.
SYSTEM `_jobs_owners` identifies scope, root, realm and established owner; it
does not hold job bodies. One trusted scope owns one private Fabric file.

SQL protects immutable owner/admission/intent/dispatch evidence and occurrence
identity; commands also verify the current bound scope. Numeric revisions and
claim generations advance monotonically. Command domain failures throw through
the actor transaction, so failed quota/revision/validation checks roll back all
preceding changes. A returned error envelope after mutation would be unsafe.
INSERT guards also reject `OR REPLACE` replacement of retained identities,
including alternate unique generation/occurrence keys; immutability does not
depend on SQLite's optional recursive-delete-trigger setting. This is native
state integrity, not a claim of independent custody against an OS administrator.

Permanent logical intents outlive Fabric transport receipts. Replay returns the
original accepted result, not the current edited schedule, and does not repeat
mutations or live hints. New transport keys do not evade logical deduplication.
Current authority must be checked before any replay is delivered.

Initial explicit per-file capacities: 10000 schedules, 1000 schedules per owner,
100000 permanent control intents and 100000 occurrences. Exhaustion rejects
new admission atomically; existing identities remain reconcilable. This is **not
indefinite recurring capacity**. The full plan's Torrent receipt-capacity issue
still needs a truthful operator contract; never delete receipts or rotate
principals to evade it.

## Timing And Handoff Semantics

Nominal occurrence identity binds schedule/generation/resolved instant. Due
selection and cursor advancement commit atomically. Catch-up is age/count bounded,
not unlimited pages of historical work. Explicit timezone/DST rules are in
`schedule-time.ts`; calendar RRULE remains a different domain.

Overlap `skip` consults active work across generations. `allow` admits independent
claims. `queue-one` retains only the newest pending occurrence, marking older
not-started ones superseded; an active queue-one schedule does not monopolize the
pending dispatch page. Pending work past its maximum lateness expires without a
new effect. An already claimed uncertain handoff still requires reconciliation.

A stale claim is not proof no workflow started. It can be re-leased with the
same occurrence identity even after pause/cancel/readmission, but new dispatch
is not permitted for retired/expired work. The broker **must look up the original
permanent Torrent receipt before any enqueue**, then persist that exact receipt.
No input/seal/nonce is broadcast. Provider delivery and workflow completion are
separate outcomes; the dispatch receipt claims neither.

The private SQL actor does not verify the Torrent MAC itself and cannot authorize
execution from a caller-supplied seal. The pending managed bridge must use the
existing SYSTEM authority store, bind the seal to admission digest + generation,
verify the original pin and live Guardian/service eligibility, and fence against
Torrent runtime-owner replacement. Do not expose these private commands to HTTP
or client Sync. Raw actor-API tests are not Guardian admission tests.

## Live Views Without Poll/Audit Feedback

Command sidebands compare before/after public state. Transport or logical replay,
idle reads, no-op pause and lease-only renewal do not fabricate public changes.
Runtime fanout is payload-free, owner/schedule/scope filtered and coalesced; the
eventual native adapter must reauthorize and requery before publishing a view.
An advisory hint is not proof of authorization or successful business execution.

Canonical semantic logging/source-outbox integration is **not implemented here**.
Do not claim profile/control coverage merely because a row changed, or log every
tick/claim/heartbeat. The full execution plan still requires those service-stage
contracts and their managed tests.

## Evidence And Next Gate

Initial model/time checks: 13 passing. First private realm pass: 17 passing.
Adding content-free hints exposed one test expecting the entire private advisory
envelope to replay; the accepted value was correct and no repeat hint was the
intended behavior. The corrected test asserts both separately. The expanded
private runtime/local scheduler/Torrent-owner group then passed **45 tests in
10 files, 300 assertions** on Bun 1.4.4, with focused strict types passing.
Later additions receive separate checks; this is not full final-package evidence.
The final private-jobs source pass completed **27 tests / six files / 215
assertions**, including definition/default/version policies, rejected async
parsers, pure launch admission, late-work expiry and cross-generation overlap.
The documentation structural gate checks 889 pages/IDs: all reachable, no
metadata/link problems after repairing the related working-page metadata and
two missing audit-index backlinks. No qualification status was promoted.
Strict typechecking of the complete changed private jobs/local-scheduler/managed
composition set passes. The final replacement-guard check passes on the real
actor (one test, 35 assertions), and the final pure-definition/model/launch and
local-lifecycle recheck passes 14 tests / 108 assertions. These groups overlap;
do not add their totals into an invented full-suite count.

Fixtures use exact synthetic ownership markers, close actor/coordinator/SQLite
handles first, and remove their roots in finally. No production/app state is
opened. Final Linux/amd64, bundle, installed public facade, browser-if-UI and normal
updater qualification remain pending, as listed in the main plan.

Next: integrate fixed definition admission and cryptographic Guardian/Torrent
handoff, then managed optional config/lifecycle, native HTTP/SDK/live projection,
semantic service adapters and the operator view. Do not restart calendar backend
work or publish this private checkpoint as a finished scheduling feature.

Specific next-boundary checks from source review:

- Existing `getActorStartReceipt()` deliberately requires the original actor's
  live credential/authority. It is not enough for privileged recovery of an
  already accepted handoff after revocation. Add a narrow **read-only** internal
  receipt reconciliation boundary verified against the retained sealed identity,
  scope and runtime-owner fence; do not weaken the public actor lookup or let
  reconciliation start work. An absent receipt plus retired authority must block.
- Recheck the exact definition/version IDs and fingerprint at handoff. A numeric
  version alone must not accidentally select a newly shadowing tenant namespace.
- Bind the existing SYSTEM authority MAC to the admission digest **and** generation;
  a copied seal cannot grant another schedule/generation/scope execution rights.
- Current managed SYSTEM/API-key worker projections intentionally remain denied.
  Review explicit service/machine task capabilities rather than removing those
  guards or manufacturing a user/admin context for scheduled service work.
- Tie background scheduling to Torrent's durable runtime-owner generation and
  serialize only the short per-schedule control/handoff decision. Never retain
  Fabric/Guardian commit leases across pool admission or Torrent/provider awaits.
