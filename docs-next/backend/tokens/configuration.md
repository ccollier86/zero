---
id: zero.platform-tokens.configuration
type: reference
audience: [developer, agent, operator]
owner: platform-tokens
status: draft
visibility: internal
system: platform-tokens
feature: composition-and-duration-policy
maturity: supported
applies_to: ["2.1.1 development source; not package-qualified"]
modes: [managed-server, standalone-server]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Platform Token Configuration

[Platform tokens index](./index.md) · [Documentation index](../../index.md)

There is no AppConfig.tokens switch or generic-token env binding. Managed apps
compose the token plugin with systemDB and defaults. Standalone trusted code
can construct PlatformTokenStore/Service or configure the plugin.

## Exact Service Options

| Option | Default / contract |
| --- | --- |
| actionTokenTTL | '15m'; per-create ttl overrides. |
| resumeTokenTTL | '30d'; per-create/per-rotation ttl overrides. |
| actionTokenCooldown | '5m'; false disables; per-create cooldown overrides. |

Duration strings use integer digits plus s/m/h/d. No fractional/negative/unitless
form is supported. Zero is allowed: cooldown0s suppresses no request; TTL0s
is immediately expired. The corrected parser rejects malformed/unsafe integer
milliseconds and unrepresentable expiry sums with PlatformTokenError
TOKEN_INPUT_INVALID/400 rather than a raw parser/SQLite error.

Defaults are captured at construction, while duration interpretation happens
when creation/rotation or cooldown admission needs it. This is not supported
environment-driven hot reload or a Doctor-specific token policy surface.

## Standalone Composition

```ts
import { createReactiveDB } from '@zero/framework/sync';
import { PlatformTokenService, PlatformTokenStore } from '@zero/framework/tokens';

const db = createReactiveDB({ mode: 'memory' });
try {
  const tokens = new PlatformTokenService(new PlatformTokenStore(db), {
    actionTokenTTL: '15m',
    actionTokenCooldown: false,
  });
  const issued = tokens.createActionToken({
    purpose: 'synthetic.confirm',
    scope: 'example',
  });
  tokens.consumeActionToken(issued.rawToken, {
    purposes: ['synthetic.confirm'],
    scope: 'example',
  });
} finally {
  db.dispose();
}
```

This disposable in-memory example never opens an app database or sends mail.
It is trusted server composition, not a browser credential issuance endpoint.

createPlatformTokenPlugin takes db plus those options and optional runtime/
onServiceCreated. It is a named Elysia lifecycle plugin, not a set of public
token HTTP routes. configurePlatformTokens creates/registers a manual
compatibility service; resetPlatformTokens(expected?) releases only that
manual owner. Getters resolve only unambiguous service/store registrations.
Prefer explicit app-local dependencies in multiple-app processes.

## Verification And Related Guides

Test invalid duration before new storage, default/per-call precedence,
app-local emitters and transaction-domain mismatch. Generic service APIs must
not be confused with Guardian JWT/access/refresh TTL configuration.

- [Integration](./integration.md) explains system-table and secret ownership.
- [Action tokens](./action-tokens.md) owns cooldown/consume behavior.
- [Resume tokens](./resume-tokens.md) owns replacement TTL behavior.
