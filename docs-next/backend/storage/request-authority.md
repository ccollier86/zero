---
id: zero.storage.authority
type: how-to
audience: [developer, agent, operator]
owner: storage
status: draft
visibility: internal
system: storage
feature: authority
maturity: supported
applies_to: ["2.1.1 source; new documentation under review"]
modes: [single, multi, application, organization, personal, shared-cas]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Use Guardian-Scoped Storage Services

[Storage index](./index.md) · [Documentation index](../../index.md)

Normal handlers use the request-scoped zero.storage capability.
The server derives active tenant, current user/membership, role set, trusted
properties and API-key ceilings. None is selected by a body field claiming an
owner or admin role.

## Live Fences

Read/async operations recheck captured authority after awaited lookup before
returning data. Mutations rehydrate authority at the non-yielding metadata commit
boundary. A stored role label/profile snapshot is not enough after revocation.

Current suspension/membership/role/property/credential changes and managed drive
generation remain relevant. ACL and Studio capabilities are independent checks,
not one blanket “logged in” predicate.

## Raw Engine Versus Projection

Trusted setup can access raw StorageService. Its direct metadata methods are
not universally authenticated; caller-supplied actor parameters don't become
verified identities.

The raw studio getter is null. A projected service binds Studio and the scoped
drive/object/permission methods to live authority rather than allowing the caller
to invent a scope.

For app-verified machine principals, use
[authority-scoped server services](../runtime/machine-services.md), including
mandatory asynchronous/synchronous live fences.
Do not impersonate a browser session or pass an arbitrary org ID to raw storage.

## Independent Data Planes

Storage metadata lives in systemDb even when app records are Fabric-isolated.
Its service scope and dedicated Sync policy prevent that fact becoming a global
client metadata leak.

A public signed capability has its own method/path/expiry constraints and current
managed lifecycle policy; it is not a complete human session.
See [permissions](./permissions.md), [Studio authority](./studio-authority.md),
[capabilities](./capabilities.md) and [client integration](./client-integration.md).
