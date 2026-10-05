---
id: zero.frontend.notifications
type: index
audience: [developer, agent, operator]
owner: notifications
status: draft
visibility: internal
system: notifications
feature: frontend-overview
maturity: supported
applies_to: ["2.1.1 development source; not package-qualified"]
modes: [guardian-enabled, single-tenant, multi-tenant]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Notification Hooks And Components

[Frontend index](../index.md) · [Documentation index](../../index.md)

Use the configured Client's authorized system-plane projection for realtime
notices and receipts. Hooks supply state/actions; visual components accept
items/callbacks and do not authenticate or perform persistence themselves.

- [Hooks and provider](./hooks.md): current-user state, void receipt actions, new-arrival callbacks and optional toasts.
- [Components](./components.md): bell/popover/list/item/badge composition and exact props.
- [Configuration](./configuration.md): provider placement, table availability and presentation defaults.
- [Roadmap](./roadmap.md): prospective Comms interfaces, not current guarantees.
- [Backend notifications](../../backend/notifications/index.md): canonical targeting/authority/receipt contracts.

All surfaces are available from `@zero/framework/react` where exported.
Individual notification visuals also have public `@zero/framework/components/ui/<name>`
paths. Do not import implementation files or create another transport for a bell.
