# Standalone Client SDK Checkouts

This parent-owned file documents the local development boundary for client SDK
repositories that may sit under `sdk/`. A normal Zero clone or packed framework
does not need either child checkout. Canonical Zero documentation therefore
describes their public contracts and release status without linking into these
ignored directories.

## Repository ownership

| Local path | Intended packages | Owner and current release state |
|---|---|---|
| `sdk/zero-native-auth/` | Rust `zero-native-auth`, Tauri v2 `tauri-plugin-zero-auth`, and a future guest binding | Independent functional `0.0.0` preview: working OIDC/PKCE engine, rotating sessions, tenant sessions, authenticated HTTP, and deny-by-default Tauri commands; unpublished and awaiting platform adapters/certification, ownership, and a license |
| `sdk/zero-chrome-auth/` | `@zero/chrome-auth` | Independent private `0.0.0` Chrome MV3 preview; functional source, but not releasable until its framework peer is versioned and real-Chrome/security gates pass |
| Zero repository root | `@zero/framework`, including the implemented TypeScript `@zero/framework/native` entry point | Parent framework history, package, create/update tools, server provider, and canonical docs |

Each child owns its own `.git` directory, dependencies, lockfile, versions,
tests, tags, remote, release notes, package ownership, and publication decision.
The children are neither Git submodules nor vendored framework source. A parent
Zero commit does not capture or back up their contents.

## What isolation means

The parent `.gitignore` has exact root-anchored entries for both child paths.
Zero's Bun configuration excludes them from root test discovery. Framework
package tests reject SDK/Cargo/crate files in the tarball and in generated
apps. Normal tooling behaves as follows:

| Operation | Child SDK behavior |
|---|---|
| `git status`, commit, or push at the Zero root | Does not include either child |
| `bun run test`, framework typecheck, or package build | Does not discover child tests/dependencies as parent work |
| `bun run test:package` / framework packing | Excludes both child repositories |
| Default `create-zero` / `zero-new`, including `--local` | Does not copy either child into a new app |
| `zero update` / `zero-update` | Does not add, update, or remove either child in an application |
| Parent framework version bump | Does not version either child package |

This isolation is intentional. Running the Zero command from another project
must never drag an SDK development repository, Cargo target directory, Chrome
fixture, or nested Git history into that project.

Two explicit escape hatches still do exactly what the caller requests. A
custom `create-zero --template <directory>` copies that template's contents,
so do not point it at a tree that contains SDK source unless that is
intentional. The scaffolder omits the template root's `.git` and rejects any
nested Git repository. Likewise, a `--zero file:<path>` package source
deliberately asks Bun to consume that checkout. The built-in template, normal
published-package create, `--local` pack, `zero add`, and `zero update` paths
remain isolated by the framework package allowlist.

## Check status in the correct repository

Run parent and child status separately:

```sh
git status --short

git -C sdk/zero-native-auth status --short
git -C sdk/zero-native-auth branch --show-current
git -C sdk/zero-native-auth remote -v

git -C sdk/zero-chrome-auth status --short
git -C sdk/zero-chrome-auth branch --show-current
git -C sdk/zero-chrome-auth remote -v
```

Do not use `git add -f` from the parent to bypass the boundary. If a child is
meant to become a tracked dependency later, choose an explicit distribution
model—published package, separately cloned repository, or deliberately added
submodule—in a reviewed parent change. Do not silently turn the ignored
development layout into framework content.

## Backup responsibility

Initializing `.git` is not a backup. Isolation setup does not create an initial
commit, choose repository ownership, create a remote, or push anything. Before
substantial work, the SDK owner must, from inside each child:

1. Review the complete child status and generated-file ignores.
2. Choose the license/package ownership required for that SDK.
3. Create an intentional initial commit.
4. Configure the correct remote without copying credentials into config or
   documentation.
5. Push the branch and verify it can be cloned independently.

Until those steps are complete, the parent repository cannot recover the child
contents.

## Destructive clean warning

Do **not** run this from the Zero root:

```sh
git clean -ffdx
```

The double force can delete ignored nested Git repositories, including both SDK
checkouts, their uncommitted source, and dependency/build directories. A normal
parent status will not warn that those ignored files are about to be removed.
Back up and push each child independently before any aggressive clean. Prefer a
dry run with the exact intended scope, and run child-specific cleanup commands
inside the relevant child repository.

## Development and release checks

Run checks from the repository that owns them:

```sh
# Rust/Tauri functional private preview
cd sdk/zero-native-auth
cargo fmt --all -- --check
cargo test --locked --workspace --all-targets
cargo clippy --locked --workspace --all-targets -- -D warnings
RUSTDOCFLAGS="-D warnings" cargo doc --locked --workspace --no-deps

# Chrome private preview
cd ../zero-chrome-auth
bun install --frozen-lockfile
bun run check
```

Passing these checks does not change preview status. The Rust/Tauri repository
implements its platform-neutral auth engine and Tauri ACL surface, but still
needs audited OS vault/browser/callback adapters, real-platform lifecycle and
packaging tests, dependency/security review, license, ownership, and a release
version. The Chrome repository still needs a released compatible
`@zero/framework/native` peer range, real-browser lifecycle tests, security
review, package ownership, and an intentional publication decision.

Parent release notes may describe compatibility, but each SDK must publish its
own version and declare its supported Zero framework range. Never infer client
compatibility solely from matching version numbers.
