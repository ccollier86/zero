---
id: zero.torrent.activities
type: reference
audience: [developer, agent, operator]
owner: torrent
status: draft
visibility: internal
system: torrent
feature: activities
maturity: supported
applies_to: ["2.1.1 source baseline; not installed-package qualification"]
modes: ["authenticated single-tenant app", "Guardian multi-tenant app", "explicit trusted server composition"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Trusted Activities And Handler Context

[Torrent](./index.md) · [Authoring](./authoring.md) · [Documentation index](../../index.md)

Activities are the trusted code nodes that graph definitions may call.
WorkflowRegistry.registerActivity(definition) uses its WorkflowActivityCatalog;
registerHandler(name, handler) is the legacy compatibility path, registering
activity version "1" with databaseCallable: false.

## Declaration Contract

Fields are name, optional version (default "1"), description, handler,
inputSchema/outputSchema, capabilities, databaseCallable and default.
Duplicate exact name/version is rejected. databaseCallable defaults false.
Capabilities are descriptive metadata, not automatic permission grants or
provider/service entitlements.

The catalog offers register/get/resolve/resolveDatabaseCallable,
setDefault(name, version), validateInput/validateOutput and deterministic list.
An omitted reference version selects explicit default, otherwise deterministic
version ordering. Existing compiled graphs stay pinned.

Input/output schemas are TypeBox/JSON Schema contracts. Input mismatch raises
WORKFLOW_ACTIVITY_INPUT_INVALID; invalid output fails before durable output/
step success. Database graphs can call only explicitly opted-in versions.
A catalog entry does not expose an arbitrary server code executor.

## StepContext

| Member | Purpose |
| --- | --- |
| input, workflowInput | Bound activity input and original run input. |
| instanceId, stepIndex, attempt | Exact run, current node index and zero-based physical attempt. |
| attemptId | Unique physical invocation token; set at runtime despite optional compatibility type. |
| idempotencyKey | Stable logical-step external-effect key. |
| signal | Cooperative cancellation/deadline/shutdown signal. |
| execution | Immutable secret-free actor/system provenance. |
| zero | Installed scope-closed execution services, otherwise null. |
| assertCurrentAuthority() | Synchronous check before an app-owned sensitive effect. |
| memory | Attempt-local private scratchpad when supported by the runtime. |
| item | each item value/index/key. |
| waitEvent | Accepted event metadata/payload for a gated step. |
| interaction | Safe request/response metadata for delivery/validation activities. |

StepHandler<TInput,TServices> is async and returns unknown validated into
JSON-safe runtime output. Use exact service types; do not assert zero is raw
ServerRouteServices. Managed strict services reject unsafe/global access,
including raw AI/email/KV/vector/database handles. Trusted app adapters can be
captured deliberately; their policy/cancellation remain app responsibilities.

The AI registration helper is one example: it captures the app-bound AI service
during trusted configuration, not ctx.zero.ai.
[AI Torrent integration](../ai/torrent-integration.md) documents it.

## Idempotency And Cancellation

Pass signal into external adapters. Call assertCurrentAuthority immediately
before app-owned external/security-sensitive effects. That check cannot undo
remote acceptance after a later authority change.

Use idempotencyKey for the same logical effect across retries; attemptId is for
one physical call, not external deduplication. Different intended effects in a
step need separate derived discriminators. Keep prompts/secrets/response bodies
out of standard logs and public progress.

## Lifecycle And Verification

Registration/compilation finishes before recovery. Old exact activity code
must remain present for old version-pinned runs. A callback exception, invalid
output, timeout or stale attempt cannot commit staged memory/step success.
External effects may already have occurred and require idempotent reconciliation.

Related: [authority](./authority.md), [memory](./memory.md),
[retries](./retries-and-time.md), [operations](./operations.md).
