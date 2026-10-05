---
id: zero.ai.tools
type: how-to
audience: [developer, agent, operator]
owner: ai
status: draft
visibility: internal
system: ai
feature: tools
maturity: supported
applies_to: ["2.1.1 source baseline"]
modes: ["managed Bun server", "standalone Bun service", "Torrent-backed durable agent"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---


# Tools, Typed Contexts And Approvals

[Zero AI](./index.md) · [Generation controls](./generation-controls.md) · [Documentation index](../../index.md)

A model can request a tool call; the application owns the actual operation.
Zero provides a small compatibility helper for ordinary conversation calls and
a richer immutable blueprint for bounded agents. Neither grants access to a
user's records merely because a tool name appears in a model response.

## Choose The Tool Contract

| Surface | Intended use | Context and lifecycle |
| --- | --- | --- |
| `aiTool()` + `defineAITools()` | Existing conversation/generation integrations | JSON Schema input; app-owned execute callback; tool-failure event. |
| Native SDK-compatible tools in generation options | SDK tool features through Zero's generation boundary | `toolsContext`, `runtimeContext`, approvals, callbacks and timeouts have the generation SDK shapes. |
| `defineAIAgentTool()` | Reusable tools inside Zero agents | Typed input/output/runtime/tool/execution context, validation, per-run materialization and bounded results. |

Do not pass an agent blueprint directly as a native generation tool. The agent
runner materializes it into an SDK tool for each run. Blueprint identity,
schemas and app-owned handler are reusable; run authority and cancellation are
not shared between runs.

## Compatibility Helper

This complete server-side helper assumes the caller has already authorized an
app-specific lookup function. Elysia's JSON Schema-compatible `t.*` objects
work as `input`; the callback must enforce current domain access.

```ts
import { t } from "elysia";
import { aiTool, defineAITools } from "@zero/framework/ai";

export function createLookupTools(
  lookup: (id: string) => Promise<{ title: string }>,
) {
  return defineAITools({
    lookup: aiTool<{ id: string }, { title: string }>({
      description: "Read one record visible to the current actor.",
      input: t.Object({ id: t.String({ minLength: 1 }) }),
      execute: ({ id }) => lookup(id),
    }),
  });
}
```

An omitted input schema is an empty object with `additionalProperties: false`.
Omitted `execute` leaves execution to the surrounding application/SDK flow.
`defineAITools()` rejects blank names with `AI_TOOL_INVALID`; it does not
register a persistent tool catalog or replace app input/permission validation.
The compatibility helper emits a sanitized failure event and rethrows the
handler error; callers still handle the operation's failure.

## Typed Agent Blueprint

The generic order is input, output, tool context, runtime context and execution
context. Runtime/tool contexts are bounded serializable data; execution context
is trusted in-process services. This complete blueprint uses an app-installed
`zod` dependency, not an assumed framework transitive dependency.

```ts
import { z } from "zod";
import { defineAIAgentTool } from "@zero/framework/ai";

type Runtime = { organizationId: string; actorId: string };
type ToolContext = { collection: string };
type Execution = {
  lookupVisibleRecord(input: {
    organizationId: string;
    actorId: string;
    collection: string;
    id: string;
    signal?: AbortSignal;
  }): Promise<{ title: string }>;
};

export const lookupRecord = defineAIAgentTool<
  { id: string }, { title: string }, ToolContext, Runtime, Execution
>({
  description: "Look up a record the current actor is allowed to read.",
  inputSchema: z.object({ id: z.string().min(1) }),
  outputSchema: z.object({ title: z.string() }),
  contextSchema: z.object({ collection: z.string().min(1) }),
  execute: (input, ctx) => ctx.executionContext.lookupVisibleRecord({
    organizationId: ctx.runtimeContext.organizationId,
    actorId: ctx.runtimeContext.actorId,
    collection: ctx.toolContext.collection,
    id: input.id,
    signal: ctx.abortSignal,
  }),
});
```

The tool receives definition name/version, runId, toolName/toolCallId, model
messages, frozen runtime context, its own tool context, execution context and
the cooperative abort signal. Output-schema validation happens before a
bounded detached result is returned to the model. A failed result does not
undo a side effect that already happened; write tools need domain idempotency.

The runtime validates tool context schemas, rejects unknown tool-context keys,
supplies an empty object for omitted contexts, and snapshots the combined data
within the agent's context budget. Put database clients, authority-bound
services and functions in executionContext, never serializable runtimeContext.

## Approval Policy And Signing

Agent tool-local and agent-wide approvals accept the statuses
`not-applicable`, `approved`, `denied` and `user-approval`, or their object
forms. Objects may contain `type` and an optional reason of at most 512
characters; not-applicable cannot carry a reason. Policy functions may be
asynchronous.

A global status/function wins for the whole agent. Otherwise a per-tool
agent override wins over the blueprint's tool-local rule. A per-tool rule gets
typed input and run/tool contexts; a global function gets the discriminated
tool call and all tool contexts. The execution-context service is available to
evaluate current authority. An approval policy must not substitute cached
membership for a live permission check.

Ephemeral runners default to `requireSignedApprovals: true`. If any approval
policy is declared, configure `approvalSecret` as a server-only string or
Uint8Array containing 32 through 65,536 bytes; byte inputs are copied. Missing
required signing configuration rejects before model execution with
`AI_AGENT_APPROVAL_CONFIG_INVALID`. Do not print or send the secret to clients.

A user-approval request can return in SDK result content with a signature
instead of executing the tool. It is not an automatically persisted wait or a
built-in approval UI. An application continuing an ephemeral exchange must
retain and verify the SDK approval protocol; durable agents provide the
persisted, run-specific alternative.

Ordinary generation exposes `toolApproval` and `toolApprovalSecret` through
[generation controls](./generation-controls.md), with the SDK contract rather
than the agent runner's mandatory-signing default. A signature binds approval
content; it does not grant a Guardian role, validate webhook ownership or make
an external write exactly-once.

## Failure And Verification

Agent handlers normalize non-limit/non-abort failures to
`AI_AGENT_TOOL_EXECUTION_FAILED`; private causes are not copied to standard
lifecycle events. Execution limits are checked before admitting tool side
effects, and results are schema-validated, detached and byte-accounted.
App observers must keep prompts, inputs and provider credentials private.

Test an unauthorized actor, malformed input/context/output, denied and signed
approval, duplicate external writes, cancellation, and tool/result-budget
exhaustion with provider doubles. A successful tool reply alone is not proof
of permissions or restart recovery. Return to [Zero AI](./index.md) to choose
ephemeral versus durable execution; [operations](./operations.md) explains
safe error and event handling.
