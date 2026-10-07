# Set up Zero commands for this Mac

Paste this into Codex with this repository open:

> Set up this repository's Zero CLI commands on my Mac. Read
> `cli-tools/CODEX_SETUP.md` and `cli-tools/README.md`, install the prerequisites
> that are missing, run the Mac installer using my local checkout and storage
> locations, verify the commands in a fresh shell, and create and check a small
> starter app. Use `CollabMDorg/zero` for framework source and updates.

## Instructions for Codex

The intended outcome is working `zero-new`, `zero-update`, `zero-doctor` and
`zero-release` commands on the recipient's Mac, plus evidence that a new app
can be created with the saved package. Carry setup through verification.

1. Read [README.md](./README.md) and inspect the Mac's Git, Bun, shell, PATH,
   existing Zero commands, workspace location and storage conventions. Use the
   recipient's directories, not the original author's `/Volumes/code-bank` or
   home directory. If compatible Bun is already installed, keep it. This
   checkout pins Bun 1.3.14 and requires at least that version. Install missing
   prerequisites using the README; an Apple installation dialog or GitHub
   browser login may require the recipient to complete that step.
2. Inspect `git remote -v`. The source for this shared setup is
   `https://github.com/CollabMDorg/zero.git` or its SSH equivalent. If starting
   fresh, clone that private repo on `main` into a permanent workspace
   location. If reusing a dedicated clone, change its source remote to the org
   or add `collabmd` while preserving a remote the recipient still needs.
   Use the authenticated recipient account. A downloaded ZIP is insufficient:
   release packaging needs Git history and a local `main` branch.
3. Inspect local work and ensure local `main` contains the intended org
   version. For a clean dedicated checkout use `git switch main` and
   `git pull --ff-only <organization-remote> main`. Preserve existing work and
   resolve a divergent branch deliberately; a fresh clone is often simpler.
4. Run `bash cli-tools/install-macos.sh` from that clone. It chooses normal
   per-user Mac directories and reuses `src/local-tools/install.ts`. If this
   Mac has an established external storage policy, set all four path overrides
   documented in the README. The installer is authorized by this setup request
   to install the four commands and its managed zsh PATH block. For another
   shell use `--no-path` and add the command and Bun directories to that shell's
   own configuration. Preserve unrelated settings and command files.
5. Verify the generated runtime `config.json` records the **actual absolute
   framework checkout path on this Mac**, along with the intended release and
   scratch directories. Generated executable wrappers should point to this
   Mac's installed runtime. These commands use local saved framework archives;
   they do not need a hard-coded GitHub download URL. Their source updates must
   still be pulled from the `CollabMDorg/zero` remote. Reinstall from the new
   location if the checkout moves, rather than copying another person's
   wrappers or patching four path strings by hand.
6. In a fresh interactive zsh (`zsh -ic`, respecting `ZDOTDIR`), confirm Bun and
   all four commands resolve to the intended install. Use `which -a` if an old
   command shadows them. Check each command's `--help` and
   `zero-release --status`. Confirm status identifies `main` and the same
   commit as `git rev-parse main` in this clone.
7. Use a fresh test directory under the recipient's workspace or scratch
   location. Run `zero-new <directory> --name zero-setup-check`, install the
   app's dependencies, run `bun run typecheck` and `zero-doctor` inside it,
   then start `bun run dev`. Verify an HTTP request to the printed local URL
   returns the starter page and stop the dev server afterward. Use a different
   port if the default is occupied. Report any failing checks and their cause.
   Preserve any existing application files and data; use a new test directory.
8. Check the app's dependency is
   `file:./.zero/framework/zero-framework.tgz`, its archive is present, and
   `zero-release.json` records the selected version/commit/hash. Explain that
   app dependencies still require network access even though Zero itself comes
   from the local archive. No npm package publication is required.
9. Finish with the actual framework checkout, installed command/runtime/release
   paths, selected framework version/commit, starter app path and verification
   results. Show the recipient how to create the next project, pull future
   changes from the org, run `zero-release main`, and preview/apply
   `zero-update` for an existing app.

Implementation sources are [install.ts](../src/local-tools/install.ts),
[run.ts](../src/local-tools/run.ts), and
[stable-release.ts](../src/local-tools/stable-release.ts). Use these existing
commands; no alternate CLI needs to be built for onboarding.
