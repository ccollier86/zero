---
id: zero.ai.torrent-integration
type: how-to
audience: [developer, agent, operator]
owner: ai
status: draft
visibility: internal
system: ai
feature: workflow-activity
maturity: supported
applies_to: ["2.1.1 source plus uncommitted workflow request-control correction"]
modes: ["managed Bun server", "standalone Bun service", "Torrent-backed durable agent"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---


# AI Inside Torrent Activities

[Zero AI](./index.md) · [Durable agents](./durable-agents.md) · [Documentation index](../../index.md)

createAIWorkflowHandler adapts one Zero conversation call into a trusted Torrent
step handler. It is useful when a larger workflow needs summarization,
classification or another AI action. It does not register a graph, persist an
AI agent, create a route or own provider configuration.

This guide includes the working-source correction from 2026-10-05: all declared
AIRequestOptions are forwarded, and configured mutable controls are detached
before asynchronous prompt/tool derivation. The corrected source is not yet a
new committed/published package baseline.

## Bind The App-Local Service

This registration fragment belongs inside createApp's workflows.register.
The enclosing app must enable AI and define the intended workflow/access policy.

```ts
import { createAIWorkflowHandler } from "@zero/framework/ai";

// Inside workflows.register(registry, context):
if (!context.ai) throw new Error("This app requires AI.");
registry.registerActivity({
  name: "summarize",
  version: 1,
  databaseCallable: true,
  handler: createAIWorkflowHandler<{ text: string }>({
    service: context.ai,
    model: "smart",
    system: "Summarize without inventing facts.",
    prompt: (ctx) => ctx.input.text,
    maxOutputTokens: 500,
    maxRetries: 0,
    timeout: 30_000,
  }),
});
```

databaseCallable is the app's deliberate exposure decision for the registered
activity, not a default of createAIWorkflowHandler. Keep its input/access
validation in the workflow/activity definition. Prefer explicit service
injection; omitting service uses getAI(), a compatibility getter that is not an
app-local selection mechanism when multiple apps exist in a process.

## Message And Tool Derivation

Options accept:

- service: AI workflow service or a synchronous function resolving it;
- system: a string or async step-context derivation;
- messages: explicit readonly Zero messages or async derivation;
- prompt: user content or async derivation;
- tools: SDK toolset or async derivation;
- toolChoice: normal conversation selection policy;
- output: text (default) or result.

Explicit messages win over prompt. When both are omitted, string step input
becomes user text; non-string input is JSON.stringify'd. Do not use this
fallback for unbounded objects or secrets without deliberate app validation.
The adapter's system option is its existing compatible workflow instruction
surface, not the complete newer generation-output/streaming configuration.

Derived functions receive the real StepContext: invocation/step/attempt,
workflow input, cancellation, live execution identity, scoped zero services and
assertCurrentAuthority. They remain trusted app code; a database-defined graph
selects registered activity/version rather than executing arbitrary scripts.

## Request Controls And Snapshots

AIWorkflowHandlerOptions extends AIRequestOptions. The adapter forwards model,
maxRetries, timeout, headers, temperature, topP, topK, presencePenalty,
frequencyPenalty, seed, reasoning, maxOutputTokens, stopSequences,
providerOptions, metadata and cancellation to generateConversation.

Handler-only configuration does not leak into the model request. Headers,
timeout, stop sequences and provider options use the same bounded snapshots as
ordinary generation and are captured when the handler is constructed. App
metadata is shallow-copied; keep it content-free and do not mutate nested
metadata while executing. See [generation controls](./generation-controls.md)
for exact portable semantics and admission limits.

The workflow instance ID and step index are added to request metadata for
correlation. This is telemetry context, not durable output storage or a
permission claim. A tool handler still needs the live application's authority.

## Cancellation And Authority

Prompt/system/tool derivation may yield. Immediately before provider work, the
adapter checks the combined workflow/configured abort signal and calls
ctx.assertCurrentAuthority(). A revoked actor, cancelled/stale attempt or losing
lease cannot begin a fresh provider call using old authority.

The workflow and configured abort signals are combined and listeners disposed
after the provider call settles. Cancellation cannot erase a provider request
already accepted or a tool's completed remote side effect. Use app/domain
idempotency and Torrent's retry policy appropriately.

## Result And Persistence

The default result is generated text. output: result returns the SDK AI result,
which can contain content-bearing/private/provider-specific fields and is not
automatically safe to persist as a public workflow output.

For sensitive or large results, prefer an app-owned handler that calls the same
AIService then deliberately stores private scratch memory or authorized
storage and returns a bounded safe reference. Use durable agents when model
decisions, tool calls and approvals themselves must be persisted between turns.
Do not publish full prompts, credentials or tool payloads in normal progress.

## Related Guides And Next Steps

[Durable agents](./durable-agents.md) explain private multi-turn recovery and
run-specific approval. [Tools](./tools.md) covers handler authorization.
[Model execution](./model-execution.md) is the lower-level runner boundary;
[operations](./operations.md) explains retries, safe events and error codes.
The [runtime lifecycle](../runtime/lifecycle.md) guide explains when registration
and shutdown hooks run. The broader Torrent system manual is mapped separately
in the backend inventory and will be linked when its canonical pages exist.
