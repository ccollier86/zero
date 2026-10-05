---
id: zero.runtime.observability
type: operations
audience: [developer, agent, operator]
owner: platform-runtime
status: draft
visibility: internal
system: platform-runtime
feature: observability
maturity: supported
applies_to: ["2.1.1 source; new documentation under review"]
modes: [managed-server]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Runtime Errors And Operational Events

[Runtime index](./index.md) · [Documentation index](../../index.md)

Runtime diagnostics use Zero's structured observability boundary. App-local
services emit through the runtime they belong to; request projections add
authority attribution. This is distinct from returning a safe HTTP error to
an application user.

## Safe Transport Errors

[Declarative endpoints](./endpoints.md#errors) map request validation to
`ZERO_REQUEST_VALIDATION_FAILED` (422), body parsing to
`ZERO_REQUEST_PARSE_FAILED` (400), and response validation to
`ZERO_RESPONSE_VALIDATION_FAILED` (500). Guardian failures retain their safe
`AuthError` status/code.

Do not reflect rejected request bodies, credentials, parser internals or schema
details. A custom domain service needs a deliberate safe error boundary;
arbitrary thrown errors are not a supported user-facing message.

## Runtime Code Families

| Code constant | Meaning |
| --- | --- |
| `APP_CLIENT_BUNDLE_READY` / `FAILED` | client asset build outcome; failed can leave SSR-only operation |
| `APP_STYLES_READY` / `FAILED` | stylesheet outcome; failed can leave unstyled rendering |
| `APP_REQUEST_VALIDATION_REJECTED` | request schema rejection |
| `APP_REQUEST_PARSE_REJECTED` | request parse rejection |
| `APP_RESPONSE_VALIDATION_FAILED` | invalid server response |
| `APP_REQUEST_FAILED` / `SLOW` | request operational failure/threshold warning |
| `APP_LIFECYCLE_FAILED` / `SLOW` | lifecycle failure/threshold warning, including shutdown |
| `APP_SHUTDOWN_SIGNAL` | received managed shutdown signal |

Constants come from `OBS_CODES` in `@zero/framework/observability`; emitted
events carry a dotted machine code, formatted prefix, severity, category,
timestamp and runtime sequence. HTTP error codes and event codes serve different
consumers—do not assume they are interchangeable strings.

## Emit Through The Current App

For example, inside an already admitted endpoint/service context:

```ts
zero.observability.emitEvent({
  level: 'info',
  category: 'example',
  code: 'example.export.completed',
  message: 'Export completed.',
  metadata: { itemCount: 20 },
});
```

This is a *handler fragment*, not a global logger initialization example.
Use an appropriate stable application code for your domain. Do not falsely
emit a framework failure code for unrelated business activity.

Request-scoped emitters bind user/request and immutable scope metadata, with
authority metadata taking precedence over application-supplied values. Strict
machine projections expose these emitters but not raw sink/store inspection.
Setup code may use explicitly injected app-local runtime helpers.

## Sinks And Privacy

A sink can receive a raw `error`; its serialization/redaction is the sink's
responsibility. The default redaction machinery is not proof that every nested
custom payload, prompt or stack trace is safe for external export.

Use safe operation identifiers, codes, phases, counts and outcomes. Do not emit
authorization headers, passwords, provider credentials, PHI or whole failed
request records. Keep the user-facing message separate from a sanitized operator
diagnostic.

A custom sink is a best-effort observer, not the transaction authority.
Diagnostics must not replace a shutdown failure or prevent other cleanup
owners from running. Observability is not a durable replay queue.

## Configuration And Checks

`AppConfig.observability` controls the containing runtime. Trace and default
HTTP event access are separately configurable; tracing is not automatically
enabled by merely supplying a sink. Keep production event reading/ingest policy
explicit.

Test error envelopes with synthetic invalid input, app-local sink separation,
scope attribution and safe metadata. Test failure of the diagnostic sink
without replacing the original lifecycle failure.

## Related Guides And Next Steps

- [Endpoints](./endpoints.md#errors) owns safe transport mapping.
- [Shutdown](./shutdown.md) joins cleanup while collecting errors.
- [Machine services](./machine-services.md) exposes only attributed emitters.
- [Service boundaries](../../concepts/service-boundaries.md) prevents request code from inspecting global logs.
