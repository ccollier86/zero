---
id: zero.migrations.legacy-state
type: operations
audience: [developer, agent, operator]
owner: migrations
status: in-review
visibility: internal
system: migrations
feature: legacy-state-staging
maturity: preview
applies_to: ["2.6.0 legacy-state boundary extension; pin the qualified commit and archive"]
modes: [offline, legacy-single-tenant, separate-system-database]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "054941b23544c9320d7ff739ae3ae1a927c67996"
  snapshot: dirty
  date: "2026-10-25"
  evidence_level: source-observed
---

# Stage Legacy Combined State Without Recreating Identities

[Migrations index](./index.md) · [Documentation index](../../index.md)

Use `@zero/framework/migrations` to split an approved offline Zero 1.3 combined
database into fresh system and application databases. The boundary preserves
existing IDs and stored values, including credential hashes, trusted properties,
tokens, Storage metadata/grants and workflow history. It does not call public
create APIs to replace identities, require application code to write private
system SQL, or start the application.

This is a narrowly admitted staging operation, not a universal converter or a
production cutover command. A successful stage still requires application
acceptance. Pending workflows are preserved under an explicit recovery hold;
copying their state does not authorize their execution.

## Supported Source and Preconditions

The only current `sourceFormat` is `zero-1.3-single-combined`. It admits the
known framework schema and checksums for migrations `001` through `007`, plus
the optional historical runtime tables `_auth_user_generations`,
`_sync_mutation_receipts` and `_zero_sync_table_modes`. A runtime table may be
absent on an installation that never created it, or present with no rows.
Present tables must match their frozen column, primary-key and constraint
contracts. They are framework-owned; do not list them in `applicationTables`,
rename them, empty them or mark them disposable to pass admission. The PracticeIQ source pin
`4ef1f85982eea038f1c193b7fc7e487d800ef415` has the same seven immutable
framework checksums. Other source schemas require a separately supported
profile; do not modify historical checksums or loosen admission to force one in.

Before calling the boundary:

- Obtain an authorized, quiescent, consolidated SQLite backup and record its
  approved SHA-256. For hot storage, capture the current image through the old
  runtime's supported snapshot/shutdown path. A stale snapshot or a bare live
  main-file copy is not a backup of the current database.
- Keep live writers away from the input. `offlineSource: true` is an operator
  attestation, not an automatic process-owner detector. Symlinks, hardlinks,
  path aliases and WAL/SHM/rollback-journal companions are rejected. Never
  delete companions to make an inconsistent input pass.
- Supply the complete application table inventory and approved application
  migration checksums from its immutable registry. Do not derive trust merely
  by copying whatever checksums an unknown ledger contains.
- Create a private canonical parent directory with mode `0700`. The requested
  output directory must not exist. Each attempt creates a separate generation.
- Retain the old archive, deployment configuration, Storage bytes, encryption
  and signing dependencies, backup artifacts and tested restoration procedure.
  The boundary handles SQLite state, not external files or provider effects.

Unknown tables, virtual tables, custom canonical triggers, incompatible canonical
columns/foreign keys/unique constraints, unapplied or unrecognized ledger state,
and missing ownership checksums fail admission. App-owned indexes, rows and
triggers are retained. Views stay in the app plane and must remain valid with
ID-only user anchors; a view depending on canonical profile columns needs
separate reviewed application adaptation, not a copied credential/profile table.

## Public API and Inputs

All three operations are asynchronous. No `createApp`, app config, dotenv,
provider initialization, scheduler or historical app migration body is loaded.

| Public operation | Result and effect |
| --- | --- |
| `planLegacyStateMigration(input)` | Read-only admission and a deterministic `LegacyStateMigrationPlan`. It creates no destination. |
| `stageLegacyStateMigration(input)` | Rechecks the approved plan, stages new private files and writes a success receipt only after all checks pass. |
| `verifyStagedLegacyStateMigration(input)` | Reopens untouched staged output read-only and checks its receipt, byte hashes, preservation evidence and ledger ownership. It never repairs it. |

`LegacyStateMigrationInput` requires `sourceFormat`, `offlineSource: true`,
absolute canonical `sourcePath`, approved `sourceSha256`, `applicationTables`
and `applicationMigrationChecksums` (version to SHA-256 mapping). Stage adds
`expectedPlanFingerprint`, `outputDirectory` and `resetReactiveHistory: true`.
Verification takes the same inputs without requiring `resetReactiveHistory`.
There are no inferred paths, environment bindings, destructive overrides or
implicit apply defaults.

The plan contains table names, columns, owners, row counts and typed row/schema
digests, both migration-version sets, the target registry digest, view names,
`pendingWorkflowCount` and `fingerprint`. It contains no row contents or raw
credential/token hashes. Keep even this metadata private.

### Small Bun Command Wrapper

This application-owned wrapper uses only the supported package surface. Provide
an operator-reviewed input JSON matching `LegacyStateMigrationInput`; it is data,
not an executable application configuration. The framework validates it again.

```ts
// scripts/stage-legacy-state.ts
import {
  planLegacyStateMigration,
  stageLegacyStateMigration,
  verifyStagedLegacyStateMigration,
  type LegacyStateMigrationInput,
} from '@zero/framework/migrations';

const [operation, inputFile, expectedPlanFingerprint, outputDirectory] = Bun.argv.slice(2);
if (!inputFile || !['plan', 'stage', 'verify'].includes(operation ?? '')) {
  throw new Error('Use plan input.json, or stage/verify input.json fingerprint new-generation-path');
}
const input = await Bun.file(inputFile).json() as LegacyStateMigrationInput;
if (operation === 'plan') {
  console.log(JSON.stringify(await planLegacyStateMigration(input), null, 2));
} else {
  if (!expectedPlanFingerprint || !outputDirectory) throw new Error('Approved fingerprint and explicit generation path are required');
  const approved = { ...input, expectedPlanFingerprint, outputDirectory };
  const result = operation === 'stage'
    ? await stageLegacyStateMigration({ ...approved, resetReactiveHistory: true })
    : await verifyStagedLegacyStateMigration(approved);
  console.log(JSON.stringify(result, null, 2));
}
```

Run with `bun --no-env-file` in a controlled environment and retain stdout only
in private evidence. Review the plan before providing its fingerprint to stage.
Changing source bytes, the approved registry or ownership changes admission or
the fingerprint. Reverification is for output **before** app-specific conversion
or runtime boot: legitimate later writes also invalidate the original receipt.

## Exact Partition and Preservation Rules

| State | Staged ownership and verification |
| --- | --- |
| Canonical identity, password hashes, trusted properties and auth generations | System. Preserve original IDs and every original column value. No account recreation, password reset or guessed privilege assignment. |
| Auth, action and resume token rows, including revoked/used/expired state | System, unchanged. Current expiry, revocation, consume-once and replay rules still apply. Stored signing keys/config remain; external encryption/signing dependencies must be retained separately. |
| Storage drive/object/blob identities and grants | System metadata, unchanged. Private object bytes and provider configuration remain an independent copy/verification obligation. |
| Workflow definitions, runs, steps, events, waits and pending state | System, unchanged in all original columns. Normal system migrations add current derived version pins where provable. Nonterminal imports receive a recovery hold, not invented execution authority. |
| Application tables, row identities, foreign keys, values, indexes and triggers | Application, unchanged. A minimal `users(user_id)` anchor preserves the original complete user ID set without credentials, roles or profile copies. Declare current Guardian references during app adaptation. |
| `_sync_mutation_receipts` | Framework-owned application runtime. Preserve every original receipt unchanged in the application file, not the system file. The plan labels this owner `application-runtime`; it is not a clinical application table. |
| `_zero_sync_table_modes` | System metadata, preserving every existing decision and timestamp. The normal managed resolver uses this metadata store on boot; current explicit sync configuration still takes precedence. |
| `_migrations`, `_zero_migrations`, `_zero_schema_history`, `_zero_migration_artifacts` | Partition by approved framework/app version and checksum. Preserve original IDs and records; never clone the mixed ledger into both files. |
| Old `_changes` and `_change_sequence` | Reset explicitly in both new planes. The retained source keeps the original mixed stream. Clients need a fresh snapshot/cursor; old sync cursors must not be reused. |

Historical schema-history JSON may describe the old **combined** database.
Partitioning assigns the record to its migration owner; it does not rewrite that
historical snapshot/hash to pretend the migration ran against the new plane.
Historical backup paths still name the original recovery bundle. New system
migrations run only against the staged system file with their normal safety and
verified-backup gates; application migrations are not executed.

Preservation checks stream typed row digests, including blobs, nulls and 64-bit
integers, instead of accepting equal counts as proof. Both targets pass SQLite
integrity and foreign-key checks. System advancement must retain every original
column value and produce the current framework migration registry. App schemas
remain exact except for classified removal and ID-only anchors.
Preserved identities are declared column values, not SQLite's implicit physical
`rowid`; applications must not use a vacuum-sensitive internal rowid as an
external business identity.

### Historical Mutation Replay

The old receipt key was `user:<userId>`; the current receipt key also includes
the authorization scope. Staging adds source-bound replay bindings for imported
authenticated-user receipts without rewriting their keys, hashes, timestamps or
stored acknowledgements. A matching user, reference and semantic request hash
can acknowledge already completed work without executing it again, even though
the reactive stream was reset. A reused reference with different contents fails
with `Mutation reference conflict`.

The acknowledgement reloads the current row through current table visibility,
row filters, projection and the final authority check. It never returns a saved
historical row body or grants the old permissions. Anonymous receipts are
preserved but are not rebound to a newly authenticated user. An unmarked old
receipt in an ordinary current database is not implicitly adopted. The existing
bounded receipt-retention policy still applies after normal runtime starts;
unknown/pruned retry outcomes remain rejected rather than repeated automatically.
Do not delete these receipts together with `_changes` or `_change_sequence`.

## Pending Workflow Recovery Requires a Separate Decision

`workflowRecovery: 'requires-reviewed-authority'` means the rows survived, but
old runs lack a current permission binding. The boundary records private
per-run holds. With `workflows: false`, isolated app/UI/auth/Storage work can
continue without executing them. Enabling normal recovery rejects
`WORKFLOW_LEGACY_MIGRATION_REQUIRED` before changing their statuses or invoking
handlers. `no-pending-work` means no nonterminal imports required a hold.

Do not remove hold records, call private authority stores, run SQL to mint seals,
or label the copy operation as a successful workflow resumption. Choosing fresh
actor approval versus an explicitly approved background-system principal is a
separate authorization decision and follow-up contract. Retain handlers and
uncertain-send receipts while it is resolved. Never replay an email, AI call or
other external action just because it has an old pending row.

## Output Durability and Failure Handling

The new directory contains `plan.json`, consolidated `system.db` and
`application.db`, and finally `staged.json`. The receipt contains their exact
paths/digests, plan/source identities, `workflowRecovery` and
`requiresApplicationAcceptance: true`. Files are `0600`, the generation is
`0700`, and final snapshots/receipt are synchronized before success returns.
Private work databases and guarded system-migration backups are retained too.
They are staging artifacts, not additional production planes.

A failure retains the private generation and, when writable, `failed.json`
with a safe code and phase. Never reuse, auto-repair or publish that generation.
Repeat stage against an existing path fails; verify is the read-only repeat
operation for a successful untouched generation. The original source remains
unchanged. Do not use framework down migrations as a rollback of the split.

`LegacyStateMigrationError` exposes a stable `code` and optional `phase`, without
row contents, SQL bindings or raw filesystem causes. Input/source/schema and
ledger failures use `LEGACY_STATE_INPUT_INVALID`, `SOURCE_INVALID`,
`SOURCE_CHANGED`, `SOURCE_UNSUPPORTED`, `INTEGRITY_FAILED`, `UNKNOWN_TABLE` or
`LEDGER_INVALID` with the common `LEGACY_STATE_` prefix. Later failures are
`PLAN_CHANGED`, `DESTINATION_INVALID`, `PRESERVATION_FAILED`, `STAGE_FAILED` or
`MANIFEST_INVALID` with that prefix. Investigate privately and request a
supported profile for unknown layouts; never bypass the guard.

## Verification and Related Guides

Source tests cover preservation, wrong checksums/schema, orphaned FKs,
unknown ownership, repeat execution, partial generations and tampering.
Managed synthetic file/hot tests exercise existing-password login, original-ID
legacy refresh adoption, scoped Storage, generic token use/replay protection and
non-mutating rejection of unapproved workflow recovery. Runtime-table tests cover
absent/empty/populated receipts, exact sync-mode preservation, mismatched schemas,
replay-binding tampering, repeated managed Sync acknowledgement without a second
write, conflicting references, and current visibility/authority fences. Exact installed-archive
qualification is recorded separately by commit and archive SHA-256; a matching
`2.6.0` version string is insufficient.

- [Backup operations](./backups.md) explains consistent snapshots and restore responsibility.
- [Migration planes](./data-planes.md) separates framework and app registries.
- [Guardian references](../schema/guardian-references.md) supplies minimal application FK dependencies.
- [PracticeIQ conversion](../../guides/practiceiq-upgrade/conversion.md) adds app-specific clinical, Storage-byte and acceptance obligations.
- [Application data facade](../fabric/application-client.md) covers app queries after staging, without requiring a fake tenant or a new ORM.
