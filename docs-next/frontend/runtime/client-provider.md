---
id: zero.frontend.runtime.client-provider
type: reference
audience: [developer, agent]
owner: frontend-runtime
status: draft
visibility: internal
system: frontend-runtime
feature: client-provider
maturity: supported
applies_to: ["2.1.1 source; package qualification pending"]
modes: [browser, SSR]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Client Context And SSR-Safe Access

[Runtime index](./index.md) · [Documentation index](../../index.md)

ClientProvider gives descendants one integrated SDK client. Use AppProvider for
the normal router/Sync/modal/scope composition. Choose ClientProvider when an
application already owns that surrounding composition or needs explicit context
for a standalone feature.

## Supply A Client Or Configuration

```tsx
import { ClientProvider } from '@zero/framework/react';

// UI fragment: client is the app's already-created integrated Client.
<ClientProvider client={client}>{children}</ClientProvider>;
```

Alternatively pass config. A supplied client wins; config otherwise reuses
getClient() or creates the singleton. One of them is required. The initial value
is retained across rerenders; prop changes do not install a replacement session
or arbitrary second client. The provider does not dispose a caller's client on
unmount and does not add a SyncProvider or router itself.

Unlike AppProvider's SSR branch, ClientProvider executes its supplied/configured
client path when rendered. It is not a promise to defer creation until hydration.
Prefer [AppProvider](./app-provider.md) for that orchestration contract.

## Hooks

Public browser-safe imports include ClientProvider, ClientProviderProps,
useClient, useClientMaybe and useIsServer from @zero/framework/react. The
advanced shouldUseSsrFallback helper is available from @zero/framework/react/hooks,
not a named root export.

| Hook/helper | Contract |
| --- | --- |
| useClient() | returns the context client; browser absence throws an actionable provider error; SSR absence returns runtime null despite its required-client type |
| useClientMaybe() | explicitly Client or null, without a missing-provider exception |
| useIsServer() | typeof window is undefined; not a capability/permission check |
| shouldUseSsrFallback(client, hookName) | false with a client, true for SSR absence; browser absence throws a named provider error |

For custom SSR-safe code use the nullable hook:

```tsx
import { useClientMaybe } from '@zero/framework/react';

function ClientStatus() {
  const client = useClientMaybe();
  if (!client) return <span>Preparing the browser client…</span>;
  return <span>{client.url}</span>;
}
```

Do not call methods unconditionally on useClient() during an SSR render merely
because TypeScript's return annotation says Client. Existing higher-level hooks
own their respective safe fallback; the fallback is not a server service object.

## Boundaries And Verification

Context exposes the configured client, not elevated authority. A supplied client
must still use the running server's normal authenticated transport and scope
lifecycle. Component state/read/write operations need [authorization fences](./authorization-scope-boundary.md)
when they can outlive identity/organization replacement.

Test a missing browser provider fails clearly, an SSR-safe custom component
renders without one, and explicit composition does not create duplicate sockets.
These are focused source contracts; actual package exports and browser ownership
still require artifact qualification. No environment variables or settings tables
are discovered by this context.

## Related Guides And Next Steps

- [AppProvider](./app-provider.md) supplies complete normal composition.
- [Configuration](./configuration.md#clientprovider-props) lists precise props.
- [SyncProvider](./sync-provider.md) describes the separate low-level context.
- [Scope transitions](./scope-transitions.md) explains when old UI data is discarded.
