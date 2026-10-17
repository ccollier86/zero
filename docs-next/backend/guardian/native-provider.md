---
id: zero.guardian.native-provider
type: how-to
audience: [developer, agent]
owner: guardian
status: verified
visibility: internal
system: guardian
feature: native-and-extension-oidc-public-clients
maturity: supported
applies_to: ["2.6.0 source with unreleased OAuth form and browser Origin corrections"]
modes: [single-simple, single-advanced, multi-simple, multi-advanced]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "581dbd89095c0dd52e5c0aa929a6efa0018dbf1a"
  snapshot: dirty
  date: "2026-10-17"
  evidence_level: source-observed
---

# Authenticate Desktop, Mobile And Extension Clients

[Guardian index](./index.md) · [Documentation index](../../index.md)

Guardian exposes an OpenID Connect authorization-code provider for public
clients. A desktop/mobile/extension app needs a registered public client ID,
a safe callback, PKCE and user interaction—not the server's provider secrets
or a shared client secret hidden in an executable.

The server uses the same canonical accounts, MFA, memberships, roles and
revocation as web login. Identity scopes do not create a second app permission
system.

## Register A Public Client

```ts
import { defineAuthConfig } from '@zero/framework/auth';

export const auth = defineAuthConfig({
  nativeApps: {
    issuer: 'https://app.example.test/auth',
    clients: [{
      clientId: 'example-desktop',
      name: 'Example Desktop',
      redirectUris: ['cc.example.desktop:/auth/callback'],
      scopes: ['openid', 'profile', 'email'],
    }],
  },
});
```

Native mode auto-enables when clients are declared; explicit false disables it.
An enabled provider requires at least one client and a canonical issuer.
Managed app publicUrl can provide the default issuer; explicitly configured
nativeApps.issuer takes precedence. Production issuer uses HTTPS and must be
the canonical auth issuer, not an arbitrary request Host header.

Client IDs are unique 1–128-character public identifiers. Each client has a
nonempty trimmed name and one or more validated redirect URIs.
Scopes default openid/profile/email and must include openid.

## Callback Kinds

- Loopback HTTP uses literal 127.0.0.1 or IPv6 ::1; dynamic callback port may
  differ while the registered host/path/query remain matched.
- Claimed HTTPS uses a real DNS host and exact registered URI.
- Private-use schemes use reverse-domain-style naming and the registered
  single-slash callback form.

Non-loopback matching is exact. Wildcard callbacks, arbitrary redirects,
credentials in URLs, unsafe query/fragment components and unregistered
client/redirect combinations are rejected.

For browser extensions, register the exact HTTPS callback produced by the
extension identity flow. For mobile/private schemes, configure the OS deep-link
handler. Public registration does not establish exclusive ownership of a
private scheme; PKCE/state/nonce and issuer validation remain essential.

## Protocol Endpoints

The default auth mount exposes:

| Endpoint | Purpose |
| --- | --- |
| `GET /auth/.well-known/openid-configuration` | Discovery, public endpoints and protocol capabilities. |
| `GET/POST /auth/oauth/authorize` | External-browser request and same-origin user confirmation. |
| `POST /auth/oauth/token` | Authorization-code exchange or refresh. |
| `POST /auth/oauth/revoke` | Revoke a client-bound token family. |
| `GET/POST /auth/oauth/userinfo` | Current native principal's scoped identity profile. |
| `POST /auth/oauth/tenants` | Client-bound refresh-proof tenant list. |
| `POST /auth/oauth/tenants/switch` | Client-bound tenant/session replacement. |
| `GET /auth/jwks` | Public signature verification keys. |

Clients should use discovered endpoints and validate the canonical issuer.
An authorization request uses response_type=code, client_id, registered
redirect_uri, S256 code_challenge, state, nonce and permitted scope.
Plain PKCE or a client secret is not an alternate public-client mode.

Token/revoke/tenant operations use form encoding. Code exchange fields are
grant_type=authorization_code, code, client_id, redirect_uri and code_verifier.
Refresh fields are grant_type=refresh_token, refresh_token and client_id.
Client-secret/Basic-auth credentials are rejected.

## Managed Server Form Ownership

The five form-reading POST routes—`/auth/oauth/authorize`,
`/auth/oauth/token`, `/auth/oauth/revoke`, `/auth/oauth/tenants` and
`/auth/oauth/tenants/switch`—disable Elysia's automatic body parsing with the
route-local option `{ parse: 'none' }`. The native provider's `readNativeForm()`
is the sole body reader. It retains the form-encoding requirement, 16,384-character
body ceiling and duplicate-field validation before processing OAuth credentials.
The Content-Length preflight also rejects values above 16,384.

This is necessary even when a minimal standalone auth plugin appears to work.
Managed application hooks/extensions can enable Elysia's body inference;
without the route-local override Elysia can consume the form before the native
handler calls `request.text()`. Browser approval then returns HTTP 500 instead
of its callback redirect. Token and tenant operations have the same ownership
requirement. See [Elysia's parser guidance](https://elysiajs.com/essential/life-cycle#skip-body-parsing).

The correction is inside Zero, not a required application workaround. Do not
disable parsing globally, read/patch the request body in app middleware, or
replace the strict reader with an object parser that loses duplicate fields.
Ordinary managed JSON and form endpoints keep their existing body parsing.
UserInfo does not use this form reader and is not part of this override.

## Browser Consent Origin And Referrer Policy

Native authorization HTML uses `Referrer-Policy: same-origin`. This preserves
the browser-generated issuer Origin on the consent form's POST while omitting
referrers on cross-origin requests. With `no-referrer` on the HTML, Chromium
instead submits a literal `Origin: null` and the otherwise valid consent is
rejected with HTTP 400. This is distinct from the consumed-body HTTP 500 above.
See the documented [effect of referrer policy on Origin](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Referrer-Policy#effect_on_the_origin_header).

The HTML override belongs in `nativeHtml()`, after its shared security headers.
`nativeRedirect()` still sends `Referrer-Policy: no-referrer`, including on
code-bearing callbacks and denial/login redirects. Cache prevention, CSP
(`form-action 'self'`, frame restrictions and disabled scripts), cookie/owner
binding, PKCE, state/nonce and redirect validation are unchanged.

The POST handler still requires exact equality with the configured issuer's
origin. Missing Origin, literal `null` and hostile origins remain rejected;
none is an allowed fallback for a phone, embedded browser or TV handoff. Do not
weaken that check, infer authority from Referer, or spoof Origin in the app as
a workaround. API tests that explicitly send a valid Origin cannot establish
that a browser-generated form works.

## Complete The Same Human Ceremonies

Authorization opens the browser's login/registration/recovery path with a
server-owned continuation. The user completes password, email and MFA policy,
then explicit same-origin authorization. A stale request or a different account
cannot replace the bound identity.

`prompt=create` enters registration. `prompt=none` returns
interaction_required rather than silently issuing a credential without the
implemented confirmation ceremony.

Codes are one-time and PKCE/client/redirect-bound. Defaults: request 15m,
code 3m, native refresh 30d. Access/ID token response handling must validate
issuer, audience, state/nonce and code proof through the SDK/protocol.

Do not use an ID token as the app API access token. UserInfo only projects
profile/email claims requested by allowed identity scopes; roles/permissions
come from Guardian's live app authority.

## Multi Tenant And Live Revocation

The native family is bound to the selected live membership.
Tenant listing/switching requires client_id plus refresh_token, not just a
frontend tenant string. Switching replaces authority; old scope credentials
must not remain valid.

Suspension, auth-generation changes, revoked family, removed membership and
role changes are resolved through the same live Guardian checks used by
ordinary APIs. The native identity scopes openid/profile/email are not app
RBAC permissions or a way to access another organization's Fabric database.

The adaptive-profile source adds explicit `phone`, `profile:write` and
`contacts:write` ceilings. Defaults remain openid/profile/email; register and
request writer scopes deliberately. `profile:write` narrows own-profile/avatar
and availability mutation; `contacts:write` narrows own-contact ceremonies.
They are not role grants or a directory/global-account administration API.
Read [profiles](./user-profiles.md), [contacts](./contacts.md) and
[avatars](./avatars.md) for exact read/write limitations and private delivery.

## Admission And Rotation Bounds

Native requests have bounded outstanding and rolling admissions across app,
client and trusted source. Default outstanding limits are 1000/100/20;
one-minute admission limits are 300/60/20. Trusted proxy/custom resolver rules
follow the same explicit source-trust model as general auth admission.

Native refresh defaults: cleanup batch 100, minimum rotation interval 30s,
maximum 4096 rotations/family and 10 active families/user/client. These are
storage/abuse bounds, not a reason for an SDK to rotate on every API call.
Serialize/adopt rotated tokens safely so races do not replay old refresh values.

## SDK Boundary

Rust/Tauri and Chrome-extension SDKs are separately maintained packages;
their versions/maturity must be verified separately from the core provider.
A browser public client ID is not a secret key.
A secure app should keep refresh credentials in the appropriate native secure
storage/background context rather than exposing them to arbitrary UI/plugin
code.

The provider contract is documented here. [Native SDK guides](../native-auth/index.md)
separately describe the framework client and private Rust/Tauri/Chrome previews;
do not assume a source example proves every desktop/mobile OS callback adapter
is shipped.

## Verification And Errors

Use disposable registered clients to verify exact callbacks, code replay,
wrong verifier/client, issuer/state/nonce mismatches, registration/recovery/MFA
continuation, tenant switch, rate bounds and revocation during asynchronous
signing. OAuth errors use protocol error responses and safe descriptions;
unexpected failures emit standard native request-failure telemetry.

Never log authorization codes, verifier/refresh values, private signing keys
or callback URLs containing returned credentials.

### Managed HTTP Regression Coverage

The [managed form integration suite](../../../src/frontend/server/native-auth-form-app.integration.test.ts)
uses public `createApp()`, disposable databases and a real loopback HTTP/Sync
listener. An app-level body-inspecting hook enables Elysia's normal inference;
there is no `Request` monkeypatch or alternate OAuth handler. The approval test
reproduces HTTP 500 without the five overrides and passes with them.

Coverage includes authorization approval/denial, same-origin and browser-owner checks,
PKCE, one-time codes, refresh rotation, revocation of HTTP/Sync authority,
tenant listing/session replacement, strict content-type/size/duplicate-field
errors, public-client secret rejection and unaffected ordinary body parsing.
Tenant-bound managed coverage replaces the active tenant's family; the
[tenant provider suite](../../../src/auth/oidc/native-tenant-session.integration.test.ts)
also exercises switching between tenants and membership/MFA boundaries.

### Real Browser Consent Coverage

The [Chromium consent suite](../../../src/frontend/server/native-auth-consent.browser.test.ts)
loads the actual managed authorization page and clicks Continue and Cancel.
It covers the signed-out continuation, browser-generated Origin, approval and
denial callbacks, PKCE code exchange and authenticated HTTP. It also checks that
callback requests carry no Referer and their 302 responses retain `no-referrer`.
It does not inject an Origin, rewrite headers, replace the page or mock OAuth.

The [response-header unit suite](../../../src/auth/oidc/native-http.test.ts)
checks HTML versus redirect policy and the retained hardening headers. Managed
HTTP tests explicitly reject missing, null and hostile Origins for both approval
and denial without consuming a valid pending consent.

From the framework root, run:

```sh
bun --no-env-file test \
  ./src/frontend/server/native-auth-consent.browser.test.ts \
  src/frontend/server/native-auth-form-app.integration.test.ts \
  src/frontend/server/native-auth-app.integration.test.ts \
  src/auth/oidc src/auth/native src/native
```

The browser suite requires installed Playwright Chromium. A skipped browser
test is not qualification of this correction. Both real form-click regressions
fail on `581dbd8` with the browser's Origin set to `null`.

Standalone provider tests remain useful but do not substitute for managed
composition coverage. This verifies the framework behavior, not an application's
pairing handoff, installation records, OS callback adapter or deployment.

### Adopt The Form Correction

The package version alone does not identify these fixes: they are unreleased
source corrections after the original 2.6.0 archive. Commit `581dbd8` contains
the raw-form fix but not the browser Origin fix. Select a committed package
containing both corrections, inspect its commit and SHA-256, and use the supported
[saved-package updater](../../cli/tooling/zero-update.md). Record the installed
archive/commit/hash and lockfile provenance rather than editing `node_modules`.
An older saved archive is not refreshed merely by fetching source.

No schema migration, auth configuration change, new client secret or SDK API
change is introduced by this repair. After adopting it, rerun the application's
real native approval, callback/code exchange, renewal, managed Sync and sign-out
tests, followed by its typecheck. Pending application migrations and unrelated
packaging issues still need their own verification; a framework test pass does
not establish that TV/device pairing is complete.

## Related Guides And Next Steps

- [Configuration](./configuration.md) gives exact startup inputs and interactions.
- [Native SDKs](../native-auth/index.md) selects the credential-owning runtime.
- [Registration](./registration.md) and [MFA](./mfa.md) share the human ceremony.
- [Sessions](./sessions.md) explains live native versus web family authority.
- [Tenancy](./tenancy.md) explains membership selection.
- [Request admission](./request-admission.md) defines trusted source resolution.
