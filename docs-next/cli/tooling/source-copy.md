---
id: zero.cli.tooling.source-copy
type: reference
audience: [developer, agent, operator]
owner: cli-tooling
status: draft
visibility: internal
system: cli-tooling
feature: source-copy
maturity: supported
applies_to: ["2.6.0 working source; release qualification pending"]
modes: ["Bun package-mode applications", "trusted local development"]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "ae85a4b6efe11eeb74ab89b15ed02a23e982c59f"
  snapshot: dirty
  date: "2026-10-07"
  evidence_level: source-observed
---

# Source-Copy Registry And Ownership

[Tooling index](./index.md) · [Documentation index](../../index.md)

The static addable registry includes these source families:

| Target group | Targets |
| --- | --- |
| Auth and data controls | components/auth, components/data-table, components/master-detail, components/storage, components/secret-field |
| Page/public presentation | components/animated-list, components/bento-grid, components/code-block, components/cta, components/expandable-card, components/faq, components/features, components/footer, components/hero, components/kanban, components/navbar, components/text-effects, components/streaming-text |
| Shared utilities | hooks, modals |

The installed source registry is authoritative; do not infer a copy target from
every package export. The dynamic form `components/ui/<name>` chooses an
existing primitive under that source directory. `--list` is the discovery
surface, not a capability-query service.

Copy planning recursively follows eligible `components`, `hooks`, `lib`
and `modals` source imports. Public framework service/schema/runtime imports
stay package-owned after rewriting; source-local implementation symbols do not
become supported app APIs simply because the source is visible.

For copied DataTable source, the pure query helpers remain package-owned through
`@zero/framework/react/query-params`. The copy engine uses this focused public
subpath for `stableValueKey`, filter encoding and their data-query types; it does
not copy frontend client internals or assume every helper is on the broad React
facade. The module encodes query state only: it does not fetch data or grant
authority. See [server-driven tables](../../frontend/data-controls/data-table/server-sources.md)
for the authenticated adapter and query contract.

Copied `InlineEditText` and form/save hooks retain live authorization checks
through `@zero/framework/react/authorization-scope`. The exact module rewrite
preserves scope/readiness helpers without copying the client implementation or
assuming those lower-level helpers are exported by the broad React facade.
Keep the matching framework package installed. These are UI admission/result
fences, not permission decisions; [scope boundaries](../../frontend/runtime/authorization-scope-boundary.md)
describe their opaque keys and retirement behavior.

## Choosing Package Or Source Ownership

A maintained package import inherits future platform corrections and style
contracts. A copied component permits deliberate deep customization but needs
app-owned verification and upgrades. Do not copy auth/service enforcement to
bypass the canonical backend. UI visibility is not authorization.

For specific target use [add](./add.md), inspect the installed registry before
copying and review [package updates](./update.md) separately. The
[design system](../../frontend/design-system/index.md) owns component/style
conventions; a copied component must still use the same semantic tokens.
