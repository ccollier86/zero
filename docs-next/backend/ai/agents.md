---
id: zero.ai.agents
type: how-to
audience: [developer, agent, operator]
owner: ai
status: draft
visibility: internal
system: ai
feature: ephemeral-agents
maturity: supported
applies_to: ["2.1.1 source plus uncommitted agent facade inference correction"]
modes: ["managed Bun server", "standalone Bun service", "Torrent-backed durable agent"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---


# Bounded Ephemeral Agents

[Zero AI](./index.md) · [Tools](./tools.md) · [Documentation index](../../index.md)

An ephemeral agent is an immutable named/versioned definition executed through
AI SDK 7 ToolLoopAgent. Zero adds typed contexts, result budgets, cancellation,
approval configuration and content-free lifecycle events. Runs remain
process-local: they are not persisted and do not survive a process restart.

The facade's absent execution-context inference correction is an authorized
working-source change from 2026-10-05, not yet a new committed/package baseline.
Simple runs no longer require a meaningless executionContext property; callers
declaring a non-undefined execution context still must supply the matching value.

## Define, Register And Run

This complete server-side function assumes an already configured AIService and
an authorized, bounded text request. It demonstrates a tool-free agent without
a schema-library dependency.

```ts
import { defineAIAgent, type AIService } from "@zero/framework/ai";

export function createSummarizer(ai: AIService) {
  const definition = defineAIAgent({
    name: "summarizer",
    version: "1",
    model: "smart",
    instructions: "Summarize the supplied text without inventing details.",
    tools: {},
    limits: { maxSteps: 2, maxToolCalls: 1, maxToolCallsPerStep: 1 },
    timeout: { totalMs: 30_000, stepMs: 20_000 },
    maxOutputTokens: 500,
  });
  const agents = ai.createAgentService();
  agents.register(definition);

  return async (text: string, signal?: AbortSignal) => {
    const result = await agents.generate(
      { name: "summarizer", version: "1" },
      { prompt: text, runtimeContext: {}, toolsContext: {}, abortSignal: signal },
    );
    return result.text;
  };
}
```

`AIAgentService` exposes registry and runner, registration, generate and stream.
Its registry requires an exact name/version reference; there is no implicit
latest-version selection. Duplicate registration is rejected. Definitions and
tool maps are frozen, so changing application code requires a new intended
version rather than mutating a registered definition under active callers.

`ai.createAgentService()` supplies the app-local model preparer. A bare
`AIAgentRunner` needs a concrete SDK model, `resolveModel`, or
`prepareModelExecution` for string references. Prefer the managed preparer for
provider capability checks, safe prompt materialization and app-local
telemetry; see [model execution](./model-execution.md).

## Definition Options

Required fields are name, version, model and tools. Name is a lowercase
identifier beginning with a letter, at most 128 characters; version is an
explicit alphanumeric/dot/underscore/plus/hyphen identifier, at most 64
characters. String model references are trimmed, nonempty and at most 512
characters. Tools use declared immutable blueprints with printable constrained
names, never prototype-sensitive keys.

Optional fields include instructions, runtimeContextSchema, output, approval,
limits, timeout, maxRetries, maxOutputTokens, seed, temperature, topP, topK,
presencePenalty, frequencyPenalty, stopSequences, reasoning and providerOptions.
Definitions validate portable settings at declaration time: retries 0–5,
output tokens 1–1,000,000, temperature 0–2, topP 0–1, nonnegative finite topK
up to Number.MAX_SAFE_INTEGER, penalties −2–2 and a signed 32-bit seed.
Provider/model support still varies. Structured output uses the same output
specification as [structured generation](./structured-output.md).

## Runtime Inputs And Authority

Each run supplies either prompt or messages, runtimeContext and toolsContext,
plus optional abortSignal and timeout. A non-undefined execution-context type
also requires executionContext. Runtime/tool schemas validate the supplied data
before model work and the combined result is frozen and byte-bounded.

Runtime context is declared data, such as organizationId and actorId; it is not
an authorization token. Tools must obtain live authority from execution
services. Different runs receive separately materialized SDK tools and context
snapshots. Do not put service instances, functions, cycles or binary secrets in
serializable context; use trusted executionContext.

The generated runId defaults to crypto.randomUUID(). An optional generateRunId
must return 1–256 printable characters. Definition version plus runId identify
a process execution; they do not create a persisted workflow invocation.

## Bounded Execution

| Limit | Default | Hard maximum |
| --- | ---: | ---: |
| maxSteps | 20 | 64 |
| maxToolCalls | 64 | 512 |
| maxToolCallsPerStep | 8 | 64 |
| maxContextBytes | 256 KiB | 8 MiB |
| maxToolResultBytes | 256 KiB | 8 MiB |
| maxTotalToolResultBytes | 1 MiB | 32 MiB |

Every explicit limit must be a positive safe integer. Unknown limit fields are
rejected; per-step calls cannot exceed total calls and per-result bytes cannot
exceed total result bytes. Step stopping and pre-execution call admission are
distinct from result-byte checks after an app handler returns. JSON
serialization rules reject unsupported results rather than silently dropping
private/service values.

Agent timeouts use totalMs, stepMs, firstChunkMs, chunkMs, toolMs and per-tool
`tools: { lookupMs: ... }`, or a numeric total. Values are positive safe
integers up to 86,400,000 ms. Per-tool timeout keys must name declared tools.
Run timeout overrides are resolved separately from definition defaults; omitted
values do not invent a universal deadline. These bounds differ from ordinary
generation's wider admitted timeout range.

Cancellation combines caller cancellation with internal budget cancellation.
Handlers receive a cooperative signal; a timed-out handler may have already
performed an external action. The engine cannot roll back an email or remote
write, so keep such tools idempotent and authority-checked.

## Results, Streams And Lifecycle

generate returns the typed SDK GenerateTextResult, including text, steps,
tool calls/results and output. Configured structured output is parsed before
run completion is published. stream returns the native typed SDK stream result;
stream completion is tracked asynchronously through finishReason, usage and
configured output. Consume the stream and observe its terminal error/cancel
state; returning a stream handle is not proof that the run finished.

Observers receive run.started/completed/cancelled/failed, step.started and
tool.started/completed/failed. They include definition/run identity, safe
tool/step correlation and timing. Default observability sanitizes errors and
does not include prompts or raw tool content. Observer delivery is best effort;
these events are not a durable event log.

Approval policies and mandatory signing defaults are explained in
[tools](./tools.md). For approval waits, recovery and committed progress use
[durable agents](./durable-agents.md); for application workflow steps see
[Torrent integration](./torrent-integration.md).

## Verification

Use a mocked model to prove exact context/schema enforcement, output parsing,
run isolation, limit admission before side effects, signed approval requests,
stream completion, cancellation and observer error sanitation. Keep real
provider qualification separate. [Operations](./operations.md) covers error
codes, diagnostics and migration; the [AI index](./index.md) maps every surface.
