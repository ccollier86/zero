# Zero AI Layer Plan

This plan defines how Zero should add a first-class internal AI layer while
keeping the platform fast, simple, provider-neutral, and easy to extend.

The first priority is the custom Meta Llama provider from `../ai-gateway`.
That adapter is the piece Zero cannot get from standard AI SDK packages.

## Current Status

The first working slice is implemented:

1. `createApp({ ai: true })` resolves env-detected providers.
2. `AIService` supports text, streaming, conversations, embeddings, images,
   transcription, speech, and status inspection.
3. The custom Meta Llama adapter is available as provider id `meta`.
4. The Elysia plugin decorates server context with `ai`; an optional protected
   status route exists only when explicitly enabled.
5. AI warnings, errors, provider lifecycle, and request lifecycle events route
   through Zero observability.
6. Local vector storage is implemented separately in `src/vector`; public
   OpenAI-compatible gateway routes remain future follow-up work.

## Goals

1. Provide one internal AI surface for app code.
2. Auto-enable providers from environment keys.
3. Make active provider/model capability status inspectable at runtime.
4. Support single prompt calls and full conversation workflows.
5. Support tool calling with simple app-defined tools.
6. Keep provider adapters replaceable through dependency inversion.
7. Mount no AI routes by default; public OpenAI-compatible routes can be an
   optional plugin later.
8. Route warnings, errors, and lifecycle events through Zero observability.

## Non-Goals For The First Slice

1. Do not port the entire AI gateway.
2. Do not ship a public OpenAI-compatible gateway by default.
3. Do not hard-wire the sibling transcription server into Zero core.
4. Do not build a provider admin UI in the first backend slice.
5. Do not add external vector search providers before the local vector store
   proves the default embedded shape.

## Proposed Public API

```ts
const app = await createApp({
  db: { mode: './data/app.db' },
  tables,
  auth: true,
  ai: true,
});
```

Inside backend code, loaders, actions, workflows, jobs, or plugins:

```ts
const ai = getAI();

const result = await ai.generateText({
  model: 'smart',
  prompt: 'Summarize this account.',
});

const conversation = ai.conversation({
  model: 'meta/Llama-4-Maverick-17B-128E-Instruct-FP8',
  system: 'You are a precise assistant for this app.',
});

conversation.user('What changed on this customer record?');
conversation.assistant('Here is the previous summary...');
conversation.user('Now compare it with the new notes.');

const answer = await conversation.generate();
```

For streaming:

```ts
const stream = await ai.streamConversation({
  model: 'fast',
  messages,
  tools,
});
```

For embeddings:

```ts
const embedding = await ai.embed({
  model: 'embedding',
  value: documentText,
});
```

For images:

```ts
const image = await ai.generateImage({
  model: 'image',
  prompt: 'Clean product mockup on a white desk.',
});
```

For optional transcription:

```ts
const transcript = await ai.transcribe({
  model: 'transcription',
  audio,
});
```

The transcription method is always present on `AIService`, but it fails with a
clear provider/capability error unless a transcription-capable provider is
configured. The sibling transcription server can be wired later through an
optional adapter because it already has its own SDK.

For text-to-speech:

```ts
const speech = await ai.generateSpeech({
  model: 'speech',
  text: 'The report is ready.',
});
```

With `DEEPGRAM_API_KEY` set, the default `speech` alias resolves to
`deepgram/aura-2-helena-en`. OpenAI speech models can also be selected
explicitly when `OPENAI_API_KEY` is configured.

## Module Layout

```txt
src/ai/
  index.ts
  ai.plugin.ts
  ai-service.ts
  ai-conversation.ts
  ai-toolkit.ts
  ai-types.ts
  ai-errors.ts
  ai-env.ts
  ai-provider-catalog.ts
  ai-registry.ts
  ai-model-aliases.ts
  ai-observability.ts
  adapters/
    meta-llama.ts
```

Responsibilities:

| File | Responsibility |
| --- | --- |
| `ai.plugin.ts` | Elysia plugin that decorates `ai` and exposes optional status routes. |
| `ai-service.ts` | Framework-neutral service wrapping AI SDK calls. |
| `ai-conversation.ts` | Conversation builder and message normalization. |
| `ai-toolkit.ts` | Helpers for defining tools in app code. |
| `ai-types.ts` | Public AI config, provider, model, message, and tool contracts. |
| `ai-errors.ts` | Stable domain errors. |
| `ai-env.ts` | Reads env without leaking secrets. |
| `ai-provider-catalog.ts` | Built-in provider definitions and env key mapping. |
| `ai-registry.ts` | Builds the active AI SDK provider registry. |
| `ai-model-aliases.ts` | Resolves aliases like `fast`, `smart`, `embedding`, `image`, `speech`. |
| `ai-observability.ts` | Emits Zero observability events for AI lifecycle and failures. |
| `adapters/meta-llama.ts` | Ported Meta Llama AI SDK `LanguageModelV2` adapter. |

Each file should keep one responsibility and include front matter plus concise
signature comments for exported APIs.

## Provider Auto-Provisioning

When `ai: true`, Zero should scan environment variables and enable providers
whose required keys are present.

Initial env map:

| Provider ID | Type | Env Keys | Default Base URL |
| --- | --- | --- | --- |
| `openai` | `openai` | `OPENAI_API_KEY` | provider default |
| `anthropic` | `anthropic` | `ANTHROPIC_API_KEY` | provider default |
| `google` | `google` | `GEMINI_API_KEY`, `GOOGLE_API_KEY` | provider default |
| `groq` | `groq` | `GROQ_API_KEY` | provider default |
| `xai` | `xai` | `XAI_API_KEY` | provider default |
| `cohere` | `cohere` | `COHERE_API_KEY` | provider default |
| `meta` | `meta-llama` | `LLAMA_API_KEY`, `META_LLAMA_API_KEY` | `https://api.llama.com/v1` |
| `deepseek` | `openai-compatible` | `DEEPSEEK_API_KEY` | `https://api.deepseek.com` |
| `perplexity` | `openai-compatible` | `PERPLEXITY_API_KEY`, `PERPLEXITYAI_API_KEY` | `https://api.perplexity.ai` |
| `voyage` | `openai-compatible` | `VOYAGE_API_KEY` | `https://api.voyageai.com/v1` |
| `deepgram` | `deepgram` | `DEEPGRAM_API_KEY` | provider default |

The provider id should be what developers use in model strings. For Meta,
developers should use:

```ts
model: 'meta/Llama-4-Maverick-17B-128E-Instruct-FP8'
```

Internally, `meta` resolves to the custom `meta-llama` adapter.

## Explicit Configuration

Auto-detection should be the default, but explicit config should always win:

```ts
ai: {
  aliases: {
    fast: 'groq/llama-3.3-70b-versatile',
    smart: 'anthropic/claude-sonnet-4',
    meta: 'meta/Llama-4-Maverick-17B-128E-Instruct-FP8',
    embedding: 'openai/text-embedding-3-small',
    image: 'openai/gpt-image-1',
  },
  providers: {
    meta: {
      type: 'meta-llama',
      apiKey: Bun.env.META_LLAMA_API_KEY,
      baseURL: Bun.env.META_LLAMA_BASE_URL,
    },
    local: {
      type: 'openai-compatible',
      apiKey: Bun.env.LOCAL_AI_API_KEY,
      baseURL: 'http://127.0.0.1:11434/v1',
    },
  },
}
```

Support `ai: false` to disable everything.

## Active Provider Status

Zero should expose an internal service method:

```ts
const status = ai.status();
```

Shape:

```ts
{
  enabled: true,
  providers: [
    {
      id: 'meta',
      type: 'meta-llama',
      active: true,
      source: 'env',
      configuredBy: ['META_LLAMA_API_KEY'],
      baseURL: 'https://api.llama.com/v1',
      capabilities: {
        text: true,
        streaming: true,
        tools: true,
        vision: true,
        embeddings: false,
        images: false,
        transcription: false,
        speech: false,
      },
    },
  ],
  aliases: {
    fast: { model: 'groq/llama-3.3-70b-versatile', active: true },
    smart: { model: 'meta/Llama-4-Maverick-17B-128E-Instruct-FP8', active: true },
  },
}
```

Optional protected route, disabled by default:

```txt
GET /api/_zero/ai/status
```

When enabled, default access should match observability posture:

1. Admin-only when auth is enabled.
2. Development-only when auth is disabled.
3. Disabled unless `ai.statusEndpoint.enabled` is true.

Never return raw API keys or secret values.

## Conversation API

Zero should make multi-turn app conversations easy without forcing every app
to hand-build AI SDK message arrays.

Builder API:

```ts
const thread = ai.conversation({
  model: 'smart',
  system: 'You are the app assistant.',
  metadata: { customerId },
});

thread.user('Summarize this record.');
thread.assistant('Previous summary...');
thread.user([
  { type: 'text', text: 'Compare against this screenshot.' },
  { type: 'image', url: screenshotUrl },
]);

const result = await thread.generate({
  temperature: 0.2,
});
```

Direct API:

```ts
await ai.generateConversation({
  model: 'smart',
  system: 'You are concise.',
  messages: [
    { role: 'user', content: 'First question' },
    { role: 'assistant', content: 'First answer' },
    { role: 'user', content: 'Follow-up question' },
  ],
});
```

The conversation layer should own:

1. Message normalization.
2. System/developer prompt handling.
3. Multimodal content mapping.
4. Tool result messages.
5. Provider-safe validation before invoking AI SDK.
6. Optional metadata for observability and future audit trails.

The conversation builder should not own persistence in the first slice. Durable
chat threads can be a later module that uses ReactiveDB tables.

## Tool Support

Provide a small helper so app developers can define tools once:

```ts
const tools = defineAITools({
  getCustomer: aiTool({
    description: 'Load one customer by id.',
    input: t.Object({ customerId: t.String() }),
    execute: async ({ customerId }) => customers.get(customerId),
  }),
});

const result = await ai.generateConversation({
  model: 'smart',
  messages,
  tools,
});
```

Tool goals:

1. Use Elysia/TypeBox-style schemas where practical for platform consistency.
2. Convert schemas to AI SDK-compatible tool definitions.
3. Keep execution server-side only.
4. Emit observability events for tool failures.
5. Allow per-call tool choice when the AI SDK supports it.

Tool definitions should be plain app code. They should not require route
registration.

## Custom Meta Llama Provider

Port `../ai-gateway/src/providers/adapters/meta-llama.ts` into:

```txt
src/ai/adapters/meta-llama.ts
```

Production changes while porting:

1. Add file front matter and exported signature comments.
2. Split large mapping helpers if the file becomes hard to test.
3. Preserve AI SDK `LanguageModelV2` compatibility.
4. Keep support for:
   - non-stream generation
   - streaming
   - text prompts
   - image URL/base64 prompt parts
   - function tools
   - tool-call result messages
   - JSON response formats
   - usage extraction from both `usage` and Meta metric payloads
5. Add tests for:
   - provider factory behavior
   - env key loading
   - request body mapping
   - assistant tool call mapping
   - tool result mapping
   - response text parsing
   - response tool call parsing
   - stream text deltas
   - stream tool input deltas
   - finish reason mapping
   - usage extraction
   - HTTP error parsing

Potential improvement:

1. Support a compatibility-mode fallback using `createOpenAICompatible` against
   `https://api.llama.com/compat/v1`.
2. Keep native mode as default because the current adapter already handles
   Meta-specific response and stream shapes.

## Model Aliases

Aliases keep apps fast to write:

```ts
await ai.generateText({ model: 'fast', prompt });
await ai.generateText({ model: 'smart', prompt });
await ai.embed({ model: 'embedding', value });
```

Default alias resolution should be provider-aware:

1. If `ANTHROPIC_API_KEY` exists, `smart` can prefer Anthropic.
2. If `META_LLAMA_API_KEY` or `LLAMA_API_KEY` exists, `smart` can use Meta.
3. If `GROQ_API_KEY` exists, `fast` can use Groq.
4. If only OpenAI exists, use OpenAI for both.
5. If no provider can satisfy an alias, mark it inactive and fail with a clear
   `AI_MODEL_NOT_CONFIGURED` error when used.

Explicit aliases should override defaults.

## Observability

Add stable codes:

1. `AI_CONFIGURED`
2. `AI_PROVIDER_ENABLED`
3. `AI_PROVIDER_SKIPPED`
4. `AI_PROVIDER_FAILED`
5. `AI_MODEL_ALIAS_UNRESOLVED`
6. `AI_REQUEST_STARTED`
7. `AI_REQUEST_COMPLETED`
8. `AI_REQUEST_FAILED`
9. `AI_TOOL_FAILED`
10. `AI_STATUS_ACCESS_DENIED`

Metadata should include:

1. Provider id.
2. Provider type.
3. Model id or alias.
4. Capability.
5. Duration.
6. Token usage when available.
7. Tool names when relevant.

Metadata must not include:

1. API keys.
2. Raw prompts by default.
3. Raw model output by default.
4. Private tool arguments unless the app explicitly opts into that.

## CreateApp Integration

Extend `AppConfig`:

```ts
ai?: boolean | AIConfig;
```

Mount order:

1. Observability configured first.
2. AI config resolved after env/config is available.
3. AI plugin mounted after auth middleware so status routes can use auth.
4. AI service available before scheduler/workflows route handlers need it.

Recommended ordering in `createApp()`:

1. Sync.
2. Auth.
3. Observability.
4. AI.
5. Scheduler.
6. Notifications.
7. Rooms.
8. Workflows.
9. Storage.
10. Data query.
11. Router.

## Public Exports

Server barrel:

```ts
export {
  AIService,
  createAIPlugin,
  createMetaLlama,
  defineAITools,
  getAI,
} from '../ai';

export type {
  AIConfig,
  AIProviderConfig,
  AIProviderStatus,
  AIConversation,
  AIMessage,
  AITextResult,
  AIStreamResult,
} from '../ai';
```

Client barrel should not export server AI execution primitives. Later, it can
export UI hooks for protected app-owned AI endpoints, but model execution must
stay server-side by default.

## Documentation

Add docs:

1. `docs/ai.md`
2. `docs/ai-providers.md`
3. `docs/ai-conversations.md`
4. `docs/ai-tools.md`
5. `docs/ai-meta-llama.md`

Update docs:

1. `docs/platform-configuration.md`
2. `docs/start-here.md` when it exists
3. `.env.example`
4. `docs/system-map.md`
5. `docs/observability.md`

Docs should explain:

1. How env auto-detection works.
2. Which providers become active from which keys.
3. How to inspect active providers.
4. How to set aliases.
5. How to use `meta/<model>` with the custom Meta adapter.
6. How to send single prompts.
7. How to send conversations.
8. How to define tools.
9. How to add a custom provider adapter.
10. Why public AI routes are not enabled by default.

## Implementation Phases

### Phase 1: Contracts And Config

1. Add `src/ai/ai-types.ts`.
2. Add `src/ai/ai-errors.ts`.
3. Add `src/ai/ai-provider-catalog.ts`.
4. Add `src/ai/ai-env.ts`.
5. Add config support to `AppConfig`.
6. Add tests for env/provider resolution.

### Phase 2: Meta Provider Port

1. Add `src/ai/adapters/meta-llama.ts`.
2. Install required AI SDK dependencies.
3. Add unit tests with mocked fetch.
4. Verify TypeScript compatibility with AI SDK `LanguageModelV2`.

### Phase 3: Registry And Service

1. Add `ai-registry.ts`.
2. Add `ai-model-aliases.ts`.
3. Add `ai-service.ts`.
4. Implement `generateText`, `streamText`, `embed`, `generateImage`,
   `transcribe`, and `generateSpeech`.
5. Add service tests for active providers, aliases, and unsupported capabilities.

### Phase 4: Conversations And Tools

1. Add `ai-conversation.ts`.
2. Add `ai-toolkit.ts`.
3. Implement `conversation()`, `generateConversation()`, and
   `streamConversation()`.
4. Add tests for message normalization, tool calls, and tool failures.

### Phase 5: Elysia Plugin And Runtime Status

1. Add `ai.plugin.ts`.
2. Add `getAI()`.
3. Mount plugin from `createApp()`.
4. Add optional protected `/api/_zero/ai/status`.
5. Add Elysia handle tests for default-disabled and opt-in status access.

### Phase 6: Observability

1. Add AI observability codes.
2. Route provider startup, skipped providers, request failures, and tool
   failures through the platform sink.
3. Update `docs/observability.md`.

### Phase 7: Docs And Examples

1. Add AI docs.
2. Update env example.
3. Add a small app example using:
   - env auto-detected providers
   - Meta Llama
   - conversation builder
   - tools
   - status inspection

### Phase 8: Vector Store Follow-Up

Implemented in `src/vector`:

1. Local zvec-backed vector indexes.
2. Structured scalar filters and scoped helpers.
3. Optional `createAIVectorBridge()` composition with `ai.embed()`.
4. Internal app-owned API with no public vector routes by default.

Future vector work should focus on examples, platform doctor index guidance,
and optional external adapters only when a real app needs them.

## Risks

1. AI SDK types may shift between major versions.
   - Mitigation: pin compatible versions and keep adapter tests close to the
     provider.
2. Meta API stream shapes may vary.
   - Mitigation: tests should cover both Meta event payloads and
     OpenAI-compatible chunk payloads currently handled by the adapter.
3. Auto aliases could surprise developers.
   - Mitigation: expose `ai.status()` and make explicit aliases easy.
4. Tool execution can leak data if treated casually.
   - Mitigation: tools are server-side only, app-defined, and observability
     avoids raw tool args by default.
5. Public AI execution routes can become a security and billing hazard.
   - Mitigation: no public execution routes in core; optional plugin later.

## Recommended First Working Slice

Build the smallest production-quality slice that proves the architecture:

1. `ai: true` config.
2. Env auto-detection for OpenAI, Anthropic, Groq, Google, and Meta.
3. Ported Meta Llama adapter.
4. `ai.status()`.
5. `ai.generateText()`.
6. `ai.streamText()`.
7. `ai.conversation().generate()`.
8. Simple app-defined tools.
9. Observability events.
10. Docs and env example.

That slice gives Zero the main value: drop in provider keys, know what is
active, use Meta through the custom provider, and write real multi-turn app AI
features without exposing a public gateway.
