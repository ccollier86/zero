---
id: zero.cli.tooling.releases
type: operations
audience: [developer, agent, operator]
owner: cli-tooling
status: draft
visibility: internal
system: cli-tooling
feature: releases
maturity: supported
applies_to: ["2.1.1 source; publication qualification pending"]
modes: ["Bun package-mode applications", "trusted local development"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Select And Verify Saved Committed Releases

[Tooling index](./index.md) · [Documentation index](../../index.md)

`zero-release` creates/selects a package from an exact **local Git branch**.
Default is main. It does not publish npm/GitHub, push commits, fetch a remote
branch, deploy apps or include the checkout's uncommitted work.

```sh
zero-release --status
# Operational selection examples, after deliberate branch review:
zero-release main
zero-release release/1.3
```

`--status` reads and checksum-validates the selected saved archive without
refreshing it. Only one argument is accepted; unknown options/invalid local
branch names fail. Report includes version, branch, commit, refs/heads source,
archive path and SHA-256.

## Snapshot And Activation

Publisher locks the release store, resolves the branch commit, reads its package
manifest from Git, exports committed files, packs with scripts ignored, validates
required archive contents and computes checksum. It confirms the branch still
points at the same commit before atomically selecting stable.json. If the branch
moves or packaging fails, previous stable remains active.

Archives are identified by version, commit and source identity. Saved metadata
schema is one; selected archive must match its stored hash before extraction.
Temporary extraction uses owned scratch paths and is cleaned after use.
Integrity is local provenance, not a signature/distributed release authority.

Main is the only automatic managed Git-hook target. Selecting another branch
requires explicit release invocation; a later main hook can select main again.
Treat the selection as shared workstation state before [zero-new](./zero-new.md)
or [zero-update](./zero-update.md). Those commands record app provenance.

## Related Guides And Next Steps

[Installation](./local-install.md) owns paths/hooks,
[configuration](./configuration.md#saved-launcher-installation) owns defaults,
and [updates](./update.md) owns application install-state recovery.
