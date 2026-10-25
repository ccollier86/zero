---
id: zero.guides.practiceiq-upgrade.preparation
type: operations
audience: [developer, agent, operator]
owner: zero-documentation
status: in-review
visibility: internal
system: cross-system
feature: practiceiq-upgrade-verification-tools
maturity: preview
applies_to: ["PracticeIQ 1.3.0-piq.1 to pinned Zero 2.6.0 main"]
modes: [read-only-source-inspection, explicit-offline-copies]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "66035d0dad75ea2276ce2f888499e2292b1ee995"
  snapshot: dirty
  date: "2026-10-25"
  evidence_level: source-observed
---

# Prepare and Verify the PracticeIQ Upgrade

[PracticeIQ upgrade](./index.md) · [Documentation index](../../index.md)

The supplied [command entry](./tools/run.ts) verifies source preservation and
explicitly staged offline SQLite copies. It never imports `zero.config.ts`,
loads dotenv files, starts providers, installs packages or runs app scripts.
`init` creates an empty private workspace; the other commands create evidence
files or perform read-only checks. There is no apply, migrate, restore, deploy,
force or cleanup command.

The framework's separate [legacy state boundary](../../backend/migrations/legacy-state.md)
provides the supported offline staging operations. Complete these source and
backup checks first, then follow the [conversion sequence](./conversion.md#canonical-staging-sequence).
Do not add private canonical SQL to this verification toolkit.

## Prepare the Application Branch

Read PracticeIQ's complete `AGENTS.md` and installed Zero orientation first.
Identify the active user explicitly, fetch the remotes required for that user,
and start a focused feature branch from that user's latest integration branch.
Use a separate worktree when necessary. Do not switch another agent's dirty
checkout, assume the user from Git metadata, delete untracked files or merge
into PracticeIQ `main` without its explicit task authorization.

Review application scripts before executing them. The observed `dev` and
`start` scripts both run `bun run migrate` before starting. `db/migrate.ts`
imports the real config; `migrate:status` and Doctor also need a trusted target
and controlled environment. They are not safe shortcuts for source inspection.
Do not run them against a guessed default `data` directory.

Review `scripts/zero-archive.ts`, `verify-zero-archive.ts` and
`materialize-zero-framework.ts`. Keep the managed archive dependency:
`file:./.zero/framework/zero-framework.tgz`. Do not replace it with a source
symlink. An authorized app package update must retain its tracked archive,
lockfile and `zero-release.json` together. Do not delete the old archive as
part of preparation.

## Create a Source Baseline

Use Bun with `--no-env-file` and the deployment's designated external scratch
and private diagnostic roots. The following shell variables are placeholders
to set deliberately; none is automatically discovered from the application:

```sh
PIQ_PROJECT=/absolute/path/to/clean/practiceiq-feature-worktree
PIQ_UPGRADE_TOOL=/absolute/path/to/zero/docs-next/guides/practiceiq-upgrade/tools/run.ts
PIQ_REHEARSAL=/absolute/private/scratch/practiceiq-upgrade-run-001

bun --no-env-file "$PIQ_UPGRADE_TOOL" init \
  --project "$PIQ_PROJECT" --rehearsal "$PIQ_REHEARSAL"
bun --no-env-file "$PIQ_UPGRADE_TOOL" source-baseline \
  --project "$PIQ_PROJECT" --rehearsal "$PIQ_REHEARSAL" \
  --out sources-before.json
```

`PIQ_REHEARSAL` must not exist. Its parent must already exist. The tool creates
0700 root/source/candidate/evidence/temp directories and a purpose marker, outside
the app. Evidence reports are exclusive 0600 JSON files: existing files cannot
be overwritten. A failed or superseded run needs a new explicit directory or
report name; the tool never removes old evidence.

The source baseline requires a clean Git worktree and exactly one lockfile.
It records source digests and verifies the archive against the existing release
manifest, excluding the usual runtime roots, SQLite filenames, dotenv and known
key-file extensions. It fingerprints tracked/staged source, including public
assets; nonignored untracked source blocks verification before its contents are
read. Review/stage intentional additions before a final protected check. This is
not an inventory of ignored deployment state; separately classify any unusual
tracked state/secret paths before use. Hashes and counts remain private evidence.

## Verify the Package Update Boundary

Before adopting the [primary async facade extension](../../backend/fabric/application-client.md),
record its qualified exact main commit/archive as `PIQ_TARGET_COMMIT` and
`PIQ_TARGET_SHA256` from the release handoff and saved release status. Do not use
the older historical baseline in the index as the target for this extension.
The guards intentionally reject a feature-branch package as an ordinary main
update. Never weaken that check or infer capability from `2.6.0` alone.

First inspect the [saved update](../../cli/tooling/zero-update.md) dry run.
The application agent may later execute the approved package update on the
feature worktree, with no app-defined checks/migrations selected implicitly.
Do not run `create-zero --force`, overwrite the app with a starter, or merge
the Zero repository's branch into the PracticeIQ repository.

After that deliberate package-only step, before editing application code:

```sh
bun --no-env-file "$PIQ_UPGRADE_TOOL" check-package \
  --project "$PIQ_PROJECT" --rehearsal "$PIQ_REHEARSAL" \
  --before sources-before.json \
  --expect-commit "$PIQ_TARGET_COMMIT" \
  --expect-sha256 "$PIQ_TARGET_SHA256"
```

This permits only the managed archive, manifest and lockfile to change. It
requires the exact archive digest/commit and a normal `refs/heads/main` source.
It is not a vendor-signature verifier or proof that installation materialized
the right bytes: use the app's reviewed archive/materialization checks and
fresh-consumer import tests too. Ordinary package installation can reuse cached
tarballs; do not assume a matching version string proves source identity.

After intentional application changes, use `check-protected` with the same
arguments. It permits changes elsewhere but rejects changed, removed or added
public website/brand files, root/public layout changes and existing historical
migration-body changes. Migration additions belong in the separately reviewed
conversion slice, not silent edits of old SQL. A protected-source failure needs
review; do not regenerate the baseline just to make it green.

## Back Up and Rehearse Restoration First

Inventory the actual deployed mode and privately resolved paths. Defaults in
source are not evidence of production locations. For hot mode the current
live image can be newer than its snapshot: use the old runtime's supported
consistent snapshot/quiescent shutdown boundary. Never copy only a live SQLite
main file, ignore its WAL, or equate an old snapshot with the current state.

The private recovery bundle must account for:

- Complete application/system state and migration ledgers at one recorded
  quiescent boundary, plus any existing Fabric files and their bindings.
- Storage object bytes, metadata, permissions, checksums, drafts/reservations
  and workflow references; a DB-only backup is insufficient.
- KV recovery state used for durable flows, the old artifact/lockfile, and
  operator-controlled credentials/signing/encryption keys needed to reopen it.
- Pending email/PDF/AI work and external-effect receipts. Stop or isolate all
  old writers and scheduler processes before taking the cutover boundary.

Do not put secrets in a migration report or check them into Git. Encrypt and
access-control real backups according to deployment policy. Restore the bundle
into an isolated copy and prove it opens with the **old** pin before conversion.
No preparation script supplied here copies production data or proves that
external backup software created a consistent set.

## Inspect Consolidated Offline Copies

After an operator has prepared authorized, fully consolidated copies, place
them under the initialized `source/` and `candidate/` directories. Copies must
have no WAL/SHM/rollback-journal companions; use a supported SQLite snapshot,
not deletion of companions to force admission. Never place live production
mounts/symlinks in this workspace. The purpose marker is an accidental-target
guard, not proof that a process cannot write to a file.

```sh
bun --no-env-file "$PIQ_UPGRADE_TOOL" sqlite-snapshot \
  --project "$PIQ_PROJECT" --rehearsal "$PIQ_REHEARSAL" \
  --database source/legacy.db --out legacy-tables.json

bun --no-env-file "$PIQ_UPGRADE_TOOL" sqlite-snapshot \
  --project "$PIQ_PROJECT" --rehearsal "$PIQ_REHEARSAL" \
  --database candidate/app.db --out candidate-app-tables.json

bun --no-env-file "$PIQ_UPGRADE_TOOL" compare-tables \
  --project "$PIQ_PROJECT" --rehearsal "$PIQ_REHEARSAL" \
  --before legacy-tables.json --after candidate-app-tables.json \
  --tables patients,documents,notes
```

For large authorized copies, set `TMPDIR` and `SQLITE_TMPDIR` on the verification
process to the private `PIQ_REHEARSAL/temp` directory so SQLite sorting/spill
artifacts stay in approved private scratch storage. They are not backups or
published evidence; retain/remove them only under the run's operational policy.

The final list is an example, **not complete clinical coverage**. Generate and
review the complete preserve list from the table ownership map, including
consents, assessments, care plans, letters, tasks, attribution and history.
Every source table needs an explicit disposition. A supplied table list also
lets an operator inspect selected ordinary tables when unrelated virtual tables
need a separately reviewed verifier; unknown/missing/unsupported tables are not
silently skipped.

SQLite opens readonly with creation disabled and `query_only`. Each snapshot
performs integrity and foreign-key checks, then fingerprints schema and exact
typed row values in deterministic order within a read transaction. Reports
contain table names, columns, counts and digests—not patient values or IDs.
Large integers, blobs, nulls and duplicate rows remain distinguishable. This
can be disk/CPU intensive; run it against offline copies, not a live web process.

`compare-tables` requires identical schema, columns, row count and value digest
for every selected unchanged table. Intentional transforms require their own
mapping assertions and tests; counts alone or an empty selected list cannot
pass. The tools do not validate storage bytes, new permission semantics,
workflow replay or UI rendering: those have separate acceptance gates.

## Validate the Complete Table Map

Use the full `sqlite-snapshot` report made without `--tables` for this gate.
New reports carry `inventory: 'all'` or `'selected'`; a selected-table report
cannot establish a complete conversion map. If unsupported virtual tables
prevent a full inventory, stop for a separately reviewed inventory/verifier
instead of relabeling a selected report as complete.

The application agent must author and review a private JSON plan under
`evidence/`, with `schema: 1`, `kind: 'practiceiq-table-map'` and a `tables` array.
Each entry contains these fields:

| Field | Required value |
| --- | --- |
| `table`, `schemaSha256`, `rowsSha256`, `rows` | Exact name and source evidence from the full report; no patient content. |
| `owner` | `application`, `system`, `storage`, `workflow`, `audit`, `migration` or `ephemeral`, determined from actual service ownership. |
| `action` | `preserve`, `convert` or `rebuild`. Only explicitly ephemeral state may use `rebuild`. |
| `targetPlane`, `targetTable` | Required for preserve/convert: a declared application/system/logging-audit/logging-operational/storage/kv plane and an explicit table. Omit both for rebuild. |
| `rule` | Stable versioned reconciliation rule ID, such as `clinical-notes.identity-v1`; not SQL or executable code. |

```sh
bun --no-env-file "$PIQ_UPGRADE_TOOL" check-table-map \
  --project "$PIQ_PROJECT" --rehearsal "$PIQ_REHEARSAL" \
  --before legacy-tables.json --plan source-table-map.json
```

This command rejects missing, duplicate, unknown or stale source entries and
unclassified destinations. It reads reports only; it cannot convert, discard,
rebuild or approve anything. A green result proves map completeness against the
supplied evidence, **not** ownership correctness, field transforms, canonical
import support, live-source freshness, target reconciliation or cutover safety.
The app-owned converter and acceptance matrix must prove those separately.

## Verify the Toolkit

```sh
bun --no-env-file test docs-next/guides/practiceiq-upgrade/tools/preparation.test.ts
bun --no-env-file test docs-next/guides/practiceiq-upgrade/tools/table-map.test.ts
```

These tests use synthetic Git repositories and temporary SQLite only. The
toolkit's own tests do not establish that PracticeIQ has been converted.

## Related Guides and Next Steps

- [Conversion map](./conversion.md) defines the work the app agent must implement.
- [Application handoff](./agent-handoff.md) lists acceptance and cutover gates.
- [Backup boundaries](../../backend/migrations/backups.md) distinguishes backup,
  down migration and full restoration.
