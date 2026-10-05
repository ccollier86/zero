---
id: zero.guardian.request-admission
type: operations
audience: [developer, agent]
owner: guardian
status: draft
visibility: internal
system: guardian
feature: bounded-public-authentication-work
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

# Bound Public Authentication Work

[Guardian index](./index.md) · [Documentation index](../../index.md)

Guardian's request admission limits expensive public authentication and
onboarding work before it reaches hashing, identity lookup and provisioning.
It is a durable atomic counting boundary for these flows, not a general
network firewall, CAPTCHA, API-key IP allowlist or application billing meter.

## Defaults And Flows

Enabled defaults true. Each flow counts a rolling window across the app,
resolved source and hashed subject.

| Config flow | Window | Global | Per source | Per subject |
| --- | --- | --- | --- | --- |
| bootstrap | 10m | 100 | 10 | 5 |
| registration | 10m | 10000 | 100 | 5 |
| login | 5m | 100000 | 100 | 20 |
| invitation | 10m | 10000 | 100 | 20 |
| joinRequest | 10m | 10000 | 50 | 10 |
| domainOnboarding | 10m | 10000 | 30 | 5 |

Each config object accepts `window`, `maxGlobal`, `maxPerSource`,
`maxPerSubject`. Duration uses s/m/h/d, positive and at most one day.
Limits are positive safe integers up to 1,000,000. Cleanup defaults 100 expired
rows per admitted request, accepting 1–10000.

```ts
import { defineAuthConfig } from '@zero/framework/auth';

export const auth = defineAuthConfig({
  requestAdmission: {
    login: { window: '5m', maxPerSource: 50, maxPerSubject: 10 },
  },
});
```

Changing only one limit retains the other flow defaults; it does not turn off
global or subject counting.

## Resolve A Real Source

By default, source resolution uses Bun's direct socket peer. Untrusted client
forwarded headers do not establish a source identity. Configure the actual
trusted proxy ranges when your deployment forwards the client chain:

```ts
requestAdmission: {
  trustedProxyRanges: ['127.0.0.1/32'],
  forwardedForHeader: 'x-forwarded-for',
}
```

This fragment is appropriate only if the actual trusted ingress is restricted
to that range. A broad range chosen merely to make a header work gives attackers
control over per-source identity.

`forwardedForHeader` requires trusted ranges. Alternatively provide a trusted,
synchronous `sourceKey({ request, flow, peerAddress })` adapter.
It is mutually exclusive with proxy/header options. It must return string,
null or undefined; Promise/invalid output is rejected rather than escaping
the admission boundary.

When no source/subject is available, their local buckets are absent, but global
flow admission remains enforced. A null source is not a magic request bypass.

## Atomicity And Privacy

The system database persists admission rows, with a stored hash key used to
hash source/subject identifiers. The service inserts and counts inside SQLite
write serialization; exceeding any limit rolls the transaction back. This
covers concurrent promises and durable restart state, not an unsafe
read-then-write counter.

Email/login subject canonicalization is part of the flow. Raw identifiers,
tokens and forwarded headers do not belong in audit metadata.
Per-app SQL admission is not a distributed global quota across separately
deployed independent system databases.

## Errors And Operations

Exceeding limits returns `AUTH_RATE_LIMITED` (429) with safe retry guidance and
emits `AUTH_REQUEST_ADMISSION_REJECTED` with the flow, not sensitive bucket
values. Source resolution failure returns `AUTH_ADMISSION_UNAVAILABLE` (503).

Disabling the boundary is a deliberate deployment choice. It does not remove
credential validation, but it removes these built-in cost/admission bounds.
A reverse proxy's general connection limits complement, rather than replace,
the application proof/subject controls.

Native OAuth has its own request-admission and refresh-family bounds under
`nativeApps`; those are separate from these six flows.

## Verification

Use a fixed clock and concurrent synthetic requests to test exact capacity,
rollback, window expiry, source/subject separation, restart state and cleanup
bounds. Verify a spoofed forwarded header from an untrusted peer cannot create
a new source bucket. Custom resolvers must be tested for thrown/async/invalid
return values without invoking a live app configuration.

## Related Guides And Next Steps

- [Configuration](./configuration.md) gives exact startup inputs and interactions.
- [Bootstrap](./bootstrap.md) and [login](./login.md) use admission before expensive work.
- [Invitations](./invitations.md) and [verified domains](./verified-domains.md) bound proof inspection/onboarding.
- [Native clients](./native-provider.md) have additional protocol-specific bounds.
