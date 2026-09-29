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
- `examples/package-mode`
- `examples/native-auth`
- `docs`
- `scripts/install-local-tools.sh`
- `.env.example`
- `README.md`
- `llm.txt`
- `llms.txt`
- `CHANGELOG.md`
- `LICENSE` (after the maintainers choose it)
- `tsconfig.json`

For the first public release, two package contracts must be chosen rather than
inferred from a developer machine:

- choose the project license, add the matching `LICENSE` file and
  `package.json.license`, and confirm the license is present in the tarball;
- choose and test the minimum supported Bun version, then encode it in package
  metadata (`engines` and, where appropriate, `packageManager`) and state it in
  the README.

Neither decision is currently encoded in the repository. Do not publish until
the maintainers make both choices explicitly.

A later publish-hardening pass can move exports/bins to `dist`, but that should
be deliberate and covered by package-mode smoke tests.

`bun pm pack` can include allowlisted files that are still untracked. The
outside-tree package test proves the archive works, but only a fresh checkout
proves every required source and recipe was committed. Always repeat the
package test from the release commit before tagging.

## Current Public Boundary

Release notes and package docs must distinguish supported runtime behavior from
the roadmap. For this unreleased candidate:

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
- ReactiveDB Fabric is implemented on the unmerged multi-database child branch
  as a separate topology from shared-file replica polling. It keeps the
  default/control database pinned and routes named or physical-tenant
  application Resources through bounded Bun subprocess actors with independent
  writer lanes, optional file/WAL readers, bounded hot placement, synchronous
  hybrid selection, durable receipts, exact tenant-Sync snapshot sessions,
  immutable image binding, and parent-crash liveness fencing. It is not a
  distributed database service: one app coordinator and its children own one
  local Fabric root. Fleet lifecycle/migration tooling, operator-grade
  backup/restore, online placement changes, and the supported package/OS matrix
  remain outside this candidate boundary. Do not present Fabric as released
  until the architecture document's gates, the checks below, and a combined
  multi-tenant acceptance app pass.
- Zero's managed routes, resources, Sync, and scoped services enforce their
  documented boundary. Deliberate raw SQL/database/service escape hatches are
  trusted server code outside that guarantee.
- TypeScript native auth is in the framework. The Rust/Tauri and Chrome auth
  repositories are functional, independently versioned `0.0.0` private
  previews and must not be presented as released framework packages.
- Verified-company-domain request admission is implemented in this unreleased
  tree but remains subject to the same release gates below. Migration `021`
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

Do not describe the four auth profiles or Fabric as released merely because
their code is present in these branches. They become the public boundary only
after the auth implementation checklist, Fabric architecture gates,
cross-surface suite, combined acceptance app, package smoke test, clean-clone
verification, license choice, and minimum-Bun decision all pass.

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
5. Review every retained non-owner membership and deliberately assign an
   administration-only role where access is intended. Customer-only retained
   roles do not gain application authority.
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

For deliberate testing of an unreleased checkout, use
`zero update --project /path/to/test-app --local /path/to/zero-platform` instead.
The test app must already have a text `bun.lock`, including for the dry-run, so
the local archive's integrity can be refreshed safely. Keep that lockfile in a
clean-clone smoke fixture, remove its
ignored `.zero/` cache and `node_modules`, and confirm `--dry-run` leaves them
absent before the mutating update recreates the managed archive and install.
Also confirm existing symlinks or wrong-type entries at managed cache paths are
rejected. The updater must directly manage only the
`@zero/framework` dependency, the local
`.zero/framework/zero-framework.tgz` cache when applicable, and package-manager
install state. The local archive is ignored and is restored from the saved
release by `zero-update`. Without `--check`, app source, config, environment files,
databases, and storage must remain untouched and no app-defined scripts may
run. `--check` executes the disposable app's existing typecheck and Doctor
scripts; inspect them first because their side effects are outside updater
rollback. Zero itself must not directly invoke migration tooling. Run
`bun run migrate:plan` separately and intentionally against the correct test
database or a safe copy; migration planning may open or create configured
database or ledger files.

Never use `create-zero --force` or `zero-new --force` for this smoke test. Those
commands regenerate scaffold targets and are not updaters.

## Release Checklist

1. Freeze the supported/preview/roadmap boundary above. Audit README, Start
   Here, SDK/reference, auth, Fabric, resource, Sync, and generated-app docs for
   the same wording; examples must not rely on client filters as authorization
   or caller-provided tenant/database selectors as physical routing authority.
2. Resolve the license and supported-Bun decisions in **Package State**, and
   update `CHANGELOG.md` with the release date and notable changes, including
   compatibility or migration requirements.
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

   For a candidate containing Fabric, also run the focused actor protocol,
   coordinator, file/root identity, liveness/orphan, subprocess, Resource CRUD,
   DataQuery, tenant-Sync, observability, and Doctor suites on every supported
   OS/filesystem combination. Exercise file, hot, and hybrid placement; at
   least two tenant files writing concurrently; same-file WAL read/write;
   receipt replay and permanent capacity; process crash/restart fencing; and
   an authenticated combined app with two tenants whose rows and realtime
   streams cannot cross.

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
CLI bins, and both example directories, and must exclude secrets, app data,
databases, Storage roots, caches, and standalone preview SDK repositories.
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

Only after registry verification and the post-publish smoke test should the
release commit and annotated tag be pushed together and release notes be
published. The shorter `bunx create-zero` spelling is valid only if a separate
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
