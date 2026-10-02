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
- `THIRD_PARTY_NOTICES.md`
- `tsconfig.json`

A later publish-hardening pass can move exports/bins to `dist`, but that should
be deliberate and covered by package-mode smoke tests.

`bun pm pack` can include allowlisted files that are still untracked. The
outside-tree package test proves the archive works, but only a fresh checkout
proves every required source and recipe was committed. Always repeat the
package test from the release commit before tagging.

## Version Bump

Use the version bump script for package metadata:

```txt
bun run version:bump -- 1.0.0
```

The script validates semver and updates `package.json`. It intentionally does
not create commits, tags, or changelog entries.

## Update Smoke Test

Before releasing, exercise the same non-scaffolding path existing apps use.
Stop the test app/dev server, install the checkout-bound wrappers, preview the
update, then update a disposable package-mode app:

```txt
bun run install:local-tools
zero-update /path/to/test-app --dry-run
zero-update /path/to/test-app --check
```

The explicit equivalent is
`zero update --project /path/to/test-app --local /path/to/zero-platform`.
The test app must already have a text `bun.lock`, including for the dry-run, so
the local archive's integrity can be refreshed safely. Keep that lockfile in a
clean-clone smoke fixture, remove its
ignored `.zero/` cache and `node_modules`, and confirm `--dry-run` leaves them
absent before the mutating update recreates the managed archive and install.
Also confirm existing symlinks or wrong-type entries at managed cache paths are
rejected. The updater must directly manage only the
`@zero/framework` dependency, the local
`.zero/framework/zero-framework.tgz` cache when applicable, and package-manager
install state. The local archive is ignored and should be regenerated from the
release checkout. Without `--check`, app source, config, environment files,
databases, and storage must remain untouched and no app-defined scripts may
run. `--check` executes the disposable app's existing typecheck and Doctor
scripts; inspect them first because their side effects are outside updater
rollback. Zero itself must not directly invoke migration tooling. Run
`bun run migrate:plan` separately and intentionally against the correct test
database or a safe copy; migration planning may open or create configured
database or ledger files.

Existing workflow applications should follow the
[Torrent upgrade guide](./workflows.md#upgrading-existing-torrent-applications)
for the 1.3.3 package/migration sequence, registration and recovery checks,
the later 2.0 database-split boundary, and rollback requirements.

Never use `create-zero --force` or `zero-new --force` for this smoke test. Those
commands regenerate scaffold targets and are not updaters.

## Release Checklist

1. Update `CHANGELOG.md` with the release date and notable changes.
2. Run the update smoke test above against a disposable generated app.
3. Run verification:

```txt
bun run typecheck
bun run test:package
bun run pdf:install
bun run pdf:status
bun test
bun run build
git diff --check
```

4. Commit the release:

```txt
git add -A
git commit -m "chore: release zero platform 1.0.0"
```

5. Check out the release commit in a fresh clone or temporary worktree, install
   its locked dependencies, and run:

```txt
bun install --frozen-lockfile
bun run typecheck
bun run test:package
```

   This is the final guard against a package that passed locally by including
   an untracked native/auth/migration file.

6. Tag the verified release:

```txt
git tag -a v1.0.0 -m "Zero Platform 1.0.0"
```

Push the commit and tag together when publishing the release.
