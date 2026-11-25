# Working on Zero

Start with [Start Here](docs-next/start-here.md), then read the relevant
[feature guide](docs-next/index.md) and [agent guidance](docs-next/agents/index.md).
The organized `docs-next/` tree is the primary reference. Check the implementation
and package provenance before relying on a guide: a design note, prototype, or
feature-branch API is not a released capability.

## Scope and implementation

- Verify the repository, worktree, and branch before editing. Work in the task's
  branch and preserve unrelated changes, other worktrees, and existing demos.
  An app-specific fix belongs in its app unless the evidence identifies a Zero
  defect. Do not deploy or migrate a consumer application as part of a framework
  change without separate authorization.
- Prefer Bun and Zero's existing public APIs and managed services. Keep Guardian
  authority, application and system data placement, tracked writes, and authorized
  Sync delivery on their supported boundaries. A client flag, cached identity, or
  receipt does not grant authority. Preserve fail-closed behavior, idempotency,
  current-scope checks and truthful unknown outcomes.
- Preserve applied migration identities and support populated upgrade paths.
  Reuse native components, Zero icons, design tokens and motion conventions before
  adding parallel UI or infrastructure. Use third-party icons only when Zero does
  not already have the needed icon.
- Keep critical paths fast in file-backed as well as hot modes. Bound queries,
  queues and concurrency; avoid polling, retained-history scans and network waits
  under write locks when the existing runtime supplies a better boundary.
- Update the canonical feature/setup/upgrade docs alongside behavior changes.
  Distinguish source work, tested behavior, and what a normal updater installs.

## Verification and releases

- Use the Bun version and scripts documented by the current checkout. Start with
  focused regressions and no-emit type checks. Use synthetic data and real native,
  browser or bundled-deployment tests where those paths are part of the change.
  Report test scope, original failures and any unverified gates accurately.
- Before packaging, merging a release candidate or selecting an updater archive,
  follow [release operations](docs-next/cli/tooling/releases.md) and
  [release-hook guidance](docs-next/agents/tooling/release-hooks.md). Respect
  repository checks and scoped owner-approved exceptions. Verify the installed
  artifact's source commit and SHA-256, not just its version. A source push is
  not a release or permission to run `zero-release`.
- Do not use real credentials, production accounts, databases, providers or
  deployment contexts for test fixtures. Never expose secrets or customer data
  in source, test output, logs or handoffs.

## Development storage

- Check workspace storage policy before substantial installs, builds, packaging
  or smoke tests. On a workstation with Zero's managed external development
  volume, read its parent `AGENTS.md`, project storage protocol and maintenance
  policy; run `dev-storage status` and `dev-storage check` before and after heavy
  work. If a check fails, follow that workstation's recovery procedure. Do not
  fall back to internal storage or turn off the checks to make a build proceed.
- Reuse stable build/cache paths. Put temporary work and deliverables in the
  approved project scratch and artifact roots. Arrange ownership and cleanup
  before starting a disposable run; close servers and databases, then clean
  only that run's proven synthetic output on success or failure. Use a local
  Docker context and the workstation's disposable/project/run labels.
- Preserve source and Git state, conversation history, real databases, protected
  volumes, approved release artifacts and deliberately retained previews. Never
  sweep unrelated work or entire warm caches. Report what was cleaned up and
  identify any intentionally retained or blocked leftovers.
