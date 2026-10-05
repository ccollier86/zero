---
id: zero.ai.durable-agents
type: how-to
audience: [developer, agent, operator]
owner: ai
status: draft
visibility: internal
system: ai
feature: durable-agents
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


# Durable Agents On Torrent

[Zero AI](./index.md) · [Ephemeral agents](./agents.md) · [Documentation index](../../index.md)

A durable agent compiles an exact code-owned agent definition into a finite
Torrent graph. Each model decision, approval boundary and tool execution is a
separate persisted activity. Runs can recover after restart and expose safe
progress without publishing prompts, runtime context or tool payloads.

This is not an ephemeral ToolLoopAgent persisted by serializing its process.
Torrent owns durable execution identity, activity attempts, private scratch
memory, interactions, cancellation and committed transitions.

## Install Before Workflow Startup

Create the runtime during workflows.register, when the app-local AI service
exists but workflow handlers/definitions have not yet been published. Register
every exact agent version needed by new or recoverable runs. The returned
descriptor binds a definition to a generated workflow name/version; callers
should retain it rather than construct that internal identity.

Managed configuration fragment, with ai configuration and tables supplied by
the containing app:

```ts
import {
  AIAgentRegistry,
  AIDurableAgentService,
  defineAIAgent,
  type AIDurableAgentWorkflowRuntime,
} from "@zero/framework/ai";

const definition = defineAIAgent({
  name: "summarizer",
  version: "1",
  model: "smart",
  instructions: "Summarize accurately and briefly.",
  tools: {},
  limits: { maxSteps: 2 },
  timeout: { totalMs: 60_000 },
});
const catalog = new AIAgentRegistry();
let runtime: AIDurableAgentWorkflowRuntime;
let durable: AIDurableAgentService;

// Inside createApp configuration:
workflows: {
  async register(registry, context) {
    if (!context.ai) throw new Error("The app requires AI.");
    runtime = await context.ai.createDurableAgentRuntime(registry, {
      agents: catalog,
    });
    runtime.register(definition);
  },
  onServiceCreated(workflows) {
    durable = new AIDurableAgentService(runtime, { workflows });
  },
}
```

This fragment omits the enclosing configuration. It is not a standalone script.
The service facade should be created
after the WorkflowService exists and disposed by the app's extension lifecycle;
see [runtime lifecycle](../runtime/lifecycle.md) and
[shutdown](../runtime/shutdown.md).

AIDurableAgentWorkflowRuntime.register accepts an optional Torrent definition
access policy. Duplicate agent name/version or a different definition already
bound to that exact registry identity is rejected. The installed internal
activities are trusted code and not database-callable functions.

## Start With Live Authority

AIDurableAgentService exposes:

| Method | Authority/data contract |
| --- | --- |
| startAsActor(reference, input, actor, assertCurrentAuthority) | Live Guardian actor with a synchronous authority fence; Torrent captures its execution identity. |
| startAsSystem(reference, input, system) | Explicit audited system principal/reason, with the intended Torrent scope. |
| getProgress(runId, scope) | Scope-checked payload-free state, steps and interactions. |
| getResult(runId, scope) | Null while nonterminal; authorized private result or safe failure/cancellation projection when terminal. |
| respondToApproval(options) | Exact run/interaction/submission binding, responder identity/scope and live fence. |
| dispose() | Removes this facade's committed-transition subscription, not the app's workflow service. |

Inputs contain prompt or model messages, runtimeContext and toolsContext.
They must be JSON-safe; binary buffers, functions, live services and cycles do
not belong in durable input. Store authorized media externally and reference
it through the intended provider/storage contract.

Actor-based start must use the real request actor/fence. A browser-selected
organization ID or fabricated AuthContext is not authority. System start is
trusted server functionality, not a way to bypass user revocation. Public
request services and scope selection are explained in
[server services](../runtime/server-services.md).

## Rebuild Execution Services Per Attempt

Durable runtime options accept agents, prepareModelExecution, the deprecated
resolveModel compatibility resolver, createExecutionContext, observer, emitCode
and a test clock now. The managed AIService helper binds provider aliases,
capability policy, safe downloads and app-local telemetry automatically.

createExecutionContext receives runId, phase, turn, optional tool name/call ID,
a stable idempotencyKey, live execution identity, scoped zero services and
assertCurrentAuthority. It may return services asynchronously; authority is
fenced before and after that derivation. The result is never persisted as
runtime/tool context.

Use this factory to rebuild the application's authority-bound service wrapper
for model, approval, tool or finalize phases. Tool effects should use the
provided stable key as part of their domain idempotency design. Retries may
repeat an external call whose result was not committed; durable persistence is
not a transactional exactly-once guarantee for arbitrary remote effects.

## Decisions, Parallel Tools And Approvals

Each turn runs one model decision with SDK tool schemas but without executing
handlers in that call. Selected calls are validated and reserved in private
state. Approval policies are evaluated behind live fences. A user-approval
decision creates a Torrent requestAndWait interaction containing safe labels
and call IDs/reasons, not raw tool input.

respondToApproval requires runId, interactionId, submissionId, response,
actor, scope and assertCurrentResponder; optional channel defaults to agent.
The response is approved plus an optional reason. Replaying the same submission
is idempotent; reusing its identity for conflicting content is rejected.
Responder tenant/scope and exact interaction-to-run binding are checked.

Durable approval uses Torrent's persisted interaction/authority ledger. It is
not the ephemeral runner's SDK approvalSecret protocol. Email/SMS/UI delivery
is app integration; authenticate callbacks and target one exact interaction.
Do not turn one reply into approval for every waiting run.

Admitted tool calls fan out with concurrency bounded by
maxToolCallsPerStep. Every pending result receives a reserved byte share before
parallel side effects start, so independently staged results cannot jointly
overrun retained capacity. Tools return privately stored results, then the
assemble activity adds their ordered transcript to the next decision.
Configured limits bound the finite graph; reaching the turn limit fails rather
than starting an unbounded loop.

## Private State And Capacity

The public input is only kind, stateVersion and agent name/version. Prompts,
contexts, transcripts, tool input/output, approval decisions and lifecycle
receipts live in Torrent private memory. Normal workflow rows/Sync progress do
not publish these payloads. getResult is the deliberate scope-checked private
read, not a general public progress projection.

| Exported durable envelope | Maximum |
| --- | ---: |
| AI_DURABLE_AGENT_MAX_PRIVATE_VALUE_BYTES | 10 MiB canonical JSON for one chunked value |
| AI_DURABLE_AGENT_MAX_PRIVATE_STATE_BYTES | 14 MiB exact stored JSON-value bytes |
| AI_DURABLE_AGENT_MAX_PRIVATE_STATE_ENTRIES | 3,584 private entries |
| AI_DURABLE_AGENT_MAX_CONTEXT_AND_TOOL_BYTES | 8 MiB combined declared context/cumulative tool-result budget |

Registration rejects definitions whose context plus cumulative result limits
exceed the 8 MiB envelope. Start validates seed capacity before creating workflow
rows; activity capacity admission includes pending parallel-result reservations.
Private manifests/chunks allow large values without making them Sync-visible.
Torrent's extra internal headroom is not additional public AI capacity.

The definition's total timeout becomes a persisted deadline. Per-model and
tool execution use the remaining deadline and configured local limits;
cancellation remains cooperative for app services. Store providers/model
definitions and exact agent versions needed for recovery.

## Progress And Lifecycle

Progress includes status, currentStep, timestamps, safe steps and interaction
summaries. It deliberately excludes messages, input/output payloads and full
interaction requests. An app may observe the authorized workflow projections
through ReactiveDB for live UI; the durable facade itself is not a browser hook
or a bundled agent dashboard.

Lifecycle receipts commit with persisted Torrent state, fencing one logical
run.started and terminal transition across retries/restart. External observer
delivery happens after commit and remains best effort; it is not guaranteed
exactly-once delivery. Persisted progress/result is authoritative.

## Related Guides And Next Steps

Use [tools](./tools.md) to define handlers and app authority, and
[agents](./agents.md) for shared definition/settings contracts.
[Torrent integration](./torrent-integration.md) covers the lighter one-AI-call
workflow adapter. [Security](./security.md) explains privacy/media boundaries;
[operations](./operations.md) explains recovery diagnostics and safe events.
