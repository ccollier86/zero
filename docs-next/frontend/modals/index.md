---
id: zero.frontend.modals.index
type: index
audience: [developer, agent]
owner: modals
status: draft
visibility: internal
system: modals
feature: index
maturity: supported
applies_to: ["2.1.1 source with audited corrections; package qualification pending"]
modes: [browser, Guardian single, Guardian multi, single-database, Fabric]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Shared Modal Stack And Deliberate Confirmation

[Frontend index](../index.md) · [Documentation index](../../index.md)

ModalManager hosts Zero's shared modal stack; modals is its imperative interface.
The separate ConfirmProvider/useConfirm implementation is a single-dialog generic
hook, not an alias of the stack. Confirmation records user intent, not permission.

- [Host](./modal-manager.md) explains managed/provider ownership.
- [Content](./content.md) explains open/update IDs and composition.
- [Confirmation](./confirm.md) explains boolean promises and custom labels.
- [Lifecycle](./lifecycle.md) explains exact close/clear/callback behavior.
- [Scope transitions](./scope-transitions.md) explains safe discard without stale callbacks.
- [HoldButton](./hold-button.md) explains pointer/keyboard/time/cancel semantics.
- [Configuration](./configuration.md) covers exact options and exported types.
- [Generic confirmation](../hooks/confirmation.md) documents the separate provider.
- [Roadmap](./roadmap.md) separates planned modal-layout evolution.

The inspected design favors one host/lifecycle, explicit modal IDs, reusable
tokenized content and no stale user actions after authority replacement.
Neither local confirmation nor hiding dismissal controls authorizes a server write.
