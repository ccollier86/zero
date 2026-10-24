---
id: zero.logging-foundation-review
type: operations
audience: [developer, agent, maintainer, operator]
owner: observability
status: in-review
visibility: internal
---

# Logging Foundation Branch Review

[Working index](./index.md) · [Complete subsystem plan](./logging-system-plan.md)

The `feature/core-logging` branch contains the managed storage foundation and
the subsequent capture/API/browser/workspace/evidence implementation. It is based on main
`e3809f4a94fc53b0168246128c844806a6757513`; the initial foundation commit is
`cc3b54383fc11497dda0b5c3a6cc04c09a936c8e`. Branch-only
`createApp({ logging })` owns startup/shutdown, backend diagnostics, durable
source contributions and optional browser collection. Guardian's existing audit
and saved releases remain unchanged; `zero.logging` and `client.logging` are additive.
The [logging reference](../backend/logging/index.md) describes this preview.

## Implemented Foundation

| Responsibility | Source and behavior |
| --- | --- |
| Data contract | `src/logging/logging-contracts.ts`: browser-safe envelopes, scope, actor/service provenance, outcomes, event receipt and bounded query/page shapes. |
| Configuration | `logging-config.ts`: basic/activity/detailed/compliance capture presets, granular families, independent diagnostic severity and bounded writer limits. Compliance starts with activity coverage; view/copy/print observations require explicit policy selection. A compliance request is not a readiness assertion. |
| Admission | `logging-validation.ts`: descriptor-safe snapshots, no getter/proxy evaluation, strict envelope identities/types, explicit metadata allowlists and secret/content-key rejection. Browser observations cannot claim server/provider confirmation. |
| Storage | `logging-schema.ts`, `logging-realm.ts`: separate file bindings for audit/operational streams; registered synchronous Fabric commands/queries over tracked ReactiveDB. Indexes support scoped, actor, target and time investigations. |
| Replay | Stable source/event identity and content fingerprint prevent duplicate rows after regrouping/restart. A changed body under the same event identity rejects the complete batch. Fabric command receipts are an additional, not sole, deduplication mechanism. |
| Queries | `logging-query.ts`, `logging-results.ts`: mandatory scope predicates, static column vocabulary, bound values, source-local high-water/keyset pagination, revalidated envelopes, scope and cursor state. |
| Delivery | `logging-fabric-store.ts`, `logging-writer.ts`: acknowledgments only after actor commit, outstanding record/byte capacity accounting, batching within Fabric payload limits, unknown-outcome preservation and joined flush/shutdown drain even when an earlier batch fails. |
| Managed ownership | `logging-managed-config.ts`, `logging-runtime.ts`, `app-logging.ts`: opt-in creation, fixed realm/actor bootstrap, pre-publication probes, partial-failure cleanup, app-local runtime publication and joined shutdown. Compliance requests reject until ready. |
| Path safety | `logging-directory-isolation.ts`, `app-logging-isolation.ts`: lexical configuration and canonical build/startup checks protect app/control files, other Fabric roots, public/private artifacts and storage-owned paths before mutation. |
| Diagnostics | `logging-observability-bridge.ts`: snapshots backend code/severity/time/category without message/error/arbitrary metadata; preserves existing sinks, uses distinct app-lifetime identities and a pre-bridge fallback to prevent recursive self-logging. |

The storage port accepts an already-bound private Fabric client. Integration
tests launch actual subprocess actors with FULL file durability and separate
audit/operational files. There is no in-memory storage substitute in those tests.
The batching owner is asynchronous; Fabric's existing subprocesses own SQLite
execution and their bounded operation deadlines.

## Earlier Managed Milestone Verification

```sh
TMPDIR=/Volumes/code-bank/tmp/scratch/zero-platform bun --no-env-file test \
  src/logging src/frontend/server/app-logging.integration.test.ts \
  src/databases/database-coordinator-subprocess.integration.test.ts \
  src/frontend/server/database-topology-config.test.ts \
  src/frontend/server/system-database-config.test.ts
TMPDIR=/Volumes/code-bank/tmp/scratch/zero-platform bun --no-env-file test \
  src/frontend/server/app-runtime-isolation.integration.test.ts \
  src/frontend/server/app-shutdown-order.integration.test.ts \
  src/frontend/server/auth-hot-admission.integration.test.ts
bun --no-env-file x tsc --noEmit
bun --no-env-file docs-next/_work/checks/check.ts
```

The managed milestone run passes 70 tests across logging, createApp, existing
Fabric subprocesses and database configuration. It checks real restart/isolation, conflicting-batch atomicity,
deduplication after acknowledgment loss, large-event batching/page limits,
scope/cursor corruption, browser contract bundling, policy validation and worker
admission/drain outcomes. Added checks cover managed construction failure,
independent app sinks, final extension events, backend diagnostic privacy,
backpressure reporting and restart identity. Diagnostics use the external project's
`diagnostics/logging-*` artifacts, synthetic inputs and disposable databases.
The root TypeScript check passes. Documentation navigation and metadata are
checked separately from implementation/release readiness: 822 reachable/unique
pages, no problems. Four existing hot-auth, app-isolation and shutdown regression
tests also pass, for 74 tests across the two focused runs.

The subsequent [enqueue review](./automation-torrent-enqueue-review.md) adds an
installed-source-package smoke test that starts the real packaged logging actor
through `createApp({ logging })`. This verifies default source packaging, not
compiled/custom actor launches or complete compliance release readiness.

Initial construction exposed two integration mistakes that are corrected:
realm migrations execute before table registration, so the logging migration
establishes the same fixed tables before creating indexes; Fabric named command
responses wrap their domain output, so the adapter validates and unwraps that
envelope before acknowledging events. These are branch-local implementation
corrections, not changes to Fabric or consuming apps.

## Current Integration Verification

Implementation source commit:
`af5554b750affc48645889debf3680bee29c2ef5`.
The broad qualification run passes 301 tests across 27 files, covering the
logging contracts/actors/queues, managed capture and SSE, existing Guardian
audit, request authority, ReactiveDB, Doctor, export boundaries, isolated app
ownership/shutdown and populated hot-mode login/refresh/protected reads.
Ten focused interceptor tests additionally qualify independent core
contributions without replacing the application's sole interceptor.

The real Chromium workspace test passes: cursor pagination, preserved row DOM
on committed arrivals, managed evidence dialogs, light/dark narrow layout and
scope replacement. Screenshots use synthetic evidence and external diagnostic
storage, not repository assets or live app data. The package smoke test installs
an actual archive into a fresh consumer, boots the default source actors,
exercises Guardian/query/SSE, verifies the new packaged manuals and builds the
focused public browser component/contracts without SQLite or the origin outbox.

The root TypeScript check passes. The documentation authoring check reports
828 reachable pages/unique IDs and no problems. These are implementation and
navigation checks, not legal certification, independent custody qualification,
compiled deployment proof or authorization to update a live application.

Focused commands include:

```sh
TMPDIR=/Volumes/code-bank/tmp/scratch/zero-platform bun --no-env-file test \
  src/logging src/frontend/client/logging-client.test.ts \
  src/frontend/client/logging-collector.test.ts \
  src/frontend/server/app-logging.integration.test.ts \
  src/frontend/server/app-logging-api.integration.test.ts \
  src/auth/auth-audit-service.test.ts src/auth/auth-audit.integration.test.ts \
  src/sync/reactive-db.test.ts src/sync/reactive-db-mutation-interceptor.test.ts
TMPDIR=/Volumes/code-bank/tmp/scratch/zero-platform bun --no-env-file test \
  src/components/logging/logging.browser.test.ts \
  src/frontend/server/database-automation-torrent.package.test.ts
bun --no-env-file x tsc --noEmit
bun --no-env-file docs-next/_work/checks/check.ts
```

One existing export-contract test had not registered previously approved drawer,
mail and messaging additions. The correction admits only their exact additive
declarations, plus the new logging declarations, while retaining the original
contract digest and type/symbol identity checks. It does not rebaseline away old
exports.

## Remaining Integration Gates

The following are now implemented: scoped request/background capture; atomic
application/Guardian source outboxes; guarded query/platform query APIs;
authenticated SSE with revocation; generation-bound client collection and hooks;
shared DataTable/filter/detail composition; explicit retention; atomic holds and
reviews; retained replay/integrity proofs; bounded NDJSON export; and Doctor
coverage findings. The private store remains unavailable through request JSON.

Remaining gates are independent tenant-actor capture and full service coverage;
required-browser-delivery admission across UI/SSR/HTTP/Sync; advanced/saved
Filters and evidence management UI; durable private-Storage export jobs and
download reauthorization; independent checkpoint custody/signing/rotation;
full-disk/SIGKILL/load and compiled actor qualification. The strict preset is
still rejected rather than mislabeled ready.

Application interfaces must use the authorized facade, not the private
runtime/store. Existing main and saved update packages
remain unchanged; this preview is not an upgrade-ready complete logging release.
