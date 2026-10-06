---
id: zero.agents.tooling.package-discovery
type: reference
audience: [developer, agent, maintainer]
owner: agent-tooling
status: draft
visibility: internal
system: agent-tooling
feature: package-discovery
maturity: supported
applies_to: ["2.1.1 source; publication qualification pending"]
modes: ["coding-agent application development", "installed-package discovery"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Discover The Installed Package, Not A Guessed Checkout

[Tooling index](./index.md) · [Documentation index](../../index.md)

Normal applications depend on @zero/framework, use its declared package exports
and carry package-local docs/README/llm.txt/llms.txt. Generated README points
readers at `node_modules/@zero/framework/docs-next/start-here.md`, followed by
`docs-next/index.md` and `docs-next/agents/index.md`. Use those primary feature
guides before the long compatibility bundle. This is source-observed packaging intent;
an exact archive still needs qualification before release claims.

Inspect the app dependency/lock and installed package.json. Saved local apps
add zero-release.json with source/branch/commit/version/hash provenance.
[zero-release --status](../../cli/tooling/releases.md) describes the archive a
future update will consume; it does not prove the app is already updated.

## Import Boundaries

- @zero/framework/react (or root): browser-safe SDK/providers/components.
- @zero/framework/server: trusted server composition/services.
- Owning subpaths such as /schema, /doctor, /ai, /workflows and /vector: their explicit public APIs.
- Individual public component/hook paths only when declared by package exports.
- Source files/private aliases/internal barrels: implementation evidence, not supported app imports.

An export wildcard can incidentally expose a file that is not a product
component. Do not teach discovered test/fixture routes as APIs. A file's export
statement alone is not sufficient public support evidence.

When updating, use [package updater](../../cli/tooling/update.md) and release
migration guidance; app source copies remain app-owned. [Knowledge bundles](./knowledge-bundle.md)
may lag exports, so feature/source reconciliation is essential.

## Related Guides And Next Steps

[CLI workflows](./cli-workflows.md) chooses package/source ownership,
[entrypoints](./entrypoints.md) routes feature reading and
[verification](./verification.md) separates source tests from artifact support.
