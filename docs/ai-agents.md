# AI Agents

Zero's agent layer provides immutable, versioned, typed, and bounded wrappers
around AI SDK 7 tool loops. It is intended for short-lived server execution.
It does not persist a run, resume after a process crash, or replace Torrent.

Use an ephemeral agent when one server call can finish the job. Use the durable
[Torrent bridge](./ai-durable-agents.md) for work that must survive restarts,
pause for human input, or revalidate authority across long waits.

## Define Typed Tools And An Agent

```ts
import { z } from 'zod';
import {
  AIOutput,
  defineAIAgent,
  defineAIAgentTool,
  getAI,
} from '@zero/framework/server';

type RuntimeContext = { tenantId: string; actorId: string };
type ToolContext = { collection: string };
type ExecutionContext = {
  loadRecord: (collection: string, id: string) => Promise<unknown>;
};

const lookup = defineAIAgentTool<
  { id: string },
  { record: unknown },
  ToolContext,
  RuntimeContext,
  ExecutionContext
>({
  description: 'Load one authorized tenant record.',
  inputSchema: z.object({ id: z.string() }),
  outputSchema: z.object({ record: z.unknown() }),
  contextSchema: z.object({ collection: z.string() }),
  execute: async ({ id }, ctx) => ({
    record: await ctx.executionContext.loadRecord(ctx.toolContext.collection, id),
  }),
});

const analyst = defineAIAgent<
  RuntimeContext,
  ExecutionContext,
  { lookup: typeof lookup },
  ReturnType<typeof AIOutput.object>
>({
  name: 'account.analyst',
  version: '1',
  model: 'smart',
  instructions: 'Use tools, cite the loaded facts, and stay concise.',
  runtimeContextSchema: z.object({
    tenantId: z.string(),
    actorId: z.string(),
  }),
  tools: { lookup },
  output: AIOutput.object({
    schema: z.object({
      summary: z.string(),
      risks: z.array(z.string()),
    }),
  }),
  limits: {
    maxSteps: 8,
    maxToolCalls: 16,
    maxToolCallsPerStep: 4,
  },
  timeout: {
    totalMs: 45_000,
    stepMs: 15_000,
    toolMs: 5_000,
    tools: { lookupMs: 3_000 },
  },
});
```

Definitions and tool blueprints are validated, copied, and frozen. An agent
name/version pair is immutable within a registry; publishing changed behavior
requires a new version. `model` can be a concrete AI SDK model or a normal Zero
alias/provider-qualified string. `ai.createAgentService()` resolves string
models through the owning Zero AI registry.

Names begin with a lowercase letter and contain lowercase letters, numbers,
dot, underscore, or hyphen, up to 128 characters. Versions contain letters,
numbers, dot, underscore, plus, or hyphen, up to 64 characters. Use versions as
immutable behavior identifiers, not mutable display labels.

## Register And Run

```ts
const ai = getAI();
if (!ai) throw new Error('AI is not enabled.');

const agents = ai.createAgentService({
  approvalSecret: Bun.env.ZERO_AI_APPROVAL_SECRET,
  observer: event => recordAgentMetric(event),
});

agents.register(analyst);

const result = await agents.generate(
  { name: 'account.analyst', version: '1' },
  {
    prompt: 'Review account acct_123.',
    runtimeContext: {
      tenantId: authority.tenantId,
      actorId: authority.userId,
    },
    toolsContext: {
      lookup: { collection: 'accounts' },
    },
    executionContext: {
      loadRecord: authorizedRecordLoader,
    },
    abortSignal: request.signal,
  },
);

return result.output;
```

`generate()` returns the native typed SDK result. `stream()` returns the native
typed stream result and settles agent lifecycle telemetry when its terminal
finish reason resolves.

The managed `ai.createAgentService()` path prepares every string model through
the owning `AIService` before a model call. That applies normal alias/provider
resolution, capability admission, Zero request telemetry, content-free SDK
step/model/tool lifecycle events, and the mandatory Bun prompt downloader to
ephemeral agents as well as ordinary generation. A concrete model object still
uses Zero's safe downloader and content-free lifecycle adapter, but it has no
configured provider identity from which to produce provider request telemetry.

Every lookup uses an exact `{ name, version }` reference. Registration rejects
duplicates instead of silently replacing a running definition.

## Three Context Boundaries

The agent layer keeps data and live services intentionally separate:

| Context | Purpose | Contract |
| --- | --- | --- |
| `runtimeContext` | Run-wide identity/correlation/policy facts visible to callbacks and tools. | Schema-validated when configured, JSON-serializable, cloned, bounded, and frozen. |
| `toolsContext` | Per-tool configuration such as collection names or bounded policy inputs. | Each tool can declare `contextSchema`; values are cloned, bounded, and frozen. |
| `executionContext` | Live app services and closures used to perform work. | Not serialized or exposed to the model; app code owns its type and lifecycle. |

This separation prevents one run from mutating another run's context and keeps
database/service handles outside model-visible serializable state.

Context is not authority. Resolve the current Guardian/Fabric scope before the
run and enforce it again inside every sensitive tool. Long-running durable work
must use Torrent's live authority fences rather than retaining a stale browser
session decision.

## Bounded Execution

Every run has conservative defaults even when the definition omits `limits`:

| Limit | Default | Hard ceiling |
| --- | ---: | ---: |
| Model steps | 20 | 64 |
| Tool calls | 64 | 512 |
| Tool calls in one step | 8 | 64 |
| Runtime plus tool context | 256 KiB | 8 MiB |
| One tool result | 256 KiB | 8 MiB |
| All tool results | 1 MiB | 32 MiB |

Tool-call budgets are checked before a tool handler can perform its side
effect. Result-size budgets are checked after the handler returns and before
its result is sent back to the model. Exceeding either aborts the run with
`AI_AGENT_EXECUTION_LIMIT_EXCEEDED`; app-owned effects still need normal
idempotency and authorization.

Agent timeouts use the same total/step/stream-chunk/tool object described in
[AI Generation And Streaming](./ai-generation.md#timeouts-retries-and-cancellation).
A run call can provide a narrower timeout than its definition. Timeouts become
`AI_AGENT_EXECUTION_TIMEOUT`.

## Tool Approval And HMAC Signing

A tool can declare a fixed or context-sensitive approval rule:

```ts
const deleteRecord = defineAIAgentTool<
  { id: string },
  { deleted: boolean },
  Record<string, never>,
  RuntimeContext,
  ExecutionContext
>({
  inputSchema: z.object({ id: z.string() }),
  approval: {
    type: 'user-approval',
    reason: 'Deleting a record cannot be undone.',
  },
  execute: async ({ id }, ctx) => {
    await ctx.executionContext.deleteAuthorizedRecord(id);
    return { deleted: true };
  },
});
```

An agent definition can also set one rule for all tools or per-tool overrides.
The supported decisions are `not-applicable`, `approved`, `denied`, and
`user-approval`, optionally with a bounded reason where applicable.

Signed approvals are required by default whenever an agent has approval
behavior. Configure `approvalSecret` on the agent service/runner with at least
32 bytes of high-entropy server-only material. The AI SDK signs the approval
request and verifies it when replayed so a client cannot fabricate approval for
a different tool call. Signing does not replace Guardian authorization,
idempotency, or a fresh domain-policy check immediately before the effect.

`requireSignedApprovals: false` is an explicit trusted-process compatibility
opt-out. Do not use it when an approval leaves the server process or crosses a
browser, email, chat, webhook, or other user-controlled channel.

The first run returns a `tool-approval-request` content part without executing
the tool. The app presents that request through its chosen UI/channel and sends
the signed approval response back through the SDK message flow.

## Lifecycle And Redaction

An optional observer receives:

- `run.started`, `run.completed`, `run.failed`, and `run.cancelled`; the
  durable bridge reports cancellation only after Torrent commits it
- `step.started`
- `tool.started`, `tool.completed`, and `tool.failed`

Zero emits matching stable platform events. Metadata is limited to agent
name/version, run/step/tool identifiers, and durations. It never includes the
prompt, messages, tool input/output, runtime/tool/execution context, or approval
secret. Observer failure is best-effort and does not change execution.

## Stable Errors

| Code | Meaning |
| --- | --- |
| `AI_AGENT_DEFINITION_INVALID` | A definition, limit, timeout, version, name, tool, or schema contract is invalid. |
| `AI_AGENT_NOT_REGISTERED` | The exact requested name/version is absent. |
| `AI_AGENT_CONTEXT_INVALID` | Runtime/tool context failed schema, cloning, serialization, or byte bounds. |
| `AI_AGENT_APPROVAL_CONFIG_INVALID` | Required signing material is missing or outside its 32-byte through 64-KiB bound. |
| `AI_AGENT_EXECUTION_LIMIT_EXCEEDED` | A model-step, tool-call, or tool-result budget was exceeded. |
| `AI_AGENT_TOOL_EXECUTION_FAILED` | An app-owned tool failed; the original failure remains an internal cause. |
| `AI_AGENT_EXECUTION_TIMEOUT` | The bounded run timed out. |
| `AI_AGENT_EXECUTION_CANCELLED` | A durable agent run reached Torrent's committed cancelled state. |
| `AI_AGENT_EXECUTION_FAILED` | The run failed outside the more specific classifications above. |

## Ephemeral Versus Durable

The ephemeral layer deliberately does not provide:

- process-restart recovery
- durable waits or human-input inboxes
- persisted scratch memory
- exactly-once external effects
- durable fan-out/join state

Use Torrent for those requirements. Durable AI execution persists bounded
model and tool steps separately, keeps private state out of browser
projections, revalidates Guardian authority around resumed effects, and uses
normal Torrent idempotency/recovery contracts. It seeds prompts and contexts
through trusted graph-only `initialMemory` and runs tool fan-out with
`visibility: 'private'`, so public workflow rows retain operational topology
without copying model or tool payloads. Durable definitions also obey a tighter
8-MiB combined declared context-plus-cumulative-tool-result envelope and fixed
private-state ceilings; see
[Durable AI Agents With Torrent](./ai-durable-agents.md) for registration,
authority, approvals, recovery, and idempotency.

## Related Documentation

- [AI](./ai.md)
- [AI Generation And Streaming](./ai-generation.md)
- [AI Tools](./ai-tools.md)
- [Durable AI Agents With Torrent](./ai-durable-agents.md)
- [Torrent: Durable Workflows](./workflows.md)
- [Observability](./observability.md)
