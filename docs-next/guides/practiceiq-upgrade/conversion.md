---
id: zero.guides.practiceiq-upgrade.conversion
type: operations
audience: [developer, agent, operator]
owner: zero-documentation
status: in-review
visibility: internal
system: cross-system
feature: practiceiq-legacy-plane-conversion
maturity: planned
applies_to: ["PracticeIQ 1.3.0-piq.1 to pinned Zero 2.6.0 main"]
modes: [single-tenant, isolated-rehearsal]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "202b9f7f35c761192ce9089e7ea84c4fbe9c58c3"
  snapshot: clean
  date: "2026-10-25"
  evidence_level: source-observed
---

# Plan the PracticeIQ Data and Compatibility Conversion

[PracticeIQ upgrade](./index.md) · [Documentation index](../../index.md)

Installing Zero 2.6.0 does not split a legacy combined database. The managed
layout guard rejects prohibited system state in the application file instead
of moving credentials at startup. The PracticeIQ agent must implement and test
an explicit converter against its actual old schema and an isolated copy.
The supplied verification tools do not contain that converter.

## Preserve the Application Profile

Keep `auth.tenancy: 'single'`, the existing public/staff route separation and
server authorization. Do not introduce a customer organization, move users
into an artificial tenant, attach an organization to every clinical record or
turn on `tenant-database` isolation just to obtain separate files.

Use an explicit independent `systemDb`. Current system/auth and primary app
planes remain managed/pinned; logging supplies its own Fabric databases and
worker independently. An application-wide move into named actor databases is
not automatic and is not a prerequisite for this upgrade. If requested later,
plan it through the supported [Fabric topology](../../backend/fabric/topology.md)
and [realm](../../backend/fabric/realms.md) contracts.

## Inventory Before Mapping

Inspect source and private offline-schema evidence, not production rows in
chat or committed reports. Defaults observed in `zero.config.ts` are hot mode,
`./data/app.db` and `./data/app.snapshot.db`; production overrides remain an
operator inventory item. The old app migration command selects the durable hot
snapshot or file-mode path. It must never be redirected to the new system file.

Build a complete table disposition manifest: exact source name, source schema
fingerprint, owner, target plane/table, preserved identity, field mapping,
transformation version and verification rule. Every source table must be
classified, including migration history, platform tokens, storage metadata and
pending work. Unknown tables block conversion. Table-name prefixes alone are
not an ownership map.

Use the preparation toolkit's [complete table-map gate](./preparation.md#validate-the-complete-table-map)
to reject omissions and stale source fingerprints before implementing or running
the conversion. It verifies declared dispositions, not whether the proposed
canonical import/field mapping is semantically correct.

| Source responsibility | Target and required proof |
| --- | --- |
| Patients, intake responses, assessments, consents, notes, care plans, TCM, psychotherapy, tasks and reporting | Application. Preserve stable IDs, relationships, versions, status/history and exact existing values unless a separately approved transform says otherwise. Compare complete table checksums, not a sample of rows. |
| Letters, template/version history, artifacts, delivery attempts and receipts | Application domain state. Preserve immutable content/version hashes and uncertain-send status. Do not turn old link delivery into an automatically sent attachment. |
| Canonical users, credentials, trusted properties, MFA, roles and authority | System. Preserve identities and validated credential semantics; explicitly map privileged ownership. App-local anchors contain only the framework-required identity dependencies. |
| Sessions, signing/encryption dependencies, action/resume/upload tokens | Their supported current authority/service stores. Specify preservation or deliberate invalidation/reissue per token family; never silently break pending patient links or convert an invalid token into a valid one. |
| Storage metadata/grants and object bytes | System service ownership plus retained private object store as required by the current contract. Preserve IDs, privacy, permissions, checksums and all clinical references. Do not create public URLs as a migration shortcut. |
| Workflow definitions, runs, waits, attempts, timers and external receipts | Current Torrent/system contract with exact legacy-compatible handlers and immutable versions. Prove restart and duplicate-delivery safety; never delete pending work to make boot succeed. |
| Guardian audit and app-owned clinical event tables | Preserve original history/provenance. Logging enablement mirrors new supported events; it does not backfill complete historical evidence. Any later import is a separate labeled operation. |
| App/system migration ledgers and schema history | Keep each domain's immutable history separate. Do not copy a combined ledger wholesale into both targets or mark new migrations applied by assumption. |
| Ephemeral caches, generated output and process claims | Classify explicitly. Rebuild only items confirmed disposable; never infer that a queue, token store, fence or unknown file is a cache. |

## Converter Implementation Requirements

Use an app-owned, versioned conversion slice outside historical migration
bodies, for example `db/upgrades/zero-2/`. Keep command parsing, schema mapping,
copy/transform, evidence and verification separate. Do not edit installed
framework source or import Zero's private implementation files. If preserving
canonical authority requires a public import/validation contract that Zero
does not expose, stop and request that framework capability rather than bypass
its invariants with guessed SQL.

The converter must:

1. Default to plan/inspection. Applying needs the exact approved source identity,
   destination identity, backup receipt and isolated destination paths. No path,
   provider, secret or live configuration is inferred from the current directory.
2. Reject stale/unrecognized schema fingerprints, unknown tables/columns,
   incomplete mappings, symlinks/aliases, source/target overlap, live owners and
   existing unexplained target data. Never include `--force` or an erase/reset
   escape hatch.
3. Initialize the correct new system schema through the current supported
   registry/lifecycle; apply app migrations only to the app plane. Preserve old
   applied checksums. Built-in SYSTEM migrations are not an app migration plan.
4. Stage new target files without modifying the retained old source. Preserve
   IDs before rewriting references. Explicitly validate password/hash formats,
   trusted `practice_role`, MFA encryption dependencies and any session/token
   handling. Do not recreate accounts with new UUIDs or default passwords.
5. Verify canonical target state before removing *classified* legacy system
   tables from a candidate app copy. Where actual FK declarations need local
   identities, use managed [Guardian anchors](../../backend/schema/guardian-references.md),
   not full credential/profile copies or disabled foreign keys.
6. Persist a private generation/checkpoint manifest. Per-file SQLite transactions
   do not create a distributed atomic commit; a crash between system/app writes
   must leave the generation unpublishable. Retry only verified idempotent work;
   an unfinished generation must not be accepted as a completed migration.
7. Produce complete reconciliation: unchanged app table/schema digests, preserved
   identity sets and mappings, FK/integrity results, storage linkage/byte checks,
   ledger disposition, pending external effects and runtime readiness. Reports
   must not contain password hashes, tokens, patient content or raw provider data.
8. Never install/restart production, send mail, call AI, execute pending workflows
   or swap live volumes as a side effect of conversion. Cutover is a separate
   approved lifecycle after the [acceptance gates](./agent-handoff.md).

Test missing/unknown tables, repeat execution, crash after each stage, partial
target creation, restored old source, denied ownership, revoked users, broken
FKs and tampered manifests. A no-op second run must be exact—not a second copy
of emails, patients, workflows or audit events.

## Existing PracticeIQ Safeguards to Keep

The source already has `db/migration-target.ts`, `migration-safety.ts` and
`migration-command.ts`, with tests. In particular, migration `2026102003`
receives compatibility-aware destructive protection while retaining applied
historical checksums. Do not blanket-enable destructive migrations on populated
targets or rewrite that historical source/checksum to bypass a failure.

The `2026072901` app migration historically updated `user_properties` when it
was present in the combined file. After the split, trusted properties belong
to canonical Guardian. Preserve its already-applied outcome; do not replay the
old SQL against a clinical database or redefine the system property table there.

Old workflow registrations use named handlers and registry creation in plugins.
Review registration timing before Torrent recovery starts. Preserve required
legacy handler names/code and reconcile uncertain provider attempts before
enabling schedulers. Long AI/provider work belongs in durable Torrent work,
not a per-database automation queue that blocks unrelated deliveries.

## Classify Query Portability Before Rewriting

The [application-client extension](../../backend/fabric/application-client.md)
provides request `zero.data` for the single-tenant primary database as well as
tenant-file Fabric. PracticeIQ can keep single tenancy and use the same async
repository calls. `zero.db` remains the synchronous compatibility surface.
The older main archive pinned in this guide does not contain this extension:
qualify and record a newer exact commit/archive before using it. Do not assume
matching version strings prove capability availability.

Classify each touched repository operation before implementation:

| Operation | Appropriate direction |
| --- | --- |
| Simple primary-key read or tracked create/update/delete | Prefer request `zero.data.get`/`mutate` after qualifying the extension. Existing tracked `zero.db` calls can remain where their synchronous semantics are required. Preserve domain/resource authorization and validation. |
| Filtered/sorted single-table page and total | Use `findPage` for rows plus exact matching total. Do not load whole tables and filter/count in JavaScript. |
| Joined reads, CTEs, correlated subqueries or reporting aggregates | A versioned registered realm query can retain efficient SQL inside the selected read capability. General structured find is not a full relational query builder. Do not replace a join with N+1 remote calls. |
| Atomic transition with revision guards/multiple writes | Preserve one transaction through a named command/batch in either mode. Do not split it into separate awaited reads/writes or send closures over IPC. Confirm required assertions; record a framework gap if they cannot be represented. |
| Direct access to canonical users, auth properties or workflow internals | Use the owning Guardian/Torrent service facade. Do not point an app-data client at system tables or copy full system rows back into the clinical DB. |
| Needed behavior without a supported public contract | Record an explicit Zero facade gap before adding app-specific engine coupling. Extend the existing abstraction deliberately rather than building another ORM or silently using unsafe internals. |

PracticeIQ's patient directory uses a patient/location join, a correlated
reporting-flag lookup and an exact total. Its letter repositories combine
tracked writes with synchronous revision-checked transactions. Those are
meaningful semantics, not evidence that every SQL call was poor agent work.
Some primary-key SQL reads can be simplified; complex operations need a
compatible declared query/command. Register primary handlers through `dataRealm`
without changing physical topology; see the linked facade guide. Distinguish
production calls from raw assertions in tests.

For this single-tenant split, clinical-only SQL can remain valid in the same app
file. Moving system state and enabling independent logging does not require an
app-wide actor rewrite. Raw SQL still needs explicit audit coverage; retaining
it does not make it automatically tracked or authorized.

## Replace the Custom Framework Pin

The normal main target includes `EmailAttachment`,
`EmailProvider.supportsAttachments` and `isEmailAttachmentDeliveryReady()` for
both Resend and SMTP. See [attachments](../../backend/email/attachments.md).
PracticeIQ currently imports that helper in
`server/letters/create-letter-services.ts`; it must remain a public Zero import.

Build a behavior inventory of the custom old framework diff. For each patch,
record the normal Zero implementation or an explicit unresolved framework gap.
Do not transplant old source over new SMTP, IMAP, runtime ownership or provider
logic. Remove any obsolete patch/reapplication mechanism only after its tests
pass on the normal archive. Retain the old pin in rollback artifacts.

For attachments, prove reviewed letter PDF byte equality, MIME/filename,
unsupported-provider rejection, sender/provider readiness, safe failures,
worker readiness and no resend after an uncertain or accepted attempt. Use
synthetic providers/local SMTP and the existing letter runtime tests before
any separately approved delivery test. Mail receipt does not prove recipient
delivery or reading.

## Preserve the Main Website

Keep PracticeIQ's `docs/public-site-migration.md` as the app-specific public
contract. It describes scoped Better Behavioral navy/blue/gold/Montserrat,
the public route group, narrow client islands, class manifest, assets and
metadata handling. Preserve those mechanisms until an intentional compatible
replacement is tested; do not remove them as assumed redundant new-framework
workarounds.

Source hashes are necessary but not sufficient. New package CSS can change
computed typography, colors and spacing without editing app files. Compare
old/new synthetic previews: desktop/mobile, light/dark where applicable,
no-JavaScript SSR, navigation/FAQ/finder, reduced motion, canonical metadata,
sitemap and token-route exclusions. Public marketing must not accidentally
start a patient data feed, duplicate auth provider or activity collector.

Use the [UI migration manual](../ui-upgrade.md) for deliberate staff adoption of
AppShell, modal manager, selects/popovers, ScrollArea, tables and chart facades.
Keep old implementations until accepted. UI compatibility changes must not
weaken a server resource, route or trusted-property permission check.

## Related Guides and Next Steps

- [Preparation](./preparation.md) provides baseline and offline verification commands.
- [Logging rollout](./logging.md) covers its independent files and clinical boundaries.
- [Migration planes](../../backend/migrations/data-planes.md) and
  [legacy Torrent](../../backend/torrent/legacy-workflows.md) define the supported contracts.
