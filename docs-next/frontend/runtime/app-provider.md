---
id: zero.frontend.runtime.app-provider
type: how-to
audience: [developer, agent]
owner: frontend-runtime
status: verified
visibility: internal
system: frontend-runtime
feature: app-provider
maturity: supported
applies_to: ["2.6.0"]
modes: [browser, SSR, Guardian single, Guardian multi, single-database, Fabric]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "554caea1e5570ab4f52d3f4f82b2d75e004fbf7e"
  snapshot: clean
  date: "2026-10-07"
  evidence_level: implementation-verified
---

# Compose An Application With AppProvider

[Runtime index](./index.md) · [Documentation index](../../index.md)

AppProvider is the usual root for a Zero React application. It connects the
integrated SDK to routing, Sync and modal UI, while allowing server rendering
without opening a browser transport. It does not enable backend features or
replace server resource/Guardian policies.

## Minimal Layout Fragment

```tsx
// app/layout.tsx — requires matching server tables/configuration
import type { ReactNode } from 'react';
import { AppProvider } from '@zero/framework/react';
import { tasks } from '../db/schema';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <AppProvider url="http://localhost:3000" tables={{ tasks }}>
      {children}
    </AppProvider>
  );
}
```

tasks is the app-owned [defineTable declaration](../../backend/schema/tables.md).
The provider extracts its clientTable automatically. Raw ClientTableDef maps also
work. The example URL is a local synthetic origin; deployed apps supply their
normal running Zero endpoint without embedding server secrets in layout code.

In a generated Zero app, auth/stateSync/navigation settings normally inherit
server-injected configuration. Set explicit props only when aligning deliberately
with the server; [configuration](./configuration.md) documents precedence and
contradiction checks. A protected-by-default browser guard is not an authorization
substitute for a publicly exposed server endpoint.

## Composition

During SSR the provider adds ErrorBoundary and RouterProvider unless a router
already exists. It does not create Client/Sync transports or mount ModalManager.
SSR-aware hooks can return their safe empty/loading fallback.

In the browser it creates or reuses the one integrated SDK client and composes:

1. ErrorBoundary and a RouterProvider when needed.
2. ClientProvider exposing that same client.
3. SyncProvider exposing its existing SyncClient and StateClient.
4. Authorization-scope display protection when auth is enabled.
5. ModalManager around route-guarded children.

Collection hooks and low-level Sync hooks share the underlying transport/store;
do not create another client merely to use both. The integrated client owns its
transport; the nested SyncProvider does not take independent ownership of it.
ThemeProvider and NotificationProvider are optional, not installed automatically.

## Client And Table Ownership

The first client is retained in a ref. Ordinary rerenders do not replace it,
and later prop changes are not a live server configuration update or a supported
way to run another independent app instance. Use the SDK lifecycle when deliberately
tearing down an application rather than swapping table/url props in place.

Generated server metadata limits which local client tables participate in Sync
and determines their resolved loading modes/data-plane routes. Known HTTP-only
resources are not accidentally synchronized. An undeclared local table rejects
instead of opening a divergent catalog. [Schema](../../backend/schema/index.md)
describes table shapes; [runtime data planes](../../backend/runtime/data-planes.md)
describes placement and authority.

## Authentication And Scope Changes

With auth enabled the guard waits for actual restoration/authority readiness,
admits a stable signed-out state to public account pages and redirects protected
unauthenticated routes to login with a safe return destination. An authenticated
visit to login uses the configured post-login destination. Server route requirements
and public-path configuration remain part of that composition.

Identity, tenant and authority replacement mask the old subtree and dismiss scoped
overlays. Generated SSR route payloads are checked against the current browser
boundary and reloaded when needed, preventing loader data from an old scope being
reused as if it belonged to the new organization. See [scope transitions](./scope-transitions.md)
and [scope boundary](./authorization-scope-boundary.md) for custom state/callbacks.

Temporary authorization-hint loading is not a request to repair the session.
After a read-authority purge, the guard keeps unsafe content masked while the
SDK rechecks access. An unchanged projection resumes normally; stale same-user
loader authority reloads directly without unnecessary credential rotation.
First automatic page repair uses a neutral status, with an explicit recovery
alert only for failed or persistent disagreement. These behaviors require no
new application prop; use the normal packaged provider.

## Verification And Troubleshooting

Check an SSR page renders without a socket, hydration reads the intended table
catalog, public login works while fully signed out and a protected page redirects
only after restoration settles. Test switching organizations while a query/edit
is pending; old rows, forms and overlays must not survive the boundary.

If a hook reports a missing provider, add the normal root/provider context rather
than fabricating a client inside every component. If table catalog admission
fails, align the shared declaration with the running server instead of rewriting
server-owned browser metadata. Render failures use the [error boundary](./error-boundaries.md),
while rejected async operations use their SDK/component error contract.

Source inspection and focused provider/scope/browser tests establish these
contracts. Exact installed-package and deployment qualification remain distinct;
a clean TypeScript build alone does not establish every Guardian/Fabric profile.
See the [session regression ledger](../../_work/audits/session-refresh-regression.md)
for the focused corrections and their evidence boundaries.

## Related Guides And Next Steps

- [Configuration](./configuration.md) lists every provider prop/default.
- [ClientProvider](./client-provider.md) is the narrower context alternative.
- [Hydration](./hydration.md) explains app-generated route entry wiring.
- [Guardian sessions](../../backend/guardian/sessions.md) owns server session semantics.
- [Schema UI metadata](../../backend/schema/ui-metadata.md) connects reusable forms/tables.
