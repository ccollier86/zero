---
id: zero.guardian.bootstrap
type: how-to
audience: [developer, agent]
owner: guardian
status: draft
visibility: internal
system: guardian
feature: installation-bootstrap
maturity: supported
applies_to: ["2.1.1 source; new documentation under review"]
modes: [single-simple, single-advanced, multi-simple, multi-advanced]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Bootstrap The First Owner

[Guardian index](./index.md) · [Documentation index](../../index.md)

Bootstrap is the one-time installation ceremony that creates the first
application administrator. It is distinct from ordinary user registration:
opening registration does not automatically authorize taking ownership of an
empty installation. In multi-tenant mode it also creates the protected
Administration Organization and its first owner membership.

## Choose The Ceremony Deliberately

The default is `bootstrap: 'secret'`. Without a configured secret, an empty
installation reports bootstrap as required but unavailable and rejects the
registration request. Choose one of these policies:

| Configuration | First-owner admission |
| --- | --- |
| `{ mode: 'secret', secret }` | A server-configured secret of at least 32 characters must accompany the request. |
| `'public'` | The first admitted registration may become the owner without a bootstrap secret. |
| `'disabled'` | HTTP registration cannot establish an owner. |

Use public mode only when exposure of the empty installation is controlled.
A deployment reachable before its intended operator registers must not silently
give ownership to an arbitrary visitor.

```ts
import { defineAuthConfig } from '@zero/framework/auth';

const bootstrapSecret = process.env.ZERO_INSTALLATION_BOOTSTRAP_SECRET;
if (!bootstrapSecret) throw new Error('Installation bootstrap secret is missing');

export const auth = defineAuthConfig({
  bootstrap: { mode: 'secret', secret: bootstrapSecret },
  registration: { mode: 'admin-only' },
  tenancy: 'multi',
  authorization: 'advanced',
});
```

`ZERO_INSTALLATION_BOOTSTRAP_SECRET` is an application-chosen environment name,
not a built-in Zero binding. The value stays in server configuration. Never put
it in a public frontend environment variable, URL, bundled component or example
credential checked into a repository.

## Discover The Current State

`GET /auth/config` returns a public-safe bootstrap capability:

```json
{
  "bootstrap": {
    "required": true,
    "mode": "secret",
    "available": true,
    "secretRequired": true
  }
}
```

It never returns the secret. The registration capability separately reports
`mode`, `bootstrapRequired`, `registrationEnabled` and
`publicRegistrationEnabled`. Render the bootstrap ceremony from these
capabilities rather than assuming that `registration.mode: 'public'` means
an unprotected empty installation.

## Complete Bootstrap

Submit the ordinary registration endpoint, including bootstrap-only authority
and, in multi mode, the Administration Organization's name:

```http
POST /auth/register
Content-Type: application/json

{
  "username": "installation-owner",
  "email": "owner@example.test",
  "password": "<operator-chosen password>",
  "bootstrapSecret": "<server-provided installation secret>",
  "organizationName": "Application Administration"
}
```

Omit `organizationName` in single mode. An optional `organizationSlug`
chooses its stable URL identifier; otherwise it is derived from the name.
The first organization is kind `administration`, not an ordinary customer
organization. This remains true when later organization creation is disabled.

The server checks bootstrap authority before password hashing and again in
the serialized registration transaction. Concurrent attempts cannot each
elect a first administrator. User creation, protected ownership and initial
organization intent are coordinated by the registration service, not by a
client-side “count users, then insert” sequence.

Completion can still enter an MFA setup/challenge flow. A successful account
creation is not proof that the response contains a usable access token.
Handle the [registration completion states](./registration.md#completion-is-a-state-machine).

## After Completion

Bootstrap completion is persisted. Subsequent registrations obey the ordinary
registration policy and must not include `bootstrapSecret`: a stale bootstrap
submission fails with `BOOTSTRAP_NOT_REQUIRED` (400). Removing the original
owner is not a supported way to reset bootstrap or reopen ownership capture.

Advanced single-mode ownership adoption and multi-mode administration-tenant
adoption are explicit configuration transitions described in
[the control plane](./control-plane.md). They are not another public bootstrap.

## Failure And Verification

- `BOOTSTRAP_UNAVAILABLE` (403): disabled mode, or secret mode without a secret.
- `BOOTSTRAP_AUTHORIZATION_FAILED` (403): missing or incorrect secret.
- `BOOTSTRAP_NOT_REQUIRED` (400): bootstrap authority supplied after completion.
- `TENANT_NAME_REQUIRED` (422): multi bootstrap omitted a nonempty organization name.
- `TENANT_CREATION_UNAVAILABLE` (422): organization fields supplied in single mode.

Bootstrap rejection emits the standard `AUTH_BOOTSTRAP_REJECTED`
observability code with safe mode/reason metadata, not submitted secrets.
Successful completion emits `AUTH_FIRST_ADMIN_BOOTSTRAPPED`.

In a fresh disposable installation, verify that missing/incorrect authority
creates no user, simultaneous valid attempts elect exactly one owner, public
config never exposes the secret, and ordinary registration follows the chosen
post-bootstrap policy. Do not run destructive bootstrap experiments against
an existing application database.

## Related Guides And Next Steps

- [Configuration](./configuration.md) gives exact startup inputs and interactions.
- [Modes](./modes.md) explains the owner and membership differences.
- [Registration](./registration.md) covers account, organization and MFA completion.
- [Control plane](./control-plane.md) separates app use from platform powers.
- [Request admission](./request-admission.md) adds bounded admission before expensive authentication work.
