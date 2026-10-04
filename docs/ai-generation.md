# AI Generation And Streaming

Zero's server-side generation API is built on AI SDK 7 while preserving the
established `AIService` methods. Existing `generateText()`, `streamText()`,
`generateConversation()`, and `streamConversation()` calls remain valid. New
SDK 7 controls are additive and provider-neutral.

Use this guide for generation behavior. See [AI Providers](./ai-providers.md)
for model activation and capabilities, [AI Tools](./ai-tools.md) for app-owned
tools, and [AI Agents](./ai-agents.md) for bounded multi-step execution.

## Basic Generation

```ts
import { getAI } from '@zero/framework/server';

const ai = getAI();
if (!ai) throw new Error('AI is not enabled.');

const result = await ai.generateText({
  model: 'smart',
  instructions: 'Answer as a concise operations analyst.',
  prompt: 'Summarize the open incidents.',
  reasoning: 'medium',
  maxOutputTokens: 800,
});

return result.text;
```

`instructions` is the preferred SDK 7 field. The older `system` string remains
supported for existing Zero apps. System/developer messages already present in
a conversation are normalized into the same instruction boundary without
duplicating identical content.

`reasoning` accepts the provider-neutral AI SDK levels `provider-default`,
`none`, `minimal`, `low`, `medium`, `high`, and `xhigh`. The selected model
remains authoritative: a provider or model can reject a level it does not
support.

## Structured Output

Use Zero's `AIOutput` facade with a JSON-schema-compatible schema. Elysia
`t.*`, Zod, and other AI SDK flexible schemas can infer the result type.

```ts
import { t } from 'elysia';
import { AIOutput, getAI } from '@zero/framework/server';

const ai = getAI();
if (!ai) throw new Error('AI is not enabled.');

const result = await ai.generateText({
  model: 'smart',
  prompt: 'Extract the incident number, severity, and short summary.',
  output: AIOutput.object({
    name: 'incident_summary',
    schema: t.Object({
      incidentId: t.String(),
      severity: t.Union([
        t.Literal('low'),
        t.Literal('medium'),
        t.Literal('high'),
      ]),
      summary: t.String(),
    }),
  }),
});

// Inferred from the schema.
const incident = result.output;
```

Available constructors are:

| Constructor | Completed output |
| --- | --- |
| `AIOutput.text()` | Plain text; this is the default when `output` is omitted. |
| `AIOutput.object({ schema, name?, description? })` | One schema-validated object. |
| `AIOutput.array({ element, minItems?, maxItems?, name?, description? })` | A schema-validated array. |
| `AIOutput.choice({ options })` | One value from a fixed choice set. |
| `AIOutput.json()` | Parsed JSON without an application schema. |

Zero forces completed structured output parsing inside its error boundary.
Malformed JSON or a value that does not match the requested schema fails with
`AI_OUTPUT_INVALID`; raw model output is not copied into the public error.

Streaming keeps the native typed SDK result:

```ts
const stream = ai.streamText({
  model: 'smart',
  prompt: 'List the three most important account risks.',
  output: AIOutput.array({
    element: t.Object({
      risk: t.String(),
      impact: t.String(),
    }),
    maxItems: 3,
  }),
});

for await (const partial of stream.partialOutputStream) {
  renderPartial(partial);
}

const complete = await stream.output;
```

For array output, `stream.elementStream` emits completed elements. Partial
stream values are useful for display but are not fully schema-validated until
the completed `output` promise resolves.

## Remote Image And File Inputs

Conversation messages can include remote images and files:

```ts
const result = await ai.generateConversation({
  model: 'smart',
  messages: [{
    role: 'user',
    content: [
      { type: 'text', text: 'Summarize the attachment and describe the image.' },
      {
        type: 'image',
        url: 'https://assets.example.com/diagram.png',
        mediaType: 'image/png',
      },
      {
        type: 'file',
        data: new URL('https://assets.example.com/report.pdf'),
        mediaType: 'application/pdf',
        filename: 'report.pdf',
      },
    ],
  }],
});
```

Zero always installs its Bun prompt downloader for one-shot and streamed
generation. When the selected model reports native URL support, the URL stays
remote and the provider handles it. Otherwise Zero materializes each asset
sequentially through a DNS-pinned transport. One generation request has a
shared fixed 64-MiB materialization budget, exported as
`AI_DEFAULT_PROMPT_DOWNLOAD_MAX_BYTES`; provider-native remote URLs do not
consume it.

The local materialization path rejects credentials in URLs and private,
loopback, link-local, or otherwise disallowed literal/resolved addresses. It
checks every DNS answer, pins the chosen public address while preserving the
HTTP `Host` authority and TLS server name, disables automatic redirects, and
repeats validation for every redirect target. Declared and streamed response
sizes are both bounded. This prevents redirect and DNS-rebinding changes from
turning a validated public URL into a local-network request.

Invalid URLs/redirects fail with `AI_REQUEST_INVALID`, oversized assets with
`AI_REQUEST_LIMIT_EXCEEDED`, cancellation with `AI_REQUEST_ABORTED`, and a
failed remote response/download with `AI_REQUEST_FAILED`. These errors do not
include the remote body. Provider-native URL handling does not pass through
Zero's local downloader, so app code must still authorize the source and
follow that provider's remote-content policy.

This path is separate from reusable provider-hosted locators. Use
[AI Hosted Files And Video](./ai-files-video.md) when a provider file should be
uploaded once and referenced across calls.

## Timeouts, Retries, And Cancellation

Every generation request accepts `abortSignal`, `maxRetries`, and `timeout`.
A numeric timeout remains supported and means one total deadline in
milliseconds. The object form exposes SDK 7's individual boundaries:

```ts
const result = await ai.generateText({
  model: 'smart',
  prompt,
  tools,
  abortSignal: request.signal,
  maxRetries: 2,
  timeout: {
    totalMs: 45_000,
    stepMs: 15_000,
    firstChunkMs: 5_000,
    chunkMs: 10_000,
    toolMs: 8_000,
    tools: {
      lookupCustomerMs: 3_000,
    },
  },
});
```

| Boundary | Meaning |
| --- | --- |
| `totalMs` | Entire logical generation call, including model and tool steps. |
| `stepMs` | Each model/tool-loop step. |
| `firstChunkMs` | Time to the first content chunk for each streamed step. Streaming only. |
| `chunkMs` | Maximum gap between streamed content chunks. Streaming only. |
| `toolMs` | Default deadline for each tool execution. |
| `tools.{toolName}Ms` | Typed override for one named tool. |

Timeouts become `AI_REQUEST_TIMEOUT` with status `504`; explicit cancellation
becomes `AI_REQUEST_ABORTED` with status `499`. Application code should branch
on `AIError.code`, not provider error strings.

`maxRetries` controls provider-call retries before and around the provider
request. `streamRetries` additionally allows recovery after a provider stream
has begun:

```ts
const stream = ai.streamText({
  model: 'fast',
  prompt,
  maxRetries: 2,
  streamRetries: 1,
  onError: ({ error }) => {
    recordLocalStreamFailure(error);
    return { retry: true };
  },
});
```

Each automatic stream retry reruns only the current model step; completed prior
steps and their tool results stay intact. Output already emitted by a failed
attempt cannot be retracted from the consumer-facing stream, but the SDK
excludes it from the recovered step result, structured output, response
messages, and later model steps.

Omitting `streamRetries` disables all post-start retry behavior. Setting it to
`0` disables automatic retries but allows `onError` to request one retry by
returning `{ retry: true }`. With a positive count, `onError` can request at
most one additional retry after the automatic attempts are exhausted. Zero
does not emit a terminal request failure when recovery succeeds. For streams,
the final `finishReason`, `onEnd`, or `onAbort` settles terminal request
telemetry.

## Runtime Context, Tool Context, And Step Controls

Generation requests expose SDK 7's typed orchestration controls without
coupling them to a provider:

- `runtimeContext` carries run-scoped data through model and tool callbacks.
- `toolsContext` carries the typed context declared by individual tools.
- `activeTools` narrows the available tools for a call.
- `toolOrder` stabilizes tool definition ordering for provider-side caching.
- `prepareStep` can change model, tools, or settings for the next step.
- `stopWhen` sets one or more bounded loop stop conditions.
- `toolChoice` controls provider tool selection.
- `toolApproval` defines automatic, denied, or user-approval decisions.
- `toolApprovalSecret` signs approval requests with HMAC.

These values are server-side execution context, not authentication. App code
must still resolve live Guardian authority and enforce it before sensitive tool
effects. See [AI Tools](./ai-tools.md) for the security boundary and
[AI Agents](./ai-agents.md) for validated, frozen per-run contexts.

### Bedrock inactive-tool history

Amazon Bedrock cannot accept native historical tool blocks without a current
tool configuration. When a Bedrock generation or stream has no active tools,
Zero preserves completed tool-call, result, and approval history as bounded,
clearly labeled text context instead of allowing the official adapter to drop
it. The projection does not install tools or alter `toolChoice`; later calls
with active tools keep native blocks unchanged. `activeTools: []` therefore
retains prior context without making any historical tool executable.

Zero does not mutate the supplied messages. Projected history has a fixed
1-MiB UTF-8 ceiling, and unsafe representations—non-JSON/deep/cyclic values,
binary or referenced file results, custom content, empty tool messages, or an
oversized projection—fail with `AI_REQUEST_INVALID` / `400`. Inline text-file
results are allowed. Historical tool output remains untrusted model context;
applications must still authorize every current side effect.

## Lifecycle Callbacks And Telemetry

One-shot generation and streaming accept:

- `onStart`
- `onStepStart` and `onStepEnd`
- `onLanguageModelCallStart` and `onLanguageModelCallEnd`
- `onToolExecutionStart` and `onToolExecutionEnd`
- `onEnd`

Streaming additionally accepts `onChunk`, retry-aware `onError`, and
`onAbort`. One-shot `generateText()` and `generateConversation()` do not expose
`onAbort`; those methods return or reject directly, and an aborted call rejects
with `AI_REQUEST_ABORTED`.

Zero composes its lifecycle observer with application callbacks. The app
callback receives the original typed SDK event and keeps its normal failure
behavior. Zero's own event metadata is deliberately content-free: it can
contain call/step/tool identifiers, durations, finish classification, and
provider-reported token counts, but never prompts, generated content, tool
arguments/results, runtime context, provider options, or approval secrets.

The request-level `metadata` field is for low-cardinality correlation data.
It is recursively bounded and credential/content-shaped keys are redacted, but
applications should still avoid putting records or secrets in it. `telemetry`
is passed to the AI SDK separately and follows the configured SDK telemetry
adapter.

See [Observability](./observability.md) for event codes and sink ownership.

## SDK 7 Migration

The upgrade is additive at Zero's service boundary:

1. Existing model aliases and `provider/model` references remain valid.
2. Existing `system` values still work; use `instructions` for new code.
3. Existing numeric `timeout` values still mean a total timeout.
4. Existing plain-text calls still read `result.text`; structured calls read
   the inferred `result.output`.
5. Conversation builders, transient sessions, `aiTool()`, and
   `createAIWorkflowHandler()` keep their established entry points.
6. Existing streaming consumers can keep reading `textStream`; structured
   streams add `partialOutputStream`, `elementStream`, and `output`.
7. Zero normalizes invalid requests, timeouts, aborts, malformed provider
   responses, and malformed structured output into stable `AIError` codes.
8. Remove an `onAbort` property from one-shot generation calls if an app passed
   one through an untyped wrapper. It was not invoked. Catch
   `AI_REQUEST_ABORTED` or observe the request's `abortSignal`; `onAbort`
   remains available on streaming calls.
9. Remote prompt assets which the provider cannot consume by URL are now
   downloaded through Zero's fixed Bun safety boundary. No app option is
   required. The 64-MiB budget is aggregate across all assets Zero materializes
   locally for that generation request; provider-native URLs remain remote and
   do not consume it.

No app migration is required merely because Zero now uses AI SDK 7. Adopt the
new controls when the app needs them, and verify that the selected provider
model supports each requested capability.

## Related Documentation

- [AI](./ai.md)
- [AI Providers](./ai-providers.md)
- [AI Tools](./ai-tools.md)
- [AI Agents](./ai-agents.md)
- [Durable AI Agents With Torrent](./ai-durable-agents.md)
- [AI Conversations](./ai-conversations.md)
- [AI Embeddings And Reranking](./ai-embeddings-reranking.md)
- [AI Hosted Files And Video](./ai-files-video.md)
- [Observability](./observability.md)
