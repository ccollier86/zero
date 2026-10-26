---
id: zero.logging-compliance-qualification
type: operations
audience: [agent, developer, maintainer, operator]
owner: observability
status: draft
visibility: internal
---

# Strict Logging Qualification

[Working evidence](./index.md) · [Logging plan](./logging-system-plan.md) · [Logging reference](../backend/logging/index.md)

This work starts from main `fc61dcc4cd107c6467bff498d3a772e8f5bdea9d`
on `fix/logging-compliance-qualified`. Blog author/profile work is excluded.
PracticeIQ is an integration reference only; its files, data and deployment
have not been modified. The earlier staging identity below is historical;
normal updater selection is established by `zero-release --status` and its
verified release metadata. Final package checks precede selection; an
intermediate source pack is not a release.

## Required Controls And Actual Boundaries

The old unconditional `LOGGING_NOT_READY` rejection is replaced by strict
configuration/source checks and integrated runtime readiness, not an alias
for `detailed`. These controls are implemented together:

| Gate | Implemented contract |
| --- | --- |
| Capture | Same-source-transaction Guardian/ReactiveDB outboxes; strict HTTP admitted/prepared/stream stages; managed AI and email provider stages. Domain reads, raw SQL, custom SDKs and other semantic service outcomes require declared app instrumentation. No patient text, contacts, raw URLs, tokens, prompts or provider bodies enter automatic evidence. |
| Admission | Durable authenticated acknowledgments bound to current session/scope/authority/policy, default 60-second server expiry; protected UI, SSR, HTTP, machine and Sync enforcement. Sign-in, health, handshake and fixed empty same-origin cookie recovery remain reachable. Lower presets remain optional. |
| Evidence | Private durable Storage artifacts, auditable job transitions, fresh download authorization, expiry/reconciliation, 128 live reservations/four materializations, bounded artifact bytes and stable composite-key history pagination. |
| Integrity | Append-only event content/proofs; Ed25519 checkpoints in a third private Fabric file; protected signing identity, retained verification keys, rotation and startup full-history/tail/restore checks. Local custody is not independent off-host storage. |
| Source safety | Managed app/system file mode with FULL/EXTRA before opening files. Fabric writers require FULL/EXTRA and configured hot placement on-write durability. An unavailable retained source is not treated as an empty queue; recovery needs a fresh grant. |
| Workers | Supervised delivery, Fabric writers and read-only WAL workers; no SQLite/auth lease across a provider await. Source capture, bounded broker/serialization and signing orchestration still consume app/host resources. |
| Compatibility | Existing Guardian APIs and qualified legacy-state migration remain intact; core migrations 001–044 are unchanged. Additive 045 registers private Storage artifact metadata. Package installation does not activate logging or migrate an app. |

`health().coverage.complianceReady` reports mechanical readiness of required
owners and availability. It is not certification, full app semantic coverage,
proof of human attention or protection against an attacker replacing every
local trusted file. The exact [coverage matrix](../backend/logging/events-and-coverage.md)
is authoritative. Browser observations cannot establish unobserved actions.

## Verification Record

These runs use synthetic data and isolated providers/files. Selections overlap:
do not add their counts together or describe them as an exhaustive whole-repo
suite. Failed early attempts are retained in external diagnostics, not recast
as passing evidence.

| Run | Observed result and scope |
| --- | --- |
| Final logging regression selection | 131 passed, zero failed, 37 files / 2966 assertions. Includes dedicated actor/delivery crash recovery, transactional source backpressure, private Storage/migration, custody, managed API/exports/admission, error projection and collector/bootstrap/SDK checks. |
| Service/lifecycle selection | 103 passed, zero failed, nine files / 724 assertions. Storage plugin isolation/lifecycle, native decisions, email provider stages and auth mail recovery. |
| AI/job concurrency selection | 108 passed, zero failed, six files / 573 assertions. Managed provider calls do not share a global await lane; embedding limits, each compiler defaults, explicit ordering and pinned graph behavior. |
| Existing session browser regressions | 26 passed, zero failed / 170 assertions, actual Chromium. Fixture build naming was corrected to emit separate JS/CSS outputs. |
| Strict AppProvider browser regression | One passed, zero failed. Real Elysia/WebSocket fixture; blocked delivery masks UI, retry recovers, scope-safe bootstrap resolves Sync admission, cookie-only hard refresh recovers without a loop. |
| Disk/source recovery selection | Six passed, zero failed / 37 assertions. Actual SQLite FULL failure rolls back the whole batch, proofs and sequence; source failure invalidates admission and cannot silently recover an old grant. |
| Canonical build identity | One passed / five assertions. A real Bun bundle and retained source resolve the same complete logging realm/schema/migration fingerprint. |
| Error/recovery protocol selection | 14 passed, zero failed / 144 assertions. Privacy-safe custom endpoint status/outcome, complete worker error vocabulary, bounded HTTPS custody and fixed empty browser bootstrap validation. |
| Final admission/error polish | Seven passed, zero failed, four files / 135 assertions. Includes an explicit unknown outcome after a protected write's response cannot be released. |
| Package distribution | One passed, zero failed / 185 assertions after updating the stale 043-only test registry to 001–045. Exercises packed installation, generated consumer typechecks/SSR, all clean migrations and private artifact table creation. The old registry failure was a test finding, not a reason to omit 045. |
| Installed public legacy boundary | The exact candidate archive passes the package test / nine assertions, which requires all ten inner synthetic conversion/runtime cases to pass. User IDs, trusted state and admitted runtime-table preservation remain under the existing public boundary. |
| Final scope browser checks | Three passed, zero failed / 37 assertions in addition to the strict AppProvider case. Anonymous recovery stays usable; authenticated scope replacement/revocation remains masked. |

Root TypeScript checking passes with no diagnostics. The documentation
structural check passes all 838 pages, IDs and reachability checks.

Detailed diagnostics remain under the external project artifacts
`diagnostics/` directory, not in Git. The installed public legacy boundary and
fresh official-build deployment both passed against the exact committed
candidate below. The earlier export/facade checks also passed; no public
contract was rebaselined to hide a missing symbol.

### Earlier Qualified Backend Candidate

| Field | Value |
| --- | --- |
| Source commit | `ccfc038483eb9ba007ad5947067104e5a0faeae8` |
| Package version | `2.6.0` |
| Archive under the external project artifact root | `dev/logging-compliance-ccfc038483eb9ba007ad5947067104e5a0faeae8.tgz` |
| Archive SHA-256 | `26e82d8b27746bc92549523b049b8032dbd38d4a5f94c0a3e34241e6dbd44acb` |
| Selection at this earlier checkpoint | Main remained `fc61dcc4cd107c6467bff498d3a772e8f5bdea9d`; this feature-branch archive predates the native live-DataTable correction and is not the final update target. |

This earlier evidence is retained for provenance. The subsequent native live
DataTable correction is recorded below and requires its own final packaged
qualification before normal main archive selection.

### Integrated Recovery And Privacy

- Real SQLite history tests page 205 equal-time holds/reviews without omissions.
  Export-state tests reject checksum/expiry/state tampering and verify rollback
  and exactly-once cleanup-capacity release.
- Local-owner custody tests cover restart, edits, older event-file restore,
  missing key/checkpoint rejection, explicit unsigned adoption, old-page
  verification and rotation. Synthetic independent custody tests cover
  signatures, monotonic CAS, failure and retained verification keys.
- Managed HTTP tests cover current-scope authorization, hostile/null Origin,
  no general cookie API fallback, streaming fences, blocked/expired admission,
  revoked access and unknown write-response outcomes. Private export routes
  retain fresh per-yield authorization and exact downloaded byte hashes.
- Strict client bootstrap runs outside the protected-data guard, while protected
  UI and ModalManager remain inside that guard. It can only send the fixed empty
  same-origin cookie ceremony; it cannot read app data or submit arbitrary
  browser evidence during an auth transition.
- Managed email acceptance is not delivery. A lost post-send audit acknowledgment
  yields `EMAIL_SEND_OUTCOME_UNKNOWN`; auth mail does not resend it and retains
  the possibly delivered expiring/single-use link. Ordinary authority failures
  retain their existing revocation behavior.
- Event replay requires the original complete event and trusted context. A new
  login/session is not an exact replay; a conflict is not permission to replace
  the previous facts.

### Official linux/amd64 Deployment

The checked-in `src/logging/test-support/managed-deployment/` fixture installs
the package, invokes the normal Zero build command, then starts bundled
`dist/server.js` with retained source/dependencies and explicit source actors
using `env: {}`. The committed backend candidate identified above passed on
Bun 1.3.14 in linux/amd64, including:

- Two main boots and 14 worker launches across SIGKILL/restart.
- No inherited synthetic provider/dotenv secret and no main-app boot in actors.
- Original-session exact event replay retained once.
- Private export bytes/hash survive owner restart.
- Required owners return `complianceReady: true` after recovery.

The image manifest is
`oven/bun:1.3.14-slim@sha256:d56a2534ffd262e92c12fd3249d3924d296d97086da773f821d7d0477435ea04`.
The earlier intermediate source pack also passed, but is not substituted for
this committed-candidate run. No claim is made about
arbitrary launchers, every operating system, sustained production load or
power-loss guarantees beyond the admitted filesystem/SQLite contract.

This test exposed a real bundle/source migration identity mismatch. The
official build now pins canonical logging migration function definitions at
build time; it does not bypass schema, checksum or actor fingerprint checks.
Existing source-created identities remain unchanged. Older preview logging
ledgers created with bundle-form function checksums need explicit qualification,
not migration-ledger edits. Application-owned custom realm bundling is outside
this targeted fix.

## PracticeIQ Acceptance And Dashboard

PracticeIQ's prepared policy requires actual compliance, administrator-only
investigation, no automatic retention cutoff, an explicit actor entry and
empty child environment. Its app/system sources must explicitly be file-backed
FULL/EXTRA; default NORMAL is not sufficient. Preserve its existing file paths,
single tenancy, identity/storage/workflow migration and approved offline state
boundary. Never substitute an empty database or switch a live hot image
implicitly.

The [framework handoff](../guides/practiceiq-upgrade/agent-handoff.md) and
[logging integration guide](../guides/practiceiq-upgrade/logging.md) describe
app-side acceptance. The app agent performs its own isolated image tests,
domain instrumentation and separately authorized cutover.

The user narrowed the UI pass to DataTable, server filtering, live updates and
individual-user audit history. The separate “New activity available” button
and explicit live-update opt-outs are removed. No dashboard redesign, advanced
Filters, richer review/hold management or manual-review organism is implied.

The authorized private Fabric append cursor now supplies genuine INSERTs to
the standard DataTable adapter, with exact server-side membership/newest-row
proof, reconnect continuation and 250 ms bounded visual batching. Older pages
retain ordinal cursors and the normal incoming-record control; retained rows
are not remounted or replaced with the initial loading animation. One burst
causes one page refresh. Five browser checks across the logging/native-insert
selection pass, and the expanded user-filter/server-source browser selection
passes all 26 tests. The latter includes three logging UI cases; counts overlap.

The expanded backend selection passes 164 tests across 42 files / 3199 assertions.
It covers a 205-event cross-tenant burst, resume cursors, duplicate safety,
1000-identity presentation bounds, exact user membership and strict managed
HTTP. The managed test verifies that projection/page/membership reads share one
audited investigation window rather than recursively generating refresh events,
without removing authorization, delivery or release fences. Client cancellation
closes the producer cleanly; failed authority fences still interrupt release.

## Self-Contained Custody And Deferred Work

Zero supplies the logging workers, private Fabric storage, append-only commands,
signing identity and checkpoint lifecycle without an external account.
Independent custody is optional stronger deployment hardening.

Encrypted nightly backups and importable older-log packages were explicitly
deferred. No backup scheduler, automatic archive/import or new deletion schedule
ships here. A future design needs authenticated encryption, keys outside
packages, verified manifests, capture-time checkpoints, isolated review and
fresh import authorization. Comparing an older verified package means comparing
the same event identities/history prefix, not newer events.

## AI And Job Concurrency

New independent each fan-outs default to the supported bounded maximum of 100.
An explicit `concurrency: 1` remains sequential; already pinned graphs/runs
retain their definitions. Embedding calls default to the supported maximum
parallel-call bound of 32, with an explicit lower setting available for
provider quotas or deployment budgets. Managed AI provider operations do not
share a global serialized logging lane.

Use Torrent's short durable enqueue handoff instead of awaiting an AI request
inside a per-database automation dispatcher. SQLite still serializes commits
per file; dependencies, ordering keys, rate limits and exhausted capacity can
legitimately cause waiting. “Maximum” is not infinite concurrency or a guarantee
that work never encounters resource limits.

## Release Boundary

### Corrective provider-provenance regression

The initial managed release missed a composition defect: the shared AI/email
stage helper selected `provider-confirmed` evidence but kept backend/system
origin. The unchanged validator correctly rejected that pair. Isolated
`createApp` reproduction returned HTTP 502 after synthetic AI success; existing
SDK/email port tests had not exercised the real managed stage helper/validator.

Code commit `6ff33f4c30d26c27caa64e0ae3b2c8e41e023ca6` corrects the trusted
helper's confirmation origin, retaining all initiating attribution. No schema,
authorization, general-purpose validation or public API relaxation is involved.
The new real compliance createApp/Fabric regression covers generation,
streaming, Jev/Laya decisions, user and background calls, and rejected forged
provider evidence. Additional real-worker cases cover tenant/API-key attribution,
embedding/reranking, incomplete/error/cancelled streams, SMTP/Resend shared-path
acceptance/partial/rejection/uncertainty, and post-send logging loss without a
duplicate send. Only synthetic adapters/private disposable files are used.

The logging/managed-service regression selection passes 138 tests / 3113
assertions; the final focused/native-decision selection passes 57 tests / 388
assertions. These selections overlap and are not an aggregate test count.
Neither result qualifies a different archive or substitutes for the application
agent's own acceptance. Select the corrective artifact only after exact-package
checks; `zero-release --status` supplies its authoritative commit/path/hash.

Old uncertain sends still require reconciliation. Installing the correction
does not create missing confirmation evidence or replay earlier external work.

### Publication

The implementation is committed on the feature branch and the exact candidate
is qualified. Keep hook-driven selection disabled while saving review evidence.
The agreed minimal UI pass is implemented and tested. Deliberately merge and select
the final qualified main archive through Zero's release tooling. Return its exact source
commit, archive path and SHA-256 only after selection verifies. No app update,
live conversion or deployment is performed by this framework task.
