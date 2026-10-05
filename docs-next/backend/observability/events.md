---
id: zero.observability.events
type: reference
audience: [developer, agent, operator]
owner: observability
status: draft
visibility: internal
system: observability
feature: event-and-code-contract
maturity: supported
applies_to: ["2.1.1 development source; not package-qualified"]
modes: [managed-server, standalone-server, frontend]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Structured Events And Stable Codes

[Observability index](./index.md) · [Documentation index](../../index.md)

A PlatformEvent contains id/sequence/timestamp/source/level/category/code/
prefix/message, with optional metadata/error/requestId/userId/traceId.
Levels are debug/info/warn/error/fatal; sources backend/frontend/cli/test.
Sequence and obs_<sequence> ID are local to the emitter runtime, not globally
unique across servers/apps or stable across restarts.

## Emission APIs

OBS_CODES entries contain dotted machine code, formatted ZERO_* prefix,
category, default level and safe message. emitPlatformCode(definition, options?)
uses the process compatibility runtime; emitPlatformCodeTo(runtime, ...)
selects an explicit owning app. emitPlatformEvent/emitPlatformEventTo accept
a custom PlatformEventInput. warnPlatform/errorPlatform/logPlatformInfo override
severity for a known code.

In managed server handlers prefer zero.observability.emitCode/emitEvent/
warn/error/info, which bind the runtime; don't change an ambient process sink
to choose a tenant. Authority-scoped machine services expose emission, not
their runtime's readable store.

Standalone synthetic emission example:

```ts
import { configureObservability, emitPlatformCodeTo, OBS_CODES } from '@zero/framework/observability';

const runtime = configureObservability({ console: false, maxEvents: 10 });
emitPlatformCodeTo(runtime, OBS_CODES.APP_LISTENING, {
  source: 'test',
  metadata: { port: 0 },
});
```

Do not use APP_LISTENING to mean an unrelated app event; application-defined
events can use emitEvent with their own stable category/code/safe message.

## Privacy And Failures

The generic backend normalizer shallowly replaces credential-shaped top-level
metadata keys (token/secret/password/authorization/cookie/credential) with
[redacted]. Valid numeric AI usage-count keys are retained. It does not
recursively remove nested secrets/PII, redact arbitrary message text or sanitize
raw error objects. Feature boundaries may do stronger shaping.

Use safe operational identifiers/counts, not submitted values, messages,
file bytes, credentials or patient data. error is an optional raw internal
channel; custom sinks must redact/serialize it before external export.
Emission is best-effort and returns the normalized event, not an external
delivery/flush acknowledgment.

## Verification And Related Guides

Test exact runtime routing, safe metadata and sink failure isolation with
synthetic events. For durable success signals, emit after the owning commit;
an operational event is not a transaction receipt.

- [Sinks](./sinks.md) owns export/failure handling.
- [Store](./store.md) owns runtime retention/query.
- [Guardian audit](../guardian/audit.md) owns durable security history.
