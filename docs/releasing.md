# Releasing Zero

Zero releases are explicit Git checkpoints with a package version, changelog
entry, commit, and tag.

## Package State

Zero is currently Bun-first: package exports and CLI bins point at TypeScript
source under `src/`, and `create-zero` reads the packaged
`examples/package-mode` starter. This supports local `file:` dependencies and
Bun package-mode apps today.

Before publishing to npm, verify the package `files` allowlist includes:

- `src`
- the selective `examples/guardian-fabric-proof` proof-app paths declared in
  `package.json` (not its runtime data, generated output, or build output)
- `examples/package-mode`
- `examples/native-auth`
- `docs`
- `docs-next` (the primary feature/agent documentation tree; review metadata and
  internal preparation material remain explicitly labeled)
- `scripts/install-local-tools.sh`
- `.env.example`
- `README.md`
- `llm.txt`
- `llms.txt`
- `CHANGELOG.md`
- `THIRD_PARTY_NOTICES.md`
- `LICENSE` (after the maintainers choose it)
- `tsconfig.json`

Before the first public npm release, the package contracts below must be
explicit rather than inferred from a developer machine:

- choose the project license, add the matching `LICENSE` file and
  `package.json.license`, and confirm the license is present in the tarball;
- retain Bun 1.3.14 as the encoded minimum or qualify and deliberately change
  it, then repeat the declared OS/architecture/filesystem matrix.

Zero 2.0 encodes Bun 1.3.14 for the source/local release channel. The project
license and broader public deployment matrix remain unresolved; do not publish
to npm until maintainers choose them explicitly and the exact tagged package
passes their qualification.

A later publish-hardening pass can move exports/bins to `dist`, but that should
be deliberate and covered by package-mode smoke tests.

`bun pm pack` can include allowlisted files that are still untracked. The
outside-tree package test proves the archive works, but only a fresh checkout
proves every required source and recipe was committed. Always repeat the
package test from the release commit before tagging, and verify the proof-app
paths plus every linked canonical document exist in that clean checkout.

## Current Supported Boundary

Release notes and package docs must distinguish supported runtime behavior from
the roadmap. Zero 2.0's source/local release boundary is:

- Auth implements `single/simple`, `single/advanced`, `multi/simple`, and
  `multi/advanced` through one app-local runtime and authorization kernel.
  Multi-tenant readiness applies to classified registered resources and the
  documented scoped built-in-service facades; it is not a claim that arbitrary
  raw SQL or an unclassified third-party plugin becomes tenant-safe.
- Default `createApp()` installs the managed framework-table Sync boundary.
  Direct `createSyncPlugin()` composition remains public/allow-all unless the
  app explicitly supplies WebSocket auth and read/write policy.
- Managed state and ephemeral topics use server-owned user/tenant namespaces;
  room topics revalidate membership. A raw/custom Sync composition is still
  responsible for supplying equivalent policy rather than treating a caller's
  topic string or room ID as authority.
- Auth services are app-local and concurrent-runtime isolation is covered by
  integration tests. Legacy no-argument `get*` helpers remain compatibility
  adapters and deliberately fail when they cannot select one unambiguous
  runtime.
- File-backed ReactiveDB uses a database-owned transactional log state,
  explicit row formats, an immutable seq-0 sentinel, and a monotonic pruning
  watermark, so multiple SQLite writers cannot collide, reuse a cleared
  cursor, or advance one for a rolled-back row. File-mode Sync automatically
  polls that durable log and
  dispatches local and external writes once in strict sequence order; a
  retention/corruption gap closes sockets so reconnect performs a clean
  snapshot. Snapshot/catch-up data and cursor come from one SQLite read view.
  Migration `020` adds a durable auth-authority revision, and managed
  auth polls it to revalidate sockets promptly after session/account/tenant/role
  mutations on another runtime. This supported replica boundary requires the
  runtimes to share the same file-mode SQLite database. `hot`, `ephemeral`,
  separate-database, cross-host message fanout, and ephemeral-topic replication
  are not provided by this mechanism.
- ReactiveDB Fabric is the supported local-root multi-database topology,
  separate from shared-file replica polling. It keeps the
  shared application database pinned, keeps Zero/Guardian state in its
  separate system database, and routes named or physical-tenant
  application Resources through bounded Bun subprocess actors with independent
  writer lanes, optional file/WAL readers, bounded hot placement, synchronous
  hybrid selection, durable receipts, exact tenant-Sync snapshot sessions,
  immutable image binding, and parent-crash liveness fencing. It is not a
  distributed database service: one app coordinator and its children own one
  local Fabric root. Fleet lifecycle/migration tooling, operator-grade
  coordinated fleet backup/restore, online placement changes, and distributed
  root ownership remain outside this boundary. Public npm and a wider
  package/OS matrix require the additional gates below; they do not make the
  documented local-root contract provisional.
- ReactiveDB database automations are supported for mutations which enter the
  tracked ReactiveDB boundary. Transaction functions are synchronous,
  same-source, bounded, and commit or roll back with the source change. Durable
  functions use a source-local transactional outbox, at-least-once delivery,
  fenced leases, restart recovery through the system-database source catalog,
  and authority-scoped server services. Their Torrent bridge targets one exact
  workflow instance with a permanent idempotency receipt. Direct `zero.sql`
  writes and migrations do not invoke these triggers, and external effects
  still require destination idempotency. See
  [ReactiveDB Database Functions And Triggers](./framework/reactive-database-automations.md).
- The system/application database split is a breaking upgrade for legacy
  combined layouts. Runtime and Doctor detect that layout read-only and fail
  closed with `requiredAction: 'split-system-database'`; they do not move data.
  Existing operators must back up, stop, perform their app-specific offline
  extraction/anchor seed, and verify both planes. A generic automatic splitter
  would be useful follow-on tooling, but its absence is not a release blocker
  for fresh separated-plane apps or deliberately migrated deployments. Release
  notes must state this boundary instead of implying an updater migrates data.
- Zero's managed routes, resources, Sync, and scoped services enforce their
  documented boundary. Deliberate raw SQL/database/service escape hatches are
  trusted server code outside that guarantee.
- TypeScript native auth is in the framework. The Rust/Tauri and Chrome auth
  repositories are functional, independently versioned `0.0.0` private
  previews and must not be presented as released framework packages.
- Verified-company-domain request admission is supported in Zero 2.0.
  Migration `021`
  binds domain evidence to the exact join-request revision, and approve/deny
  mutations require the reviewer to echo that loaded revision. Migration `022`
  makes the durable public-auth admission enum match all six runtime flows
  while preserving existing pseudonymous accounting rows. Migration `023`
  persists the installed auth profile/generation and transactionally adopts
  supported simple-to-advanced authority while fencing stale runtimes.
  Migration `024` adds the protected Administration Organization/customer
  discriminator and reconciliation. Migration `025` persists verified MFA
  assurance without treating legacy sessions as assured. Migration `026`
  freezes invitation issuance-time grant ceilings; existing pending invites
  without a snapshot must be reissued. Migration `027` persists the explicit
  authorization-registry version and semantic fingerprint. Same-profile
  permission/role semantic changes require a monotonic `registryVersion` bump;
  labels/descriptions do not. Same-version drift, rollback, corrupt markers,
  and retained-assignment role reactivation fail closed. Registry
  initialization/updates are system-audited and stale runtimes reject the new
  authority revision until restarted. The platform lifecycle UI is implemented;
  Migration `028` records idempotent administration user provisioning,
  migration `029` adds Guardian's hash-only API-key authority, migration `030`
  remains the frozen historical workflow graph release, and migration `031`
  upgrades that graph storage to tenant-safe interactions, per-scope definition
  names, immutable parent scope, and non-cascading observable relations.
  Migration `032` adds the private durable workflow-runtime owner generation
  used to exclude overlapping recovery and fence expired owners. Migration
  `033` adds topology-independent definition/version/draft and terminal-event
  delivery integrity triggers and is kept byte-identical on the maintained
  1.3 line. Migrations `034` and `035` add Storage Studio's management and
  shared-CAS state, `036` adds immutable Torrent system-event delivery
  receipts, and `037` adds the ReactiveDB automation source catalog. The
  managed registry belongs only to `systemDb`; application and Fabric tenant
  schemas use their own explicit provisioning path.
  break-glass, tenant-custom roles, broader populated-app discovery/migration
  tooling beyond exact pre-024 administration reconciliation,
  verified-domain autojoin/aliases/direct
  transfer, and upstream enterprise OIDC/SAML/SCIM are not part of the
  implemented release boundary. Registered resources now have an explicit
  server-owned client-exposure axis and optional field read/write/filter/sort
  allow-lists. Under shared-row isolation, multi-mode startup validates actual
  tenant-leading indexes, tenant-scoped business uniqueness, and composite
  tenant consistency for foreign keys between registered tenant Resources;
  physical tenant isolation validates the actor realm instead.
  Physical tenant storage is supplied only when the separate Fabric topology
  is explicitly configured; multi-tenant auth by itself remains shared-row.
- **Torrent** is Zero's supported durable, versioned workflow and orchestration
  system. The name is documentation vocabulary; `workflows` configuration,
  `/workflows/*`, `@zero/framework/workflows`, `zero.workflows`, `Workflow*`,
  `useWorkflow*`, `workflow_*`, `WORKFLOW_*`, and `workflows.*` remain the
  stable contracts. Code DSL and canonical IR definitions share immutable
  versions; database drafts are revision-fenced; recovery is guarded by one
  durable runtime owner generation per physical workflow database. Guardian
  authority is revalidated across dispatch and commit, Fabric activity data is
  projected through the scoped `ctx.zero.data` capability, and safe topology
  plus live ReactiveDB state supports visual monitoring. External activity
  effects remain at-least-once and must deduplicate `ctx.idempotencyKey`. Zero
  does not bundle a generic graph canvas/editor.

Guardian, Fabric, and Torrent are released together in Zero 2.0's committed
source/local channel after its frozen-tree checks pass. Do not widen that claim
to public npm, preview native packages, distributed Fabric, or unqualified
platforms merely because their neighboring code or design documents exist.

### Pre-024 Administration Organization adoption

For an existing multi-tenant database that has no protected administration
tenant after migration `024`, treat exact adoption as a reviewed data migration:

1. Stop all app runtimes and create a verified database backup.
2. Inspect the retained tenants, owner memberships, account eligibility, and
   audit provenance. Select the exact active tenant that is intended to operate
   the application; never choose from slug or creation order alone.
3. Set
   `auth.tenancy.administration.adoptTenantId = 'ten_exact_internal_id'` on every
   runtime using the database, then run the migration plan and start one
   candidate runtime.
4. Confirm startup emitted `ZERO_AUTH_ADMINISTRATION_TENANT_ADOPTED`, the audit
   trail contains `tenant.administration-adopted`, the selected row has
   `kind = 'administration'`, exactly one such row exists, and its owner can
   enter the packaged platform controls with the required MFA assurance.
5. Review every retained non-owner membership. Ordinary tenant/app roles now
   govern access to the Administration Organization's own app data realm but do
   not gain application authority; assign an administration-only role only to
   identities that should operate the platform control plane.
6. Start the remaining runtimes on the identical auth/authorization registry.
   Keeping the exact selector is an idempotent assertion; removing it after the
   verified rollout is safe because the protected kind is durable.

Unknown, inactive, mismatched, absent, or ambiguous targets must leave startup
failed. Do not work around that failure with direct SQL. Restore the backup or
correct the exact selector. This procedure is only for a pre-024 populated
`multi` installation; it is not a supported `single`-to-`multi` conversion.
See [Platform Administration Organization](./auth/platform-administration.md#adopting-the-administration-organization-on-a-pre-024-installation)
for the runtime contract.

## First change-log fence upgrade

The first release containing the versioned ReactiveDB log fence requires a
coordinated stop-all upgrade for every SQLite file used by Sync:

1. Stop every Zero runtime, worker, CLI command, test runner, and watch process
   that can access that file.
2. Verify no pre-fence process still holds or uses it.
3. Take a consistent backup with SQLite's online backup API, or checkpoint WAL,
   close that SQLite handle, copy the database, and verify the copy opens and
   passes `PRAGMA integrity_check`. Never rely on a main-file-only copy while
   writers are active; committed pages may still exist only in the WAL.
4. Start one fence-aware runtime and let startup install and validate the
   state singleton, seq-0 sentinel, retained legacy suffix, and triggers.
5. Start the remaining fence-aware runtimes.
6. Do not run or roll back to a pre-fence binary against the upgraded file.

This is mandatory even though the sentinel rejects the released default
constructor: an already-running released writer, or one explicitly configured
with `clearChangesOnStart: false`, writes its application row before its
separate legacy log insert. No in-place trigger can retroactively make that old
ordering atomic. Fence-aware versions do commit the row, sequence, log entry,
watermark, and prune together, so incompatible later writes roll back in full.

After cutover, `clearChangesOnStart: true` means “advance the watermark and
discard retained positive history”; it never resets/reuses the durable
sequence. A `ZERO_SYNC_LOG_*` startup error is a fail-closed signal to stop all
users of the file and inspect/restore the backup. Do not repair it by dropping
Zero's triggers or editing the internal log/state tables directly.

## Version Bump

Choose the next semver from the changes and compatibility impact. Set it once
in the release shell and use it for the package, changelog heading, commit, and
tag:

```sh
ZERO_RELEASE_VERSION=x.y.z
bun run version:bump -- "$ZERO_RELEASE_VERSION"
```

The script validates semver and updates `package.json`. It intentionally does
not create commits, tags, or changelog entries. Before committing, confirm the
printed package version, the new `CHANGELOG.md` heading, and the intended
`v${ZERO_RELEASE_VERSION}` tag all match. Never lower or reuse a published
version.

## Update Smoke Test

Before releasing, exercise the same non-scaffolding path existing apps use.
Stop the test app/dev server, install the saved-package wrappers, preview the
update, then update a disposable package-mode app:

```txt
bun run install:local-tools
zero-release --status
zero-update /path/to/test-app --dry-run
zero-update /path/to/test-app --check
```

These wrappers use the package saved from committed local `main`. Refresh it
explicitly with `zero-release` after a release lands on `main`; the installed
repository-local post-commit/post-merge hooks also refresh it on that branch.
`main` is the local stable-channel policy, not a substitute for the verification
gates in this document. Neither feature commits nor uncommitted files enter the
archive. The saved package records its version, full commit, and SHA-256; an app
records the same provenance in `zero-release.json`. Existing apps keep their
own package until explicitly updated. Failed publication retains the last
saved package, and missing/corrupt archives fail closed.

### Maintained 1.3 compatibility line

`release/1.3` is the maintained compatibility line for applications that must
retain the legacy combined-database topology. Its 1.3.3 patch carries the
topology-independent Torrent correctness, privacy, migration, and durable
runtime-ownership fixes plus the reusable theme, streaming-text, and table
surfaces without Guardian multi-tenancy, ReactiveDB Fabric, or the Zero 2.0
system/application database split.

The `zero-update` wrapper intentionally follows committed `main`, so it will
install the current Zero 2.x release. Do not use that stable wrapper for an app
that is staying on 1.3. Instead, check out the exact `v1.3.3` tag (or the
maintained `release/1.3` branch), inspect the plan, and use the explicit local
source path:

```txt
bun run zero update --project /path/to/legacy-app --local /path/to/zero-1.3 --dry-run
bun run zero update --project /path/to/legacy-app --local /path/to/zero-1.3 --check
```

This is a compatibility patch, not an automatic migration to 2.0. Keep the
legacy app on the 1.3 line until its database split and Guardian/Fabric adoption
have been deliberately designed, backed up, rehearsed, and verified. Follow the
[Torrent upgrade guide](./workflows.md#upgrading-existing-torrent-applications)
for the exact package, migration, registration, split, and rollback sequence.

For deliberate testing of an unreleased checkout, use
`zero update --project /path/to/test-app --local /path/to/zero-platform` instead.
The test app must already have a text `bun.lock`, including for the dry-run, so
the managed archive and dependency resolution can be updated with deterministic
rollback. Exercise this against a populated existing-app fixture: keep its
current `bun.lock`, installed package tree, and managed `.zero/framework`
archive in place. A normal local/saved-package update uses a private, unique
staged archive reference so Bun reads the replacement framework manifest and
refreshes the framework's resolved transitive dependency metadata. It then
restores the app's exact `package.json` bytes, canonicalizes only the managed
framework reference and archive integrity in `bun.lock`, and removes the staged
archive. A targeted canonical install must leave that resolved lock byte-for-byte
unchanged, and the installed framework's package-owned files must exactly match
the canonical archive. This final binding check prevents a later frozen install
from reusing the previous archive payload.

Local/saved-archive rollback must also restore the extracted canonical binding,
not only the old archive, lock and installed top-level package. After restoring
the original declarations and frozen lock, the updater uses a targeted,
script-free `bun update @zero/framework --frozen-lockfile --force --no-cache`
(with `--ignore-scripts --no-progress`), then restores and verifies the exact
snapshot bytes. Registry rollback keeps its ordinary frozen install. Qualify
a subsequent ordinary frozen install with the populated installed tree and
cache intact, checking the old framework's complete package-owned file hashes
and unchanged app/manifest/lock/archive bytes after every injected failure
stage. This does not claim that Bun's general shared local-archive extraction
cache behavior is fixed; parallel synthetic archive fixtures use independent,
retained package caches so their baselines cannot select each other's payloads.

The updater must not delete or regenerate the whole app lockfile, broadly
re-resolve unrelated dependencies, or require operators to remove
`node_modules`, `bun.lock`, or the managed cache first. It must directly manage
only the `@zero/framework` dependency and its resolved package metadata, the
local `.zero/framework/zero-framework.tgz` cache when applicable, and
package-manager install state. The local archive is ignored and is restored
from the saved release by `zero-update`. A genuinely clean clone with no
managed cache remains supported, and `--dry-run` reports pending work without
creating it. Existing symlinks or wrong-type entries at managed cache paths are
rejected.

Without `--check`, app source, config, environment files, databases, and
storage must remain untouched and no app-defined scripts may run. `--check`
executes the disposable app's existing typecheck and Doctor scripts; inspect
them first because their side effects are outside updater rollback. Zero itself
must not directly invoke migration tooling. Run
`bun run migrate:plan` separately and intentionally against the correct test
database or a safe copy; migration planning may open or create configured
database or ledger files.

Never use `create-zero --force` or `zero-new --force` for this smoke test. Those
commands regenerate scaffold targets and are not updaters.

## Private Preview Source Fixtures

The core repository tracks `sdk/README.md`, not the separately versioned private
SDK checkouts. The native documentation example check currently imports the
Chrome preview's real source. When qualifying a fresh core checkout, admit an
exact clean Chrome SDK commit as a separate source fixture beneath
`sdk/zero-chrome-auth/`; do not copy a developer's dependency tree, generated
output or Git metadata. A Git archive with that explicit prefix provides the
tracked files only. Validate its paths before extraction into the disposable
checkout, and record its commit, tree and archive hash separately from the core
release commit and package hash.

The core's native-example check maps framework imports to the actual core source.
Its compiler dependencies and the Chrome preview's current ten fake-broker unit
files do not require the SDK's own `node_modules`. A standalone SDK package/build
check is a different gate and needs its own frozen dependencies; its development
framework fixture is not evidence against the real core release. The Rust/Tauri
preview is not imported by this TypeScript documentation check.

The source/local qualification inventory includes any admitted preview tests and
reports them explicitly. Do not silently discard them through Git-ignore rules,
and do not claim those private `0.0.0` previews were shipped in the framework
archive or published as part of its release. A checkout without those separate
fixtures has a different inventory and must report that prerequisite, not a
fabricated whole-suite pass.

## Release Checklist

1. Freeze the supported/preview/roadmap boundary above. Audit README, Start
   Here, SDK/reference, Guardian, Fabric, Torrent, resource, Sync, and
   generated-app docs for
   the same wording; examples must not rely on client filters as authorization
   or caller-provided tenant/database selectors as physical routing authority.
2. Confirm the release version and encoded Bun requirement, then update
   `CHANGELOG.md` with the release date and notable changes, including
   compatibility or migration requirements. A public npm release must also
   resolve the license and wider platform qualification in **Package State**;
   an explicitly local/source release must keep those public-package gates
   visible instead of pretending they passed.
   For an authorization-registry semantic change, review the manifest diff,
   increment `auth.authorization.registryVersion`, verify retired-role
   assignments were explicitly removed/replaced, and plan a coordinated
   runtime restart. Never roll the version backward.
   Framework maintainers must also increment
   `AUTHORIZATION_EVALUATOR_VERSION` whenever evaluator or grant semantics
   change without an otherwise fingerprinted registry-shape change. Call that
   compatibility fence out in release notes: installed apps acknowledge it by
   deploying a higher `auth.authorization.registryVersion`; mixed framework
   semantics then fail closed instead of sharing one apparent manifest.
3. Run the update smoke test above against a disposable generated app.
4. Run verification from the candidate checkout:

```txt
bun run typecheck
bun run test:package
bun run pdf:install
bun run pdf:status
bun run test --timeout 120000
bun run build
bun audit
git diff --check
```

   Run browser/PDF installation checks in the disposable release environment;
   they may download runtime assets. Do not point release verification at a
   production app database or Storage root.

   The canonical suite discovers every normal Bun test/spec file, including
   actor-entry tests, and runs each exactly once in a fresh Bun OS process,
   with at most four concurrent children. `test:parallel` is a compatibility
   alias for this same runner, not Bun's reused-worker mode. The default
   per-test timeout is 120 seconds; `--timeout 120000` is forwarded to every
   child. Existing explicit shorter test deadlines and native/concurrency
   assertions are unchanged. Each file also has a separate 15-minute process
   deadline and at most one second of termination grace; timeout, native signal,
   spawn failure or nonzero exit fails the run. No files are retried or excluded
   because they previously crashed.

   Ten explicitly catalogued full-framework archive consumers share one
   admission slot because their fresh installation and compilation compete for
   the same external package cache and cold-I/O budget. The scheduler admits
   ordinary queued files around a waiting archive consumer, retaining up to
   four total fresh processes. The slot stays owned through process, descendant
   and output retirement. This changes admission overlap, not inventories,
   assertions, deadlines, cleanup requirements or failure handling. Review
   `src/testing/test-suite-resources.ts` when adding a full-framework installed
   consumer; unrelated package metadata, tiny updater archives, source-only
   compiler fixtures and browser tests are not classified automatically.

   `bun run test --list` prints the exact deterministic inventory without
   execution. Status and final per-file accounting are JSON lines on stdout;
   tagged child output goes to stderr. Optional path-substring selectors and
   bounded `--concurrency`/`--file-timeout` are documented by `bun run test --help`.
   Unsupported worker, isolate, retry, skip, snapshot-update and coverage flags
   fail explicitly. Discovery includes all eight normal JS/TS loader extensions
   and case-insensitive test/spec suffixes. It excludes `node_modules` and hidden
   directory components, not hidden file basenames, `dist`/`build`, Gitignored
   source or bunfig feature exclusions. This retains the complete release
   baseline, including the standalone SDK tests.

   On macOS/Linux each admitted child owns a new POSIX session/process group.
   Root interruption/deadline sends signals only to those captured groups;
   `--no-orphans` is an additional parent-death fence, not the sole cleanup
   mechanism. After leader exit, group retirement allows 250ms for an orderly
   close, then kills any leftover group members and verifies retirement for
   at most one second. A leftover group is recorded as a failure, never cleaned
   up into a pass. No unrelated or externally owned group is signaled. The runner
   also limits post-exit output draining to one second: inherited pipes or a
   failing output sink cannot hold the suite indefinitely. Incomplete output or
   cleanup failure is recorded and fails the run. The runner cancels only its
   own stream readers, without hunting for children that moved to another group.
   An incomplete drain also reports payload-free per-channel progress: bytes and
   chunks read, EOF, pending read versus output consumer, and relative pending
   duration. These diagnostics do not turn an incomplete result into a pass or
   change the one-second drain boundary.

   CLI emission owns one Bun `FileSink` per standard descriptor and serializes
   complete records through one write/flush lane, including redirected merged
   regular-file logs. Live and queued emission use the existing maximum file
   budget and owned cancellation, not a new one-second running-output limit.
   The unchanged one-second post-exit drain can retire an unfinished active
   consumer. Ordinary events retire with root cancellation; only the final
   summary and failure emission, after worker retirement, use a fresh one-second
   retirement signal. Final sink retirement is separately bounded at one second. Native
   synchronous I/O cannot be preempted by JavaScript timers. The CLI awaits final
   close and unreferences its own sinks. A poisoned console also preserves a
   payload-free failure receipt under an owned `zero-test-suite-failure-*`
   directory in the normal temporary root (honoring `TMPDIR`); the inventory
   advertises both the first receipt and container before file execution.
   Subsequent stages use separate immutable receipt files, so timed-out writes
   cannot replace newer evidence. It records phases, triggers,
   counters and allowlisted native errno after runner cleanup, never child text
   or raw error messages. Successful runs remove their empty diagnostic directory
   within the same retirement boundary. Failed or timed-out cleanup retains a
   replacement receipt in a distinct owned directory (identified by the runner
   PID); late removal of the initial directory cannot delete that evidence.
   Missing/incomplete output or a failed receipt still fails the run. This incremental
   writer does not diagnose an intermittent Bun runtime cause or relax any test,
   post-exit drain, inventory or no-retry requirement.

   This process harness does not add support for raw SQLite use inside nested JavaScript
   Workers; tests of production subprocess concurrency retain their own gates.

   Private native-fixture scratch roots honor `TMPDIR`. Failed macOS binary
   evidence uses the existing canonical external diagnostics directory when
   available, otherwise a dedicated temporary diagnostics directory; it does
   not create another workstation's `/Volumes/code-bank` tree. Absolute
   `ZERO_MAC_NATIVE_SCRATCH_ROOT` and `ZERO_MAC_NATIVE_ARTIFACTS_ROOT` overrides
   are available for qualification hosts. Cleanup admits only captured fixture
   children, never a root or symbolic-link directory. Failed-binary retention
   remains diagnostic evidence, not a retry or substitute passing test.

   For a candidate containing Fabric, also run the focused actor protocol,
   coordinator, file/root identity, liveness/orphan, subprocess, Resource CRUD,
   DataQuery, tenant-Sync, observability, and Doctor suites on every supported
   OS/filesystem combination. Exercise file, hot, and hybrid placement; at
   least two tenant files writing concurrently; same-file WAL read/write;
   receipt replay and permanent capacity; process crash/restart fencing; and
   an authenticated combined app with two tenants whose rows and realtime
   streams cannot cross.

   For a candidate containing Torrent, run the complete workflow suite plus
   durable owner/takeover, retry/deadline collision, pause/cancel/event,
   database-definition revision-race, restart recovery, Guardian authority,
   Fabric tenant-data, live-monitor, Sync redaction, and package-export tests.
   Exercise at least one authenticated tenant workflow end to end in the
   packaged Guardian/Fabric/Torrent proof application.

5. Commit the release:

```sh
git add -A
git commit -m "chore: release zero platform ${ZERO_RELEASE_VERSION}"
```

6. Confirm `git status --short` is empty. Check out the release commit in a
   fresh clone or temporary worktree, install
   its locked dependencies, and run:

```txt
bun install --frozen-lockfile
bun run typecheck
bun run test:package
bun run test --timeout 120000
bun run build
bun audit
```

   This is the final guard against a package that passed locally by including
   an untracked native/auth/migration file. Inspect the packed file list and
   run the outside-tree package smoke test against the archive produced by this
   exact commit.

7. Tag the verified release:

```sh
git tag -a "v${ZERO_RELEASE_VERSION}" -m "Zero Platform ${ZERO_RELEASE_VERSION}"
```

Confirm the tag points at the fresh-checkout commit and that its version and
changelog entry still match:

```sh
git show --no-patch --decorate "v${ZERO_RELEASE_VERSION}"
bun -e 'console.log((await Bun.file("package.json").json()).version)'
```

For a source/local release, fast-forward `main` to the verified release commit,
push the maintained release branch and `main`, push the annotated tag, then
refresh the committed-main stable package with `zero-release`. This publishes
the exact Git checkpoint used by `zero-new` and `zero-update`; it does not make
an npm-publication or wider-platform support claim.

## npm Publication

The package is scoped, so a public npm release must explicitly use public
access unless `package.json.publishConfig.access` has first been set and
verified. Authenticate with the intended npm account and verify registry and
tag ownership before publishing.

Pack the exact tagged checkout into a new dedicated directory, inspect it, and
dry-run npm against that archive:

```sh
ZERO_RELEASE_PACK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/zero-framework-release.XXXXXX")"
ZERO_RELEASE_ARCHIVE="$ZERO_RELEASE_PACK_DIR/zero-framework-${ZERO_RELEASE_VERSION}.tgz"
bun pm pack --destination "$ZERO_RELEASE_PACK_DIR" \
  --filename "zero-framework-${ZERO_RELEASE_VERSION}.tgz" \
  --ignore-scripts
tar -tzf "$ZERO_RELEASE_ARCHIVE"
npm whoami
npm publish "$ZERO_RELEASE_ARCHIVE" --access public --dry-run
```

The tarball listing must contain the selected `LICENSE`, package docs, source,
CLI bins, the `package-mode` and `native-auth` example directories, and the
selectively allowlisted `guardian-fabric-proof` slice. It must exclude secrets,
app data, databases, Storage roots, caches, and standalone preview SDK
repositories.
Publish that same inspected archive, supplying npm's OTP/provenance options as
required by the release account:

```sh
npm publish "$ZERO_RELEASE_ARCHIVE" --access public
```

Do not rerun publication while registry propagation is merely delayed. First
verify the exact version and integrity:

```sh
npm view "@zero/framework@${ZERO_RELEASE_VERSION}" version dist.integrity --json
```

Then generate a disposable app through the package's actual scoped-package
binary, install it, and run its checks:

```sh
bunx -p "@zero/framework@${ZERO_RELEASE_VERSION}" create-zero zero-release-smoke
cd zero-release-smoke
bun install
bun run typecheck
bun run doctor
bun run build
```

Only after registry verification and the post-publish smoke test should npm
release notes be published. If the commit and annotated tag were not already
pushed as a source/local release, push those exact objects now; never retag a
different commit. The shorter `bunx create-zero` spelling is valid only if a separate
registry package owns that name; the scoped framework package itself requires
`bunx -p @zero/framework create-zero`.

Published versions are immutable. If a release is defective, deprecate the
specific version with a useful message, fix forward with a new patch version,
and update release notes. Do not move/reuse its tag or overwrite its version:

```sh
npm deprecate "@zero/framework@${ZERO_RELEASE_VERSION}" \
  "Known issue: <brief impact>; upgrade to <fixed-version>."
```

Use npm unpublish only for a genuine security/legal emergency and only after
checking the registry's current policy; it is not the normal rollback path.
