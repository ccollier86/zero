---
id: zero.ai.model-execution
type: reference
audience: [developer, agent, operator]
owner: ai
status: draft
visibility: internal
system: ai
feature: model-execution
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


# Prepared Model Execution

[Zero AI](./index.md) · [Ephemeral agents](./agents.md) · [Documentation index](../../index.md)

Model preparation is the trusted integration boundary used by agent runners:
resolve a model, check capabilities, install the safe downloader and bind
request/step telemetry. It does not itself call the model, execute tools,
authorize a user or persist a workflow.

## Request And Prepared Result

`AIModelExecutionRequest` contains reference, readonly model messages,
readonly toolNames, optional abortSignal, timeout and secret-free metadata.
`AIPrepareModelExecution` may return a prepared result synchronously or through
a promise-like value.

The frozen `AIPreparedModelExecution` contains:

- model: the concrete language model for SDK invocation;
- download: the bounded prompt download function;
- lifecycle: required step/model/tool lifecycle callbacks;
- complete({ usage?, toolNames? }) and fail(error): idempotent request terminals.

Capability admission happens before telemetry starts or provider I/O. Once
prepared, the consumer must call a terminal hook on success or failure. Do not
call complete merely because a stream handle was created; wait for its terminal
result. Do not retain the prepared execution across unrelated requests.

## App-Bound Preparation

`createAIModelExecutionPreparer({ resolveModel, emitCode? })` uses a trusted
resolver returning `ResolvedAIModel<LanguageModel>`, synchronously or
asynchronously. It preserves the resolved provider metadata and chooses the
explicit emitCode or the resolver's app-local emitter.

Integration fragment inside an application-owned runner:

```ts
const prepared = await prepare({
  reference: "smart",
  messages,
  toolNames: ["lookup"],
  abortSignal,
  metadata: { correlationId },
});
try {
  // The runner invokes the SDK with prepared.model, prepared.download,
  // and prepared.lifecycle. It must also enforce its own execution bounds.
  const result = await invokePreparedModel(prepared);
  prepared.complete({ usage: result.usage, toolNames: ["lookup"] });
  return result;
} catch (error) {
  prepared.fail(error);
  throw error;
}
```

Here prepare, messages, correlationId and invokePreparedModel are app-owned
dependencies, not exported Zero globals. Most apps should use
`ai.createAgentService()` or the durable runtime rather than reproduce these
lifecycle obligations.

## Concrete SDK Models

`prepareDirectAIModelExecution({ model, abortSignal?, timeout?, emitCode? })`
installs the same safe downloader and lifecycle sink for a concrete SDK model.
Its complete/fail request hooks are no-ops because no Zero provider-resolution
metadata exists. It does not infer a configured provider ID or enforce that
registry's capability flags.

A direct model is a trusted extension point, not a browser-controlled endpoint
selector. Supplying one shifts account readiness and provider-construction
responsibility to the application. For provider aliases and status, prefer
[configuration](./configuration.md) and the managed service boundary.

## Security And Verification

Preparation passes prompt content to capability analysis and SDK execution,
not to the global log sink. Safe download policy is described in
[security](./security.md); it is not a substitute for an actor's permission to
supply or read that document. Keep emitCode metadata content-free.

Verify capability failure before a request-start event, exactly one terminal
event, callback rejection, non-native media materialization and app-local sink
isolation with synthetic models. [Agents](./agents.md) and
[durable agents](./durable-agents.md) are the two built-in consumers.
