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

## Choosing Package Or Source Ownership

A maintained package import inherits future platform corrections and style
contracts. A copied component permits deliberate deep customization but needs
app-owned verification and upgrades. Do not copy auth/service enforcement to
bypass the canonical backend. UI visibility is not authorization.

For specific target use [add](./add.md), inspect the installed registry before
copying and review [package updates](./update.md) separately. The
[design system](../../frontend/design-system/index.md) owns component/style
conventions; a copied component must still use the same semantic tokens.
