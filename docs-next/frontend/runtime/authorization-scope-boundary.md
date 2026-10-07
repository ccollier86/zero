---
id: zero.frontend.runtime.authorization-scope-boundary
type: reference
audience: [developer, agent]
owner: frontend-runtime
status: draft
visibility: internal
system: frontend-runtime
feature: authorization-scope-boundary
maturity: supported
applies_to: ["2.6.0 candidate working source; release qualification pending"]
modes: [browser, SSR, Guardian single, Guardian multi, Fabric]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "ae85a4b6efe11eeb74ab89b15ed02a23e982c59f"
  snapshot: dirty
  date: "2026-10-07"
  evidence_level: source-observed
---

# Fence Data By Authorization Scope

[Runtime index](./index.md) · [Documentation index](../../index.md)

The authorization scope boundary identifies which browser data can currently be
displayed or acted on. It changes for login/logout, active-tenant replacement,
cross-tab session replacement and server-declared same-scope read-authority
changes. Ordinary refresh-token rotation does not itself create a different user
or tenant scope.

Zero's own data hooks/providers use this boundary. Use the same public surface
for custom asynchronous UI state instead of inventing a tenant string or assuming
a late request still belongs to the current account.

## Public Hook And Result

```ts
import {
  useAuthorizationScopeBoundary,
  isAuthorizationScopeCallbackCurrent,
} from '@zero/framework/react';
```

The hook normally reads ClientProvider. An explicit Client/null override is
available for deliberately composed standalone surfaces. Browser use without
a required context rejects clearly; SSR has an appropriate boundary fallback.

| Result | Meaning |
| --- | --- |
| key | opaque cache/callback partition including scope, transition and local data-validation revision |
| scopeKey | opaque stable identity of the committed browser authorization family/scope |
| dataRevision | monotonic local cache fence for same-scope authority/read changes |
| stable | false while old data must be masked and new operations remain frozen |
| ready | false during initial restoration, transitions and unvalidated data; ready can be true for a fully signed-out public-page state |
| phase | current session transition phase |

Do not parse keys into credentials or treat ready as isAuthenticated. A stable
anonymous scope must reach public login/bootstrap pages; an authenticated scope
with stale unvalidated data must remain fenced.

## Focused Boundary Export

`@zero/framework/react/authorization-scope` exposes the same hook and callback
comparison plus the lower-level browser-safe helpers used by copied Zero forms
and inline editors. It exports `readAuthorizationScopeBoundaryKey`,
`readAuthorizationScopeIdentityKey`, `isAuthorizationDataReady`,
`isAuthorizationScopeReady`, `isAuthorizationScopeStable`,
`AuthorizationScopeBoundaryFence` and the `AuthorizationScopeBoundary` type.
The broad React facade need not export every lower-level helper.

The key readers take the actual current AuthClient (or explicit `null` for an
auth-disabled context); the complete-key reader also accepts the SDK's local
data-validation revision. They return opaque partition keys, never credentials
or permission grants. Do not supply a fabricated identity or treat a missing
client as permission to read protected data. A boundary fence increments its
local generation on a changed key so a retained A→B→A callback is not revived.
Normal application composition should prefer the hook and existing SDK controls.

[Source copy](../../cli/tooling/source-copy.md) preserves these checks through
this public module instead of copying framework-private client state.

## Retained Callback Pattern

This component fragment assumes the normal app provider and an app-owned
authenticated endpoint returning a label:

```tsx
import { useRef, useState } from 'react';
import {
  useClientMaybe, useAuthorizationScopeBoundary,
  isAuthorizationScopeCallbackCurrent,
} from '@zero/framework/react';

function CurrentLabel() {
  const client = useClientMaybe();
  const boundary = useAuthorizationScopeBoundary();
  const latest = useRef(boundary);
  latest.current = boundary;
  const [result, setResult] = useState<{ key: string; label: string } | null>(null);

  async function load() {
    if (!client || !boundary.ready) return;
    const capturedKey = boundary.key;
    const data = await client.get<{ label: string }>('/api/current-label');
    if (isAuthorizationScopeCallbackCurrent(
      latest.current.key, latest.current.ready, capturedKey,
    )) setResult({ key: capturedKey, label: data.label });
  }

  const visible = boundary.ready && result?.key === boundary.key;
  return <>
    <button disabled={!client || !boundary.ready} onClick={() => void load()}>Load label</button>
    {visible && <span>{result.label}</span>}
  </>;
}
```

The fragment illustrates partitioning; an application also supplies its normal
safe async error presentation. It does not add a new platform route. The helper
returns true only when ready is true and the captured key equals the current key.
Before-await checks alone cannot protect a delayed completion after a tenant
switch. Mask existing displayed results as well as rejecting late callbacks.

## Authority And Lifecycle

Keys are UI cache identifiers, not claims accepted by the server. A request must
still use normal authenticated/scoped services and pass live Guardian/resource
checks. A browser callback fence does not cancel an already committed database
operation or make a mutation idempotent.

AppProvider uses [scope transitions](./scope-transitions.md) to protect complete
subtrees/loader data and dismiss scoped overlays. Dedicated hooks additionally
abort superseded requests or hide old results where applicable. Preserve those
existing semantics when composing tables, forms and custom service panels.

## Verification And Compatibility

Exercise restoration, anonymous reset, login/logout, tenant switching and a
same-scope authority revision while a request is pending. A delayed old result
must not display or finish a new-scope operation. Do not disable the boundary to
hide a restoration/configuration error; fix the actual session/state contract.

These keys are opaque and not a persistence schema or a public string encoding
to depend on across upgrades. The detailed source tests verify the boundary's
behavior; release qualification must use the actual packaged provider/hooks.

## Related Guides And Next Steps

- [AppProvider](./app-provider.md) installs the normal scope display guard.
- [Scope transitions](./scope-transitions.md) owns subtree/SSR-loader replacement.
- [ClientProvider](./client-provider.md) explains context and SSR fallbacks.
- [Guardian sessions](../../backend/guardian/sessions.md) owns server authority.
