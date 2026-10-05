---
id: zero.frontend.runtime.configuration
type: reference
audience: [developer, agent]
owner: frontend-runtime
status: draft
visibility: internal
system: frontend-runtime
feature: configuration
maturity: supported
applies_to: ["2.1.1 source with audited corrections; package qualification pending"]
modes: [browser, SSR, single-database, Fabric]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Provider Configuration

[Runtime index](./index.md) · [Documentation index](../../index.md)

These are React props and server-authored browser metadata, not an environment
discovery or persisted settings API. Configure backend behavior in the normal
server [configuration](../../backend/runtime/configuration.md); the browser
cannot enable a disabled server capability or grant itself a data plane.

## AppProvider Props

| Prop | Accepted shape | Resolution / omitted behavior |
| --- | --- | --- |
| url | required HTTP server URL string | used when creating the browser SDK; WebSocket URL derived by SDK |
| tables | required table-name map | raw ClientTableDef or an object containing clientTable; normalize before first browser client creation |
| auth | optional boolean | explicit prop, injected server boolean, then false |
| stateSync | optional boolean | explicit prop, injected server boolean, then false; true requires auth |
| publicPaths | optional string[] | explicit prop, injected values, then six default account paths |
| routeAuth | protected-by-default or explicit | explicit prop, injected value, then protected-by-default |
| loginPath | optional safe local path | explicit prop, injected value, then /login |
| postLoginPath | optional safe local path | explicit prop, injected value, then / |
| initialPathname | optional string | SSR router seed; otherwise router fallback / |
| initialParams | optional string record | SSR router parameter seed; otherwise empty record |
| errorFallback | function receiving error/reset, returning ReactNode | optional replacement render-error UI |
| children | ReactNode | descendant application tree |

Default public paths are /login, /register, /forgot-password, /reset-password,
/setup-password and /verify-email. A path being public does not force a route
file to exist or configure Guardian's registration/MFA policy. Safe navigation
normalization rejects unsafe destinations and explicit login/post-login loops.

Explicit auth=true contradicting injected auth=false rejects; explicit
stateSync=true contradicting injected stateSync=false rejects. An SSR render
does not instantiate the client; these checks and transport wiring occur in
the browser composition path. The client is retained after creation, so changing
props later is not a supported runtime backend-settings update.

## Server-Owned Browser Metadata

The generated browser payload can provide resolved tableSyncModes,
tableSyncPlanes and managedTableNames. AppProvider consumes them to project
local table shapes against the running server:

- Resolved full/lazy mode replaces client loading intent for a configured table.
- Managed tables with no Sync plane are excluded from the Sync client catalog.
- A local table absent from the server's declared managed catalog rejects rather
  than creating a divergent client schema.

This routing metadata is public descriptive configuration, not a credential or
user-selected authorization scope. Do not hand-author injected globals to
override the running server's realm policy. See [data planes](../../backend/runtime/data-planes.md).

## ClientProvider Props

| Prop | Accepted shape | Behavior |
| --- | --- | --- |
| client | pre-created Client | wins over config and is retained on first render |
| config | ClientConfig | creates or reuses the existing singleton when client is absent |
| children | required ReactNode | context descendants |

One of client/config is required. ClientProvider does not add the full AppProvider
router, Sync, modal or authorization display tree. It is not a server-rendering
transport-deferral wrapper; use the [SSR-safe root](./app-provider.md) when that
is what the application needs.

## Low-Level SyncProvider Props

SyncProvider is public from @zero/framework/sync/client. Its optional client wins
over creation inputs; otherwise url and tables are required.

Creation inputs are url, tables, token, getToken, refreshAuth, bindAuthLifecycle,
onError, onReconnect, onMutationRejected, ackTimeout and maxReconnectAttempts.
These are forwarded to createSyncClient without introducing independent
provider-specific defaults. Refer to the chosen low-level client's connection
and receipt contract rather than assuming AppProvider's integrated auth binding.

stateClient and ephemeralClient may be supplied with an existing SyncClient;
they are nullable context peers. The provider creates neither of them when it
creates a low-level SyncClient from url/tables. children is required. Existing
client ownership stays with its creator; provider-owned connection is disconnected
on unmount. See [SyncProvider](./sync-provider.md) for lifecycle and separation.

## Other Runtime Settings

ErrorBoundary accepts optional fallback and onError plus children. Its default
UI distinguishes production from development via the bundled NODE_ENV behavior.
An application custom fallback receives the original Error and must not expose
private details accidentally. AppProvider's errorFallback forwards only its
render fallback, not an onError prop. [Hydration](./hydration.md) accepts an
app-generated manifest; it does not discover configuration folders in the browser.

No provider props contain a password, server API secret or privileged database
handle. Doctor inspects trusted server/config modules; it does not render React
providers, prove accessibility or simulate runtime prop replacement.

## Related Guides And Next Steps

- [AppProvider](./app-provider.md) shows normal composition.
- [ClientProvider](./client-provider.md) covers explicit context access.
- [Scope transitions](./scope-transitions.md) explains reactive authority replacement.
- [Error boundaries](./error-boundaries.md) owns production-safe presentation.
