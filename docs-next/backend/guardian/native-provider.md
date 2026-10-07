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
applies_to: ["2.6.0"]
modes: [single-simple, single-advanced, multi-simple, multi-advanced]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "c5656b306051b04ec6adc641b7057a0672fd7a3e"
  snapshot: clean
  date: "2026-10-07"
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

## Related Guides And Next Steps

- [Configuration](./configuration.md) gives exact startup inputs and interactions.
- [Native SDKs](../native-auth/index.md) selects the credential-owning runtime.
- [Registration](./registration.md) and [MFA](./mfa.md) share the human ceremony.
- [Sessions](./sessions.md) explains live native versus web family authority.
- [Tenancy](./tenancy.md) explains membership selection.
- [Request admission](./request-admission.md) defines trusted source resolution.
