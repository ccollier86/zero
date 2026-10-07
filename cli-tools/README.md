# Zero CLI setup for a Mac

This folder installs the same four Zero commands used to create and maintain
local projects. Give your collaborator access to the private
[CollabMDorg/zero repository](https://github.com/CollabMDorg/zero), have them clone
it, and ask Codex to follow [CODEX_SETUP.md](./CODEX_SETUP.md).

Keep this folder inside the full repository. The command implementations live
in [src/local-tools](../src/local-tools); the Mac installer uses that existing
implementation and generates executable commands for the recipient's paths.
No npm publication or separate CLI download is needed.

## Where the commands get Zero

`zero-new` and `zero-update` use a saved `.tgz` package built from the committed
**local `main` branch of this clone**. They do not download the framework from
GitHub or npm when invoked. New apps copy that package into
`.zero/framework/zero-framework.tgz` and depend on it through a relative `file:`
dependency. Installing an app still downloads its other dependencies from their
configured registries.

GitHub supplies the framework clone and later source updates. For this shared
setup, its remote must be **`https://github.com/CollabMDorg/zero.git`** (or the SSH
equivalent `git@github.com:CollabMDorg/zero.git`). Codex should inspect
`git remote -v` and use this organization's `main`, rather than another Zero
repository or npm's latest package.

The installer saves the absolute path of this clone in the installed tools'
`config.json`, and generates wrappers pointing to the installed runtime. Run
the installer on the recipient's Mac; copying someone else's installed command
files would retain that person's paths. If this clone or the installed tools
move, rerun the installer from the clone's new location.

## Install prerequisites

Use a Mac supported by Bun, with Git and Bun **1.3.14 or newer**; 1.3.14 is the
version pinned in this checkout's `packageManager`. Apple Silicon and Intel
Macs use the same setup script. The recipient also needs GitHub access to this
private organization repository.

If Git is unavailable, run this and finish Apple's installation dialog:

```sh
xcode-select --install
```

For a new Bun installation, this uses the framework's pinned version. The
[official Bun installation guide](https://bun.sh/docs/installation) also covers
Homebrew and adding Bun to your shell's PATH.

```sh
curl -fsSL https://bun.com/install | bash -s "bun-v1.3.14"
export PATH="$HOME/.bun/bin:$PATH"
bun --version
git --version
```

If a compatible Bun is already installed, keep it. These four tools can be
installed without first running `bun install` in the framework clone.

## Clone the organization repository

Choose a permanent location on this Mac. `~/Developer/zero` is an example;
Codex should honor the recipient's existing workspace/storage conventions.

With an authenticated Git/SSH configuration:

```sh
mkdir -p "$HOME/Developer"
git clone --branch main https://github.com/CollabMDorg/zero.git "$HOME/Developer/zero"
cd "$HOME/Developer/zero"
git remote -v
```

Alternatively, if GitHub CLI is available, use its
[browser login](https://cli.github.com/manual/gh_auth_login) and
[repository clone command](https://cli.github.com/manual/gh_repo_clone):

```sh
gh auth login --hostname github.com --git-protocol https --web
gh auth setup-git
gh repo clone CollabMDorg/zero "$HOME/Developer/zero" -- --branch main
cd "$HOME/Developer/zero"
```

The recipient completes their own browser login. Credentials belong to their
account; this kit contains no tokens or credentials.

For an existing dedicated Zero clone whose `origin` points elsewhere, change it
to this organization's repository before pulling updates:

```sh
git remote set-url origin https://github.com/CollabMDorg/zero.git
git remote -v
```

If that existing remote is still needed, preserve it and add a separate remote:

```sh
git remote add collabmd https://github.com/CollabMDorg/zero.git
git fetch collabmd main
```

Codex must inspect existing local work before updating `main`; use a new clone
when the existing checkout serves another project.

## Install the four commands

From the organization clone:

```sh
bash cli-tools/install-macos.sh
```

The installer packages committed local `main`, copies the launcher runtime,
records this Mac's paths, and installs these commands:

| Command | Purpose | Example |
| --- | --- | --- |
| `zero-new` | Create a new project and install its dependencies | `zero-new ../my-zero-app --name my-zero-app` |
| `zero-update` | Update an existing app to the selected saved framework | `zero-update ../my-zero-app --dry-run` |
| `zero-doctor` | Diagnose the framework installed in an app | Run `zero-doctor` inside the app |
| `zero-release` | Select/package local committed `main`, or inspect the saved package | `zero-release --status` |

It adds a managed PATH block to `~/.zshrc` (or `$ZDOTDIR/.zshrc`), preserving
other shell settings. Rerunning updates that block without duplicating it.
`--no-path` skips this step for people who manage their own PATH or use another
shell. Existing managed commands are backed up; unrelated files with these
names are rejected by the underlying installer.

| Installed item | Default location on the recipient's Mac |
| --- | --- |
| Executable commands | `~/.local/bin` |
| Launcher runtime and `config.json` | `~/.local/lib/zero-stable/runtime-*` |
| Saved framework packages and `stable.json` | `~/Library/Application Support/Zero/releases` |
| Temporary packaging/extraction | `~/Library/Caches/Zero/scratch` |

All four defaults can be overridden using `ZERO_LOCAL_BIN_DIR`,
`ZERO_LOCAL_TOOLS_DIR`, `ZERO_RELEASE_DIR`, and `ZERO_TOOLS_SCRATCH_DIR` before
running the installer. Set all four when using another storage layout. For
example, with an external development volume:

```sh
ZERO_LOCAL_BIN_DIR="/Volumes/Development/tools/bin" \
ZERO_LOCAL_TOOLS_DIR="/Volumes/Development/tools/lib/zero-stable" \
ZERO_RELEASE_DIR="/Volumes/Development/artifacts/zero/release" \
ZERO_TOOLS_SCRATCH_DIR="/Volumes/Development/tmp/zero" \
  bash cli-tools/install-macos.sh
```

The underlying installer also adds repository `post-commit`/`post-merge` hooks
to refresh the saved package when local `main` changes. It preserves custom
hooks; if it reports one, run `zero-release main` explicitly after pulling.
These are Git hooks in the framework clone.

## Verify and create the first project

Open a new Terminal window so it reads the PATH configuration:

```sh
command -v zero-new zero-update zero-doctor zero-release
zero-release --status
```

Status prints the saved version, source branch, commit, archive path and SHA-256.
Compare its commit to `git rev-parse main` in the framework clone.

To create a real app next to the framework clone:

```sh
cd "$HOME/Developer/zero"
zero-new ../my-zero-app --name my-zero-app
cd ../my-zero-app
bun run typecheck
zero-doctor
bun run dev
```

Open `http://localhost:3000` (or the port printed by the server). The starter is
public by default; account/auth features are configured in the generated app.
The app uses the packaged framework and its own source/configuration/data.
Stop the dev server with Ctrl-C. If Codex only needs to verify scaffolding,
use `zero-new <fresh-test-directory> --skip-install` and inspect the generated
`package.json`, `zero-release.json`, and `.zero/framework/zero-framework.tgz`.

## Get framework updates from CollabMDorg

In the framework clone, after reviewing any existing local work:

```sh
cd "$HOME/Developer/zero"
git switch main
git pull --ff-only origin main
zero-release main
zero-release --status
```

If the organization remote is named `collabmd`, use
`git pull --ff-only collabmd main` instead. `zero-release` never fetches or pushes
GitHub code itself; it packages the local branch, so pull first. Later
`zero-new` calls use the refreshed package. Existing apps keep their installed
version until you update them.

Stop an existing app's server, inspect the update, then apply it:

```sh
cd "$HOME/Developer/my-zero-app"
zero-update --dry-run
zero-update
bun run typecheck
zero-doctor
```

Do not use `--latest` to follow the private org: that belongs to a separate
registry workflow. Framework updates do not regenerate app source or migrate
databases automatically. See the [main update guide](../README.md#update-an-existing-app)
for application update details.

## Fix paths after moving the clone

Run setup again from the new permanent checkout location. Include the same
four path overrides if you customized them:

```sh
cd /actual/new/location/zero
bash cli-tools/install-macos.sh
```

This refreshes the installed runtime's `config.json` with the new `repo` path
and regenerates all command wrappers and managed hooks for this Mac. Keep the
clone available for `zero-release` and future framework pulls. The already
saved package can still serve `zero-new`/`zero-update` while the clone is
unavailable, but release refresh needs the correct local checkout.

If a command is not found, open a new Terminal and inspect `which -a zero-new`
for an older command shadowing the new one. If the saved release is missing or
its checksum fails, correct the checkout/paths and rerun setup or
`zero-release main`. If GitHub returns 404 for this private repository, verify
the recipient's organization/repository access and authenticated Git account.
