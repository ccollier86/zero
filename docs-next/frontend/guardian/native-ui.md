---
id: zero.frontend.guardian.native-ui
type: reference
audience: [developer, agent]
owner: guardian
status: draft
visibility: internal
system: guardian
feature: native-provider-web-ui
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

# Web Authentication UI For Native Clients

[Guardian frontend index](./index.md) · [Documentation index](../../index.md)

Desktop/mobile/extension authentication normally uses the system browser for
Guardian's web login/registration/MFA flow, then returns through an exact
registered callback. These helpers preserve that pending flow across local
authentication pages; they do not put provider secrets in a frontend bundle.

The [native provider](../../backend/guardian/native-provider.md) owns registered
clients, callback validation, PKCE and tokens. The
[native SDK family](../../backend/native-auth/index.md) owns credential storage
and host boundaries.

## useNativeAuthContinuation

Import from `@zero/framework/components/auth`.
`useNativeAuthContinuation(): string | null` reads the current auth-page
`redirect` query and uses the framework's native continuation normalizer.
SSR yields null; the hook rechecks on mount.

A returned continuation is a navigation/ceremony input, not an authenticated
principal. An arbitrary URL must not become a callback target just because
someone supplied it in a query string.

## useNativeAuthRoute

`useNativeAuthRoute(href: string): string` preserves a valid continuation in
same-origin non-fragment auth links. It adds the `redirect` query and preserves
an existing login hint up to the helper's length limit. External targets and
`#fragment` links remain unchanged.

```tsx
import { useNativeAuthRoute } from '@zero/framework/components/auth';

export function RegistrationLink() {
  const href = useNativeAuthRoute('/register');
  return <a href={href}>Create an account</a>;
}
```

The packaged login/register/recovery/password/email forms already use these
helpers where appropriate. Use it when composing a custom internal auth link;
do not manually copy tokens into general app URLs.

## useNativeLoginHint

`useNativeLoginHint(): string` reads and trims `login_hint`, accepts at most
254 characters and rejects control characters. Invalid/missing hints return
an empty string. Login/registration use it only to prefill an otherwise-empty
identifier. A hint is not proof of identity, domain membership or existing
account ownership.

## Flow Composition And Verification

Native enrollment/recovery may finish through email links; preserve the
validated continuation through the full account ceremony. MFA and organization
selection are still mandatory when server policy requires them.
Do not use a native `clientId` as an organization selector.

Verify browser login, registration, recovery, required MFA and multi-membership
selection all return to the exact allowed callback only after completion.
Untrusted/external redirect attempts should not become an allowed native flow.

- [Core native client](../../backend/native-auth/framework-client.md) covers callback and vault adapters.
- [Rust/Tauri](../../backend/native-auth/rust-tauri.md) and
  [Chrome](../../backend/native-auth/chrome.md) describe their distinct host/UI boundaries.
- [Backend native configuration](../../backend/native-auth/configuration.md) defines public clients.
