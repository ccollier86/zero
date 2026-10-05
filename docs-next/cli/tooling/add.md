---
id: zero.cli.tooling.add
type: how-to
audience: [developer, agent, operator]
owner: cli-tooling
status: draft
visibility: internal
system: cli-tooling
feature: add
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

# Copy Components And Hooks With zero add

[Tooling index](./index.md) · [Documentation index](../../index.md)

Prefer package imports for maintained components. Use `zero add` when the app
needs to own and customize selected component/hook/modal source.

```sh
# Planning only, from the intended application directory:
bunx --bun zero add components/data-table hooks --dry-run
# After reviewing the plan:
bunx --bun zero add components/data-table hooks
```

`--target <dir>` changes the default current-directory target.
`--list` prints the static addable registry and dynamic primitive pattern.
No items without list/help prints usage and exits one. Unknown options fail.

## Copying Behavior

The copy engine gathers supported source and reachable app-owned dependencies,
rewrites framework-internal imports to public package paths where known, and
maps copied app-owned imports to app aliases. It reports requested items,
planned/written/skipped paths and import rewrite counts.

Existing files are skipped by default. `--force` overwrites them; inspect the
specific target and preserve your changes first. `--dry-run` reads source and
plans rewrites but does not write planned target files. Source copy is not a
database migration, deployment, dependency update or automatic merge engine.

Once copied, those files are app-owned. Framework updates do not replace them
or reconcile custom behavior. Keep needed third-party dependencies and notices;
test copied components against the app's provider, styles and public imports.

## Related Guides And Next Steps

[Source targets](./source-copy.md) lists the registry,
[configuration](./configuration.md#package-commands) specifies defaults, and
[update](./update.md) explains the distinct package-owned update boundary.
