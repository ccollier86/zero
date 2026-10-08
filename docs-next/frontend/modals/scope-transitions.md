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
applies_to: ["2.6.0 source; structured-modal upgrade unreleased"]
modes: [browser, standalone, Guardian single, Guardian multi, single-database, Fabric]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "1b5a1fa0281deba69b3809471d2467d596516e4b"
  snapshot: dirty
  date: "2026-10-08"
  evidence_level: source-observed
---

# Retire Old-Scope Dialogs Safely

[Modals index](./index.md) · [Documentation index](../../index.md)

Modal content can retain record IDs, drafts and closures. Hiding a page is not
enough when identity, organization or authorization data changes. The unreleased
structured kernel gives old instances explicit retired outcomes.

## Managed Authorization Boundary

Normal AppProvider scope replacement calls `modals.discardAll()`: remove retained
content and pending decisions, abort old UI contexts, settle structured waiters
retired and legacy boolean confirmations false, and suppress app onClose callbacks.
Do not substitute normal closeAll just because both remove visible content.

Stale action/form/header callbacks cannot accept results or open new child dialogs
after retirement. A required step, pending operation or Save/Discard/Stay decision
cannot veto logout/revocation. Focus/animation cleanup also must not restore old
scope presentation over a newer host.

## Standalone Composition

A plain ModalManager remains usable without Guardian, Fabric, router or Torrent.
The application still owns its record/authority lifecycle. Retire the affected
dialogs when that lifecycle is replaced, and use exact IDs/handle/context ownership
for asynchronous callbacks. The modal API is not a database-selector or security
capability.

## Transport Is Still Domain-Owned

Aborting a UI signal or resolving a confirm false cancels local intent; it cannot
prove a server write never happened. Domain adapters enforce current permissions,
expected revisions, idempotency and accepted-operation identities. Reconcile an
unknown outcome rather than replaying a stale write.

Workflow progress closing/retirement stops its current observation, not durable
execution. A reopened view needs a scoped run identity and current server authority.

## Related Guides And Next Steps

[Runtime scope transitions](../runtime/scope-transitions.md) owns AppProvider
invalidation; [lifecycle](./lifecycle.md) distinguishes dismissal from retirement;
[reactive forms](./forms.md) preserve record ownership;
[Guardian authorization](../../backend/guardian/authorization.md) owns server policy.
