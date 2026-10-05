---
id: zero.native-auth.chrome
type: how-to
audience: [developer, agent]
owner: native-auth
status: draft
visibility: internal
system: native-auth-sdks
feature: chrome-mv3-worker-and-token-free-messages
maturity: preview
applies_to: ["2.1.1 framework source; independent SDK previews are not released"]
modes: [native-client, multi-tenant-native, desktop, extension]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
related_packages:
  - package: "zero-native-auth / tauri-plugin-zero-auth"
    version: "0.0.0"
    maturity: preview
  - package: "@zero/chrome-auth"
    version: "0.0.0"
    maturity: preview
---

# Authenticate A Chrome MV3 Extension

[Native SDK index](./index.md) · [Documentation index](../../index.md)

`@zero/chrome-auth` is an independent private 0.0.0 preview at child commit
622ef4e4eeb2577510417d0405286c7771765fe4. It adapts the framework native broker
to chrome.identity and extension storage. It is not yet a production-installable
registry dependency with a qualified framework peer range.

## Register A Stable Callback

Inside the loaded extension, obtain:
`chrome.identity.getRedirectURL('zero-auth/callback')`.
Register that exact HTTPS chromiumapp.org URI for a dedicated public client on
[Guardian](../guardian/native-provider.md). A stable extension ID is required;
do not use a wildcard callback, client secret or an API key embedded in UI.

The manifest uses MV3 module service worker, identity+storage permissions and
only the configured Zero origin's host permission. Avoid all_urls/broad origins.
Default persistence requires the SDK's Chrome 116 baseline; local persistence
requires its Chrome 140+ policy. These are the preview's declared target
requirements, not a claim of cross-browser certification.

Use incognito not_allowed unless spanning ownership is deliberately supported
by the host. Split mode is rejected because it creates another independent
refresh owner.

## Create One Worker Owner Before Async Initialization

```ts
import {
  createChromeExtensionAuth,
  installChromeAuthMessageHandler,
} from '@zero/chrome-auth';

const auth = createChromeExtensionAuth({
  serverUrl: 'https://app.example.test',
  clientId: 'example-chrome',
});

installChromeAuthMessageHandler(auth);
void auth.initialize().catch(() => {
  // A trusted page can request a retry and render the sanitized failure.
});
```

This is preview source integration, not a registry installation instruction.
Install the message listener synchronously at worker module evaluation before
awaiting startup; a UI message may be what starts the worker.

Begin interactive sign-in/sign-up only from explicit user action. Keep
authenticated application fetch in the worker, not a popup/content script.
The app can add fixed app-specific messages returning sanitized domain data.

## Worker API

The frozen facade supplies state, initialize, signIn, signUp, refresh,
listTenants, switchTenant, getUser, fetch, signOut, subscribe and request.
There is no getAccessToken or callback-completion method.

Lifecycle methods return state or throw except signOut's successful void
result. request and the message bridge return structured success/failure
responses with safe snapshots. subscribe is a worker-local subscription,
not an automatic cross-page event channel.

auth.fetch only targets the configured Zero origin, omits ambient cookies,
uses manual redirect handling and performs at most one refresh/retry on 401.
It authenticates a user; server route/resource/RBAC policy still governs work.

## Token-Free Page Protocol

The trusted-extension-page bridge accepts exactly:

| Message type | Additional input |
| --- | --- |
| zero-auth:state, zero-auth:initialize, zero-auth:sign-out | None. |
| zero-auth:sign-in, zero-auth:sign-up | Optional bounded loginHint. |
| zero-auth:list-tenants | None. |
| zero-auth:switch-tenant | tenantId. |

Responses include ok and a safe snapshot with worker epoch/revision; tenant
list is present only for that action. Compare epoch+revision to retire old
worker results. The bridge does not accept refresh, getAccessToken, arbitrary
fetch, raw callbacks or runtime server/client overrides.

A privileged bundled extension page can request the supported operation:

```js
const result = await chrome.runtime.sendMessage({
  type: 'zero-auth:sign-in',
  loginHint: 'person@example.test',
});
if (!result.ok) {
  // Render result.error.message; do not log the entire response.
}
```

Keep application data messages separate, with fixed domain operations and their
own sender/payload validation. Do not add arbitrary worker-fetch input to this
auth message protocol.

Sender ID must be the owning extension and sender URL its own
chrome-extension origin. Content-script senders and external/malformed
messages are rejected. Unknown namespace messages are not claimed, so other
listeners can coexist.

Use installChromeAuthMessageHandler, which uses callback sendResponse and
returns literal true for claimed messages. Do not blindly replace it with an
async Promise-returning listener and assume the preview's declared baseline
supports that registration behavior.

## Storage Is Not Worker-Only Isolation

Session persistence survives worker suspension but clears with browser restart/
extension disable/reload/update. Local opt-in persists in the profile until
explicit removal/logout/extension removal.

Both storage areas are restricted to TRUSTED_CONTEXTS. This includes privileged
popup/options/side-panel/offscreen pages, not just the service worker. Such
pages can directly read the underlying storage; XSS there is a credential
compromise even though the official message facade does not return tokens.

Do not describe Chrome storage as an OS keychain or a sealed worker-only vault.
Keep privileged UI CSP/dependencies/messages narrow and avoid injecting remote
scripts/unsafe HTML. Server revocation remains necessary if a credential is
compromised.

Configuration signature binds server/client/persistence/namespace. Changing
those fields is a credential migration; the SDK does not silently move old
credentials or revoke their old server family.

## Tenant Switching And Cleanup

Tenant listing/switching uses the worker-held client refresh proof and current
server membership. Safe tenant kind must be organization/administration.
Successful switch replaces credentials before publishing the new activeTenant;
retire domain caches and previous-tenant response callbacks.

Serialized actions coordinate logout/renewal. Cleanup checks the exact vault
keys before releasing its storage binding marker. If removal cannot be
confirmed, CHROME_AUTH_STORAGE_CLEANUP_FAILED is not success merely because
a local display is anonymous.

## Preview Qualification

The repository's framework fixture is type/test-only and throws at runtime.
Do not ship it in an application or infer a compatible framework range from
0.0.0. Real extension validation requires a compatible framework artifact,
running provider, stable ID/exact callback and browser lifecycle tests.

Public release also requires ownership, license/repository metadata, a real
peer contract and staged consumer/package checks. This documentation pass
reads source; it does not perform child build/publication or live browser
certification.

## Related Guides And Next Steps

- [Configuration](./configuration.md) lists exact options/defaults.
- [Framework client](./framework-client.md) owns protocol behavior beneath the adapter.
- [Guardian provider](../guardian/native-provider.md) registers and revokes server authority.
- [Roadmap](./roadmap.md) records release and platform qualification separately.
