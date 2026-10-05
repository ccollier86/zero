---
id: zero.frontend.modals.scope-transitions
type: reference
audience: [developer, agent]
owner: modals
status: draft
visibility: internal
system: modals
feature: scope-transitions
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

# Discard Old-Scope Modal Content

[Modals index](./index.md) · [Documentation index](../../index.md)

modals.discardAll() immediately clears content/closing state and settles pending
confirms false without invoking caller onClose. The managed authorization runtime
uses this so tenant/account-A callbacks cannot execute after B becomes active.

This differs intentionally from closeAll, which performs normal close
notifications. Do not substitute closeAll at an authorization boundary merely
because both remove visible modals.

Cached modal content can include selected rows/forms/action closures. Hiding an
underlying page while retaining those closures is not sufficient scope replacement.
Normal [AppProvider boundaries](../runtime/scope-transitions.md) retire that display.
Custom standalone host composition must deliberately couple its authority/source
lifecycle to discard and its pending action fences.

Discard cancels local intent, not a server write already accepted or an external
operation already running. Awaited actions need their own live authority/abort/
idempotency contracts; a false confirm does not revoke another caller's credentials.

No modal API is a permission bypass. Recheck real server policy after confirmation
and retain exact operation/instance ownership during asynchronous work.

## Related Guides And Next Steps

- [Lifecycle](./lifecycle.md) distinguishes close notifications.
- [Runtime scope transitions](../runtime/scope-transitions.md) owns normal integration.
- [Table actions](../data-controls/data-table/actions.md) owns keyed pending fences.
- [Guardian authorization](../../backend/guardian/authorization.md) owns server authority.
