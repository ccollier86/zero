---
id: zero.vector.errors
type: reference
audience: [developer, agent, operator]
owner: vector
status: draft
visibility: internal
system: vector
feature: errors
maturity: supported
applies_to: ["2.1.1 baseline with unreleased scope/capacity corrections"]
modes: [server-only, named-local-indexes]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Vector Errors And Operational Events

[Vector index](./index.md) · [Documentation index](../../index.md)

VectorError carries code, message and metadata. Current codes distinguish
invalid configuration, missing index, dimension mismatch, invalid filter,
invalid metadata, scope conflict, backpressure and operation failure.

## Domain Versus Partial Results

Configuration/filter/dimension failures throw. Native upsert/delete operations
can instead return {ok:false,count,errors}; inspect both promise acceptance and
the operation result. Provider issue messages are not automatically safe to
show to an untrusted user.

VECTOR_SCOPE_CONFLICT and VECTOR_BACKPRESSURE use value-free messages.
Backpressure metadata contains only capacity category. Other errors can contain
configured index/field names and local provider causes; do not blindly serialize
the entire exception as a public response.

## Standard Telemetry

Vector lifecycle/operation events use Zero's standard VECTOR_* observability
codes. Normal metadata includes index/operation/count/timing/filter field names,
not record text, embeddings or filter values. A raw thrown provider error may
still need app-level redaction; safe normal metadata is not a universal privacy
guarantee.

Corrected managed service and default adapter events use a captured app-local
emitter. Missing managed Observability dependencies reject before service
publication. Standalone compatibility and custom prebuilt objects retain their
explicitly owned emitter behavior. Startup composition failure is
VECTOR_CONFIG_INVALID with a safe composition stage; cleanup failure uses the
standard app lifecycle event without publishing caller callback details.

A denied write must remain denied. Do not retry it unscoped or route to a direct
native adapter. Capacity failure can be retried according to the app's bounded
backoff; a partial provider write requires inspecting its result rather than
assuming an entirely unapplied batch.

See [observability](../observability/index.md), [records](./records.md),
[scopes](./scopes.md), [operations](./operations.md) and [configuration](./configuration.md).
