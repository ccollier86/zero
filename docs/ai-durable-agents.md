# Durable AI Agents With Torrent

Zero's durable agent bridge compiles an immutable
[`defineAIAgent()`](./ai-agents.md) definition into a finite, version-pinned
[Torrent](./workflows.md) graph. Use it when an agent must survive process
restarts, pause for approval, execute bounded tools concurrently, or retain a
private transcript between model decisions.

The bridge does not make arbitrary SDK calls exactly once. It gives every
model decision and tool call a stable execution identity, persists successful
state transitions transactionally, and relies on normal Torrent recovery.
External effects remain at least once and must honor the supplied idempotency
key.

## Runtime Shape

One durable run is deliberately split across four boundaries:

| Boundary | Responsibility |
| --- | --- |
| `AIDurableAgentWorkflowRuntime` | Registers trusted activities and compiles each exact agent name/version into an immutable Torrent graph. |
| `AIDurableAgentService` | Starts actor/system runs, returns scope-checked progress/results, and submits approvals. |
| Torrent | Persists the run, schedules retries and private fan-out, recovers after restart, and enforces workflow authority/scope. |
| `createExecutionContext` | Rebuilds live app services from the current execution lease for each model/tool activity; it is never persisted. |

The public API is exported from both `@zero/framework/ai` and
`@zero/framework/server`. Agent definitions, tool definitions, and the
ephemeral runner remain the same; durable execution is an additional runtime,
not a second authoring format.

| Public export | Purpose |
| --- | --- |
| `AIDurableAgentWorkflowRuntime` / `RegisterAIDurableAgentOptions` / `RegisteredAIDurableAgent` | Compile and identify exact code-owned agent versions. |
| `AIDurableAgentService` / `AIDurableAgentServiceDependencies` / `AIDurableAgentRespondOptions` | Bind the recovered `WorkflowService`, then start, inspect, read, and answer scope-bound runs. |
| `AIDurableAgentRunInput` | Typed prompt/messages plus validated runtime and per-tool context. |
| `AIDurableAgentProgress` / `AIDurableAgentResult` / `AIDurableAgentTerminalError` | Payload-free operational progress plus scope-checked completed or secret-free failed/cancelled terminal results. |
| `AIDurableAgentLiveExecutionContext` / `AIDurableAgentExecutionContextFactory` | Reconstruct non-serializable live services for the current authority lease. |
| `AIDurableAgentRuntimeOptions` | App-local catalog, execution-context factory, observer, optional standalone model-execution preparer, compatibility resolver, and clock. |
| `AIDurableAgentApprovalResponse` | Bounded `{ approved, reason? }` interaction response. |
| `AIDurableAgentPublicEnvelope` / `AI_DURABLE_AGENT_STATE_VERSION` | Versioned safe run identity stored in the public Torrent input. |
| `AI_DURABLE_AGENT_MAX_PRIVATE_VALUE_BYTES` / `AI_DURABLE_AGENT_MAX_PRIVATE_STATE_BYTES` / `AI_DURABLE_AGENT_MAX_PRIVATE_STATE_ENTRIES` / `AI_DURABLE_AGENT_MAX_CONTEXT_AND_TOOL_BYTES` | Public durable-state ceilings described under [Bounds, Timeouts, And Telemetry](#bounds-timeouts-and-telemetry). |

## Register Before Recovery, Bind After Publication

Managed apps have a two-phase lifecycle. Construct and populate the durable
runtime inside `workflows.register`, before Torrent performs recovery. Bind
the service inside `workflows.onServiceCreated`, after the recovered
`WorkflowService` is ready:

```ts
import {
  AIAgentRegistry,
  AIDurableAgentService,
  AIDurableAgentWorkflowRuntime,
  defineZeroConfig,
  type RegisteredAIDurableAgent,
  type WorkflowExecutionServerServices,
} from '@zero/framework/server';
import { tables } from './db/schema';
import { analyst } from './ai/agents/analyst';

type AgentExecutionContext = {
  zero: WorkflowExecutionServerServices;
  idempotencyKey: string;
  assertCurrentAuthority: () => void;
};

const catalog = new AIAgentRegistry();
let durableRuntime: AIDurableAgentWorkflowRuntime<
  AgentExecutionContext,
  WorkflowExecutionServerServices
> | null = null;
let analystDescriptor: RegisteredAIDurableAgent | null = null;
let durableAgents: AIDurableAgentService<
  AgentExecutionContext,
  WorkflowExecutionServerServices
> | null = null;

export function requireDurableAgents() {
  if (!durableAgents || !analystDescriptor) {
    throw new Error('Durable AI agents are not ready.');
  }
  return { service: durableAgents, analyst: analystDescriptor };
}

export default defineZeroConfig({
  db: { mode: 'file', path: './data/app.db' },
  tables,
  auth: true,
  ai: true,
  workflows: {
    async register(registry, { ai }) {
      if (!ai) throw new Error('AI must be enabled for durable agents.');
      durableRuntime = await ai.createDurableAgentRuntime<
        AgentExecutionContext,
        WorkflowExecutionServerServices
      >(registry, {
        agents: catalog,
        createExecutionContext(live) {
          live.assertCurrentAuthority();
          if (!live.zero) throw new Error('Managed Zero services are unavailable.');
          return {
            zero: live.zero,
            idempotencyKey: live.idempotencyKey,
            assertCurrentAuthority: live.assertCurrentAuthority,
          };
        },
        observer: event => recordAgentLifecycle(event),
      });
      analystDescriptor = durableRuntime.register(analyst, {
        access: {
          start: ['member'],
          inspect: ['member'],
        },
      });
    },
    onServiceCreated(workflows) {
      if (!durableRuntime) throw new Error('Durable agent runtime is not registered.');
      durableAgents = new AIDurableAgentService(durableRuntime, { workflows });
    },
  },
});
```

The registration context supplies this app's isolated `AIService` as `ai` (or
`null` when AI is disabled). `ai.createDurableAgentRuntime()` is asynchronous,
so the registration callback must await it. The factory binds string references
such as `smart` and `bedrock/<model>` to the same provider registry and aliases
used by ordinary app AI calls. Each string-model activity also crosses the
same capability-admission, DNS-pinned prompt-download, request-telemetry, and
content-free SDK lifecycle boundary as ordinary managed generation. Standalone
composition can construct `AIDurableAgentWorkflowRuntime` directly and provide
`prepareModelExecution` with equivalent policy. The narrower `resolveModel`
option remains for compatibility but cannot provide that complete managed
boundary by itself. A definition that embeds a concrete model object does not
need a resolver and still receives Zero's safe downloader and lifecycle adapter.

Do not register durable agents after `createApp()` starts, from a request
handler, or from `onServiceCreated`. Torrent must know every exact definition
before it validates and resumes stored runs. `getWorkflowService()` remains a
compatibility getter and is not the preferred managed-app binding path.

## Start Runs Under Explicit Authority

An authenticated adapter starts a run with the exact live Guardian actor and
a synchronous commit-time authority assertion:

```ts
const { service, analyst } = requireDurableAgents();

const runId = await service.startAsActor(
  analyst,
  {
    prompt: 'Review account acct_123.',
    runtimeContext: {
      tenantId: authority.tenantId,
      actorId: authority.userId,
    },
    toolsContext: {
      lookup: { collection: 'accounts' },
    },
  },
  authority,
  assertCurrentAuthority,
);
```

`startAsActor()` validates the same typed runtime/tool contexts as the
ephemeral runner, enforces the compiled workflow's `access.start` policy, pins
the exact agent and workflow versions, and rechecks authority in the final
writer transaction. It returns the Torrent run ID.

Trusted jobs use `startAsSystem()` with an explicit audited Torrent principal,
reason, and, where applicable, tenant/application scope:

```ts
const runId = await service.startAsSystem(analyst, input, {
  principal: 'nightly-account-review',
  reason: 'Review accounts selected by the scheduled policy',
  scope: tenantScope,
});
```

Never turn a request-provided tenant ID into a system scope. Resolve scope from
Guardian/Fabric authority or server-owned job configuration.

## Read Progress And Results

Both reads require a trusted `ServiceDataScope` and hide cross-scope runs as
not found:

```ts
const progress = service.getProgress(runId, tenantScope);
const result = service.getResult(runId, tenantScope);
```

`getProgress()` is safe for an authorized operational UI. It includes only the
agent name/version, tenant ID, status, step labels/status/timestamps, safe
interaction identifiers/labels/status/timestamps, and a stable secret-free
terminal error when the run failed or was cancelled. It omits prompts,
messages, contexts, tool arguments/results, approval bodies, and scratch
memory.

`getResult()` returns `null` while a run is nonterminal (`pending`, `running`,
or `paused`). After the same scope check, a completed value contains the final
structured `output` when configured, text, finish reason, turn count, and
tool-call count. Failed and cancelled runs return a terminal result with
status, turn/tool-call counts, and a stable secret-free `{ code, message }`
error; they never expose Torrent's internal error text or partial model/tool
payloads. Expose this through a narrow app route with the app's own read
permission; it is not a general browser Sync payload.

## Durable Tool Approvals

One or more calls with `approval: 'user-approval'` (or a context-sensitive rule
that returns it) open one Torrent `requestAndWait` interaction for that model
decision. Its private request retains the bounded call identities and reasons;
the Boolean response approves or denies that pending group. Find the open
interaction through `getProgress()` and submit it through the durable service:

```ts
const interaction = progress.interactions.find(item => item.status === 'open');
if (!interaction) throw new Error('No approval is pending.');

await service.respondToApproval({
  runId,
  interactionId: interaction.interactionId,
  submissionId: stableSubmissionId,
  response: {
    approved: true,
    reason: 'Reviewed in the operations console.',
  },
  actor: {
    actorId: authority.userId,
    tenantId: authority.tenantId,
    roles: resolvedResponderRoles,
  },
  scope: tenantScope,
  assertCurrentResponder,
  channel: 'operations-console',
});
```

Configure `AppWorkflowsConfig.interactionAuthority` when responders can differ
from the starter. Torrent checks that policy and calls
`assertCurrentResponder` inside the accepting transaction. Reuse one stable,
opaque `submissionId` when retrying the same response: an identical replay is
idempotent, while a conflicting response for that ID fails with
`WORKFLOW_INTERACTION_SUBMISSION_CONFLICT`. Approval reasons are limited to
512 characters. A denied call is returned to the next model decision as an
`execution-denied` tool result; its app-owned tool function is not invoked.

Ephemeral agents use the signed AI SDK approval-message contract described in
[AI Agents](./ai-agents.md#tool-approval-and-hmac-signing). Durable agents use
Torrent's authenticated, scope-bound interaction ledger instead. Do not accept
an unsigned browser decision and write it directly into workflow memory.

## Private Durable State

The public Torrent input contains only a versioned envelope with the agent
name and version. The prompt/messages, runtime context, per-tool contexts,
model transcript, tool calls/results, approval bodies, and final result are
stored in chunked underscore-prefixed Torrent scratch memory.

Two Torrent contracts make that boundary possible:

- `WorkflowStartOptions.initialMemory` seeds private graph scratch memory in
  the same transaction that creates the run, seals authority, and pins the
  workflow version. The HTTP start route cannot supply it, and legacy
  sequential workflows reject it.
- `each(..., { visibility: 'private' })` keeps tool fan-out source items,
  child inputs, and child outputs out of public run/step rows. The payloads
  remain in private workflow state while safe step topology and status remain
  observable.

These are server projection controls, not at-rest encryption or a secret
vault. Keep provider credentials out of agent state. See
[Torrent: private memory and fan-out](./workflows.md#reactivedb-backed-scratch-memory)
for the underlying limits and transaction semantics.

## Live Services And Authority Fences

`createExecutionContext` runs separately for every model, approval, tool, and
finalize activity. Its `AIDurableAgentLiveExecutionContext` contains:

- `runId`, `phase`, and `turn`
- optional `toolName` and `toolCallId`
- a stable per-activity `idempotencyKey`
- Torrent's current execution identity
- the request-equivalent, scope-closed `zero` services when managed composition
  provides them
- `assertCurrentAuthority()`

The bridge checks authority before and after rebuilding this context and
around provider/tool effects. A resumed run whose Guardian membership,
credential, role, or tenant authority was revoked cannot continue using the
old decision. App tools must still use the scope-closed services and call the
assertion immediately around any additional sensitive effect.

Do not return raw Guardian objects, database connections, provider clients, or
closures from serializable runtime/tool context. Rebuild those live values in
`createExecutionContext`; Zero never writes that returned execution context to
Torrent.

## Recovery, Versions, And Idempotency

Every model decision is one persisted Torrent step. Tool calls from that
decision execute as a private `each` fan-out, concurrently up to the agent's
`maxToolCallsPerStep`, and reassemble in provider order. A committed approval
wait resumes after restart without rerunning the preceding decision.

Deployments must re-register every exact agent version required by a
nonterminal run before Torrent recovery. Changing instructions, tools, access,
limits, timeouts, or other behavior requires a new agent `version`; do not
mutate an existing version in place. The bridge derives and pins the matching
Torrent workflow identity and does not select a floating latest version.

Model and tool activities expose deterministic keys such as
`workflow:<run>:model:<turn>` and
`workflow:<run>:tool:<turn>:<toolCallId>`. Pass the tool key through to APIs,
outboxes, or unique database claims that support idempotency. A crash can occur
after an external provider/effect succeeds but before the Torrent transaction
commits, so a retry may repeat that call even though Torrent itself does not
lose the run state.

## Bounds, Timeouts, And Telemetry

Durable agents enforce the definition's normal hard limits for steps, total
tool calls, calls per step, context bytes, individual tool-result bytes, and
aggregate tool-result bytes. The bridge adds these fixed public capacity
ceilings:

| Export | Ceiling | Meaning |
| --- | ---: | --- |
| `AI_DURABLE_AGENT_MAX_PRIVATE_VALUE_BYTES` | 10 MiB | Canonical JSON bytes for any one chunked private value. |
| `AI_DURABLE_AGENT_MAX_PRIVATE_STATE_BYTES` | 14 MiB | Exact stored JSON-value bytes available to all private durable-agent state. |
| `AI_DURABLE_AGENT_MAX_PRIVATE_STATE_ENTRIES` | 3,584 | Private rows available to manifests, chunks, control state, calls, results, and approvals. |
| `AI_DURABLE_AGENT_MAX_CONTEXT_AND_TOOL_BYTES` | 8 MiB | Maximum combined declared runtime/tool-context budget plus cumulative tool-result budget. |

Registration rejects a definition whose declared context and cumulative
tool-result ceilings total more than 8 MiB. Start-time seeds and every activity
transition are capacity-checked before state is committed. The underlying
per-run Torrent memory policy retains bounded internal headroom for chunking
and control metadata; applications should depend on the four exported agent
limits above, not that internal allocation.

Durable agents retain schema validation, structured `AIOutput`,
provider-neutral reasoning/options, and per-tool timeout overrides. The total
deadline is calculated once at start and persists across waits and restarts;
pausing the process does not reset it.

Torrent retries failed trusted activities under its normal attempt/lease
rules. Tool activities are configured for bounded retries and model,
approval, assembly, and finalization nodes do not become unbounded provider
loops. Exhausting `maxSteps` fails the run with
`AI_AGENT_EXECUTION_LIMIT_EXCEEDED` rather than recursively extending the
graph.

The runtime uses the same redacted `AIAgentObserver` contract as ephemeral
agents and reports committed cancellation as `run.cancelled`. A private receipt
records one start and exactly one committed terminal state—`completed`,
`failed`, or `cancelled`—and fences duplicate logical event emission across
activity retries, recovery replay, and repeated reads. Observer delivery is
best-effort rather than a transactional external exactly-once guarantee;
scope-checked progress/result state and Torrent's committed rows are
authoritative. Lifecycle records contain agent/run/step/tool
identities, attempt correlation, and timing, never prompts, messages, tool
input/output, contexts, approval bodies, or secrets. Torrent additionally emits
its normal workflow scheduling, retry, wait, recovery, and terminal-state
events. See [Observability](./observability.md).

`AIDurableAgentService.dispose()` releases only this facade's lifecycle
subscription; it does not cancel Torrent runs. Call it when direct composition,
tests, or hot reload discard a bound service before the process exits.

Stable AI errors use the codes listed in [AI Agents](./ai-agents.md#stable-errors).
Torrent interaction, authority, state-integrity, and submission conflicts keep
their workflow error codes so an operator can distinguish an agent contract
failure from durable orchestration failure.

## Related Documentation

- [AI Agents](./ai-agents.md)
- [AI Generation And Streaming](./ai-generation.md)
- [AI Tools](./ai-tools.md)
- [Torrent: Durable Workflows](./workflows.md)
- [Guardian Auth And Authorization](./auth/README.md)
- [Observability](./observability.md)
