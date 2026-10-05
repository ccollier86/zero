---
id: zero.frontend.state.configuration
type: reference
audience: [developer, agent]
owner: sync
status: draft
visibility: internal
system: sync
feature: frontend-configuration
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

# State Configuration And Providers

[State index](./index.md) · [Documentation index](../../index.md)

Durable useServerState/usePreference/useFormDraft requires stateSync=true on both
managed server and browser client configuration, with authentication enabled.
AppProvider normally inherits the server injection. Omitted raw client stateSync
and auth default false; stateSync without auth is rejected.

The managed provider supplies the shared SyncProvider with StateClient and
EphemeralClient. A raw SyncProvider-created transport does not instantiate a
durable StateClient merely because useServerState is imported.
[Advanced SyncProvider](../runtime/sync-provider.md) documents explicit injection.

useServerStateReady reports whether the current scope's snapshot is ready.
Default values are local fallbacks before readiness, not proof they were persisted.
Do not immediately overwrite a restoring saved draft with its fallback.

Ephemeral hooks require the available client/context and admitted topic policy.
They do not imply an arbitrary public namespace; managed app topics deny unknown
patterns unless explicit policy admits them. Auth changes clear/freeze context and
old-scope callbacks. Per-hook props are render-time, not environment settings.

## Related Guides And Next Steps

- [Server state](./server-state.md) owns durable values/lifecycle.
- [Form drafts](./form-drafts.md) owns convenience keys.
- [Ephemeral](./ephemeral.md) owns non-durable topics.
- [AppProvider](../runtime/app-provider.md) owns normal inherited configuration.
