---
id: zero.frontend.state.index
type: index
audience: [developer, agent]
owner: sync
status: draft
visibility: internal
system: sync
feature: frontend-index
maturity: supported
applies_to: ["2.1.1 source; package qualification pending"]
modes: [browser, SSR, Guardian single, Guardian multi, single-database, Fabric]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Durable User State And Ephemeral Topics

[Frontend index](../index.md) · [Documentation index](../../index.md)

Zero supports server-persisted user JSON state and RAM-only collaboration topics.
They share the Sync transport but not persistence, identity or lifetime.
They are not Zero KV or Torrent's workflow memory.

The [backend Sync manual](../../backend/sync/index.md) owns server delivery/policy;
[durable state](../../backend/sync/user-state.md) and
[ephemeral policy](../../backend/sync/ephemeral-policy.md) own persistence/admission.

- [Configuration](./configuration.md) owns provider/readiness prerequisites.
- [Server state](./server-state.md) covers useServerState/StateClient and optimistic writes.
- [Form drafts](./form-drafts.md) covers preference/draft naming and explicit autosave wiring.
- [Ephemeral topics](./ephemeral.md) covers authorized topic reads/writes/errors.
- [Roadmap](./roadmap.md) separates future autosave tooling from current helpers.

Durable state lives in the system plane under a server-derived user principal.
In multi-tenant apps that principal includes organization scope, so the same
person can reuse a key in different organizations without crossing values.
Ephemeral topics follow server-owned namespace/room/user policy and disconnect TTL
semantics. UI cache fences do not replace that enforcement.
