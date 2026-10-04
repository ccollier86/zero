# Zero AI Layer Plan

This document records the architecture and rollout of Zero's first-class
internal AI layer. The implementation is now broader than the original
provider proof: official provider adapters, cloud credential modes, and focused
construction factories share one stable Zero service.

The phase/checklist language later in this file is retained as implementation
history. The current public contracts are the linked AI reference guides, not
an unchecked item or an older example in the rollout record.

## Current Status

The production layer is implemented:

1. `createApp({ ai: true })` resolves env-detected providers.
2. `AIService` supports text, streaming, SDK 7 structured output and lifecycle
   controls, conversations, single/batch embeddings, reranking, images,
   transcription, speech, bounded provider-hosted files, preview video,
   bounded ephemeral agents, Torrent-durable agents, and status inspection.
3. The provider catalog includes Gateway, cloud-native Claude Platform on AWS,
   Bedrock/Azure/Vertex, major language/embedding providers, and dedicated
   image/audio/video providers.
4. Provider-specific readiness prevents partial cloud credentials from being
   mistaken for an active adapter.
5. Explicit provider config supports headers, custom fetch, provider settings,
   compatible endpoints, and custom AI SDK provider factories.
6. Provider construction is split into cloud, language, media, and extended
   factory modules behind one exhaustive dispatch boundary.
7. Native official adapters replace the former compatible implementations for
   DeepSeek, Perplexity, and Voyage while their explicit legacy types remain
   accepted under the established provider IDs.
8. The retired direct Meta-hosted Llama API remains only as a no-network
   compatibility tombstone with an actionable migration error.
9. The Elysia plugin decorates server context with `ai`; an optional protected
   status route exists only when explicitly enabled.
10. AI warnings, initialization failures, provider lifecycle, and request
    lifecycle events route through Zero observability without projecting
    credentials or prompts into metadata.
11. Non-provider-native prompt URLs are materialized through a mandatory Bun
    DNS-pinned, redirect-validated downloader. Sequential downloads share one
    fixed 64-MiB aggregate budget per generation request.
12. Local vector storage is implemented separately in `src/vector`; public
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

## Current Boundaries

1. Do not port the entire AI gateway.
2. Do not ship a public OpenAI-compatible gateway by default.
3. Do not hard-wire the sibling transcription server into Zero core.
4. Do not build a provider admin UI in the first backend slice.
5. Do not add external vector search providers before the local vector store
   proves the default embedded shape.
6. Keep preview video and provider-hosted files behind bounded, operation-
   specific service contracts; adapter capability metadata alone is not enough
   to make a provider/model operation safe.

## Public API

```ts
const app = await createApp({
  db: { mode: 'file', path: './data/app.db' },
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
  instructions: 'Return a concise operational summary.',
  prompt: 'Summarize this account.',
  reasoning: 'medium',
});

const conversation = ai.conversation({
  model: 'groq/meta-llama/llama-4-scout-17b-16e-instruct',
  instructions: 'You are a precise assistant for this app.',
});

conversation.user('What changed on this customer record?');
conversation.assistant('Here is the previous summary...');
conversation.user('Now compare it with the new notes.');

const answer = await conversation.generate();
```

For streaming:

```ts
const stream = ai.streamConversation({
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

const embeddings = await ai.embedMany({
  model: 'embedding',
  values: documents,
});

const ranking = await ai.rerank({
  model: 'reranking',
  query,
  documents,
  topN: 10,
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

With `DEEPGRAM_API_KEY` set and no earlier active Gateway speech candidate, the
default `speech` alias resolves to `deepgram/aura-2-helena-en`. OpenAI speech
models can also be selected explicitly when `OPENAI_API_KEY` is configured.

## Module Layout

```txt
src/ai/
  index.ts
  ai.plugin.ts
  ai-service.ts
  ai-service-support.ts
  ai-request-telemetry.ts
  ai-prompt-download.ts
  ai-safe-download.ts
  ai-safe-download-contracts.ts
  ai-safe-download-cancellation.ts
  ai-safe-download-errors.ts
  ai-safe-download-url-policy.ts
  ai-safe-download-response.ts
  ai-output.ts
  ai-conversation.ts
  ai-session.ts
  ai-toolkit.ts
  ai-workflow.ts
  ai-embedding-operations.ts
  ai-embedding-types.ts
  ai-operation-limits.ts
  ai-rerank-document-snapshot.ts
  ai-rerank-service.ts
  ai-rerank-types.ts
  ai-files-service.ts
  ai-files-types.ts
  ai-files-provider-resolution.ts
  ai-video-service.ts
  ai-video-types.ts
  ai-types.ts
  ai-provider-types.ts
  ai-errors.ts
  ai-env.ts
  ai-env-values.ts
  ai-env-provider-endpoints.ts
  ai-env-provider-resolution.ts
  ai-env-selection.ts
  ai-fetch.ts
  ai-provider-catalog.ts
  ai-provider-activation.ts
  ai-provider-factory.ts
  ai-registry.ts
  ai-model-registry-resolution.ts
  ai-model-aliases.ts
  ai-observability.ts
  agents/
  durable/
  adapters/
    meta-llama.ts
  providers/
    provider-factory-types.ts
    cloud-provider-factories.ts
    language-provider-factories.ts
    media-provider-factories.ts
    extended-provider-factories.ts
```

Responsibilities:

| File | Responsibility |
| --- | --- |
| `ai.plugin.ts` | Elysia plugin that decorates `ai` and exposes optional status routes. |
| `ai-service.ts` | Framework-neutral service wrapping AI SDK calls. |
| `ai-service-support.ts` | Pure request normalization and capability guards shared by service modalities. |
| `ai-request-telemetry.ts` | Bounded request lifecycle telemetry and provider usage projection. |
| `ai-prompt-download.ts` | Sequential Bun DNS-pinned, redirect-validated materialization for prompt assets a selected model cannot consume remotely, under one shared 64-MiB request budget. |
| `ai-safe-download.ts` | Small single-asset Bun download orchestrator shared by prompt, transcription, and video operations. |
| `ai-safe-download-contracts.ts` / `ai-safe-download-cancellation.ts` / `ai-safe-download-errors.ts` / `ai-safe-download-url-policy.ts` / `ai-safe-download-response.ts` | Focused transport contracts, abort/timeout composition, stable errors, DNS/address/redirect policy, and bounded response consumption. |
| `ai-output.ts` | Stable typed facade over AI SDK 7 text, object, array, choice, and JSON output modes. |
| `ai-conversation.ts` | Conversation builder and message normalization. |
| `ai-session.ts` | Bounded in-memory conversation-session helper. |
| `ai-toolkit.ts` | Helpers for defining tools in app code. |
| `ai-workflow.ts` | Torrent activity bridge for common AI calls. |
| `ai-embedding-operations.ts` / `ai-embedding-types.ts` | Bounded ordered batch embedding execution and public request/result contracts. |
| `ai-rerank-service.ts` / `ai-rerank-types.ts` | Bounded homogeneous-document reranking and provider-response integrity checks. |
| `ai-operation-limits.ts` / `ai-rerank-document-snapshot.ts` | Shared embedding/reranking admission bounds plus iterative, deeply detached, byte-bounded JSON document snapshots. |
| `ai-files-service.ts` | Bounded provider-hosted upload, metadata, download, and delete operations. |
| `ai-files-types.ts` | Versioned provider locators and hosted-file request/result contracts. |
| `ai-files-provider-resolution.ts` | Capability-checked provider-hosted-files resolution and public-safe readiness projection. |
| `ai-video-service.ts` | Preview video generate, asynchronous start, and pinned status operations. |
| `ai-video-types.ts` | Bounded video request/result types and durable model-pinned operation envelope. |
| `agents/` | Immutable agent/tool definitions, bounded execution, typed contexts, approvals, and lifecycle events. |
| `durable/` | Finite Torrent agent graphs, private durable state, scope-checked service methods, approval interactions, and live execution-context reconstruction. |
| `ai-types.ts` | Public request, result, message, conversation, and tool contracts. |
| `ai-provider-types.ts` | Provider/configuration, cloud credential, capability, and status contracts. |
| `ai-errors.ts` | Stable domain errors. |
| `ai-env.ts` | Public configuration-resolution coordinator. |
| `ai-env-values.ts` / `ai-env-provider-endpoints.ts` / `ai-env-provider-resolution.ts` / `ai-env-selection.ts` | Focused environment parsing, provider-endpoint precedence, credential readiness, provider activation, alias selection, and hosted-file-provider selection. |
| `ai-fetch.ts` | Request-proxy helpers for adapters with fixed upstream origins. |
| `ai-provider-catalog.ts` | Built-in provider definitions and env key mapping. |
| `ai-provider-activation.ts` | Provider-specific credential readiness, settings projection, and auth-mode capability constraints. |
| `ai-provider-factory.ts` | Exhaustive construction dispatch and stable, secret-safe initialization failure boundary. |
| `providers/provider-factory-types.ts` | Shared factory contracts, common request options, modality normalization, and endpoint rewriting. |
| `providers/cloud-provider-factories.ts` | Gateway, Azure, Bedrock, and Vertex constructors. |
| `providers/language-provider-factories.ts` | Native language, embedding, and multimodal constructors. |
| `providers/media-provider-factories.ts` | Image, transcription, and speech constructors. |
| `providers/extended-provider-factories.ts` | Extended, compatible, Open Responses, and retired-provider boundaries. |
| `ai-registry.ts` | Builds the active AI SDK registry and exposes its stable public registry contracts. |
| `ai-model-registry-resolution.ts` | Capability-checked resolution for language, embedding, image, audio, reranking, and video models. |
| `ai-model-aliases.ts` | Resolves aliases such as `fast`, `smart`, `embedding`, `reranking`, `image`, `speech`, and `video`. |
| `ai-observability.ts` | Emits Zero observability events for AI lifecycle and failures. |
| `adapters/meta-llama.ts` | No-network compatibility tombstone for the retired direct Meta-hosted Llama API. |

Each file keeps one responsibility and includes front matter plus concise
signature comments for exported APIs.

## Provider Auto-Provisioning

When `ai: true`, Zero scans the catalog's env bindings and evaluates the
provider's declared activation kind:

| Activation kind | Contract |
| --- | --- |
| API key | At least one ordered catalog key is non-empty. |
| Anthropic | API key or bearer `authToken`; env auto-detection keeps their header semantics distinct. |
| Claude Platform on AWS | Workspace ID plus region/endpoint and either API key or complete static/dynamic SigV4 credentials; API-key mode suppresses ambient static credentials. |
| Kling AI | API key or a complete legacy access-key/secret-key pair; API-key env wins when both are present. |
| Vercel AI Gateway | Auto-detection requires `AI_GATEWAY_API_KEY`; explicit `{ type: 'gateway', apiKey: null }` unambiguously opts into Vercel OIDC. |
| Amazon Bedrock | Region plus complete static/dynamic SigV4 credentials, or bearer token plus a region/model-runtime endpoint; generic Bedrock base URLs precede the separate `AWS_ENDPOINT_URL_BEDROCK_RUNTIME` and `AWS_ENDPOINT_URL_BEDROCK_AGENT_RUNTIME` service overrides, with `AWS_ENDPOINT_URL` as the final fallback. The agent-runtime endpoint alone does not activate ordinary model operations. Reranking uses agent runtime and requires a region. |
| Azure OpenAI | Resource/base URL plus API key or explicit Entra token provider. |
| Google Vertex AI | Express API key, or project and location for Google Cloud authentication. |
| Base URL | A protocol endpoint exists, as required by Open Responses. |
| Custom | App code supplied an AI SDK provider object or factory. |

The exhaustive provider/key/capability matrix lives in
[AI Providers](./ai-providers.md), keeping this architecture record from
duplicating a changing catalog.

The provider ID is the developer-facing part before the slash. Llama models
remain available through supported hosts, for example Groq:

```ts
model: 'groq/meta-llama/llama-4-scout-17b-16e-instruct'
```

`bedrock/<model>` selects the `amazon-bedrock` adapter type. The retired
`meta/<model>` route is never redirected to another vendor.

## Explicit Configuration

Auto-detection is the default, but explicit config always wins:

```ts
ai: {
  aliases: {
    fast: 'groq/llama-3.3-70b-versatile',
    smart: 'anthropic/claude-sonnet-4',
    embedding: 'openai/text-embedding-3-small',
    image: 'openai/gpt-image-1',
  },
  providers: {
    local: {
      type: 'openai-compatible',
      apiKey: Bun.env.LOCAL_AI_API_KEY,
      baseURL: 'http://127.0.0.1:11434/v1',
    },
    bedrock: {
      type: 'amazon-bedrock',
      settings: {
        region: 'us-east-1',
        credentialProvider: () => loadApplicationAwsCredentials(),
      },
    },
  },
}
```

`ai: false` disables everything. Reserved catalog IDs reject unrelated adapter
types instead of inheriting mismatched env/capability metadata.

Provider `apiKey` and `baseURL` are tri-state: omitted inherits env, a string
overrides it, and `null` suppresses env inheritance for that field. Explicit
alternate Anthropic, Claude Platform on AWS, Bedrock, Kling, Azure, or Vertex
auth settings suppress ambient API keys and conflict with an explicitly
supplied key. Gateway OIDC is declared as
`{ type: 'gateway', apiKey: null }`. OpenAI-compatible capabilities are
capped at text, streaming, tools, vision, embeddings, and images; only custom
adapters can declare arbitrary implemented Zero capabilities.

Provider IDs match `[A-Za-z0-9][A-Za-z0-9._-]*`; resolved base URLs must be
absolute HTTP(S) URLs. A non-custom adapter rejects populated provider settings
outside its supported settings set. All three conditions fail with
`AI_PROVIDER_CONFIG_INVALID` rather than being normalized or ignored.

## Active Provider Status

Zero exposes an internal service method:

```ts
const status = ai.status();
```

Shape:

```ts
{
  enabled: true,
  providers: [
    {
      id: 'groq',
      type: 'groq',
      active: true,
      source: 'env',
      configuredBy: ['GROQ_API_KEY'],
      capabilities: {
        text: true,
        streaming: true,
        tools: true,
        vision: true,
        embeddings: false,
        images: false,
        transcription: false,
        speech: false,
        reranking: false,
        video: false,
        files: false,
        fileMetadata: false,
        fileDownload: false,
        fileDelete: false,
        skills: false,
        realtime: false,
        evaluation: false,
        batch: false,
      },
    },
  ],
  aliases: {
    fast: { model: 'groq/llama-3.3-70b-versatile', active: true },
    smart: { model: 'groq/llama-3.3-70b-versatile', active: true },
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
The provider list contains every resolved entry, including inactive catalog
and explicit entries with bounded reasons. `active` means readiness passed and
construction succeeded, not that every model supports every adapter surface.

## Conversation API

Zero should make multi-turn app conversations easy without forcing every app
to hand-build AI SDK message arrays.

Builder API:

```ts
const thread = ai.conversation({
  model: 'smart',
  instructions: 'You are the app assistant.',
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
  instructions: 'You are concise.',
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
5. Support per-call tool choice, active-tool sets, deterministic ordering,
   typed runtime/tool context, bounded timeouts, and signed approval policy.

Tool definitions should be plain app code. They should not require route
registration.

## Retired Direct Meta Llama Provider

Meta no longer offers the hosted API targeted by Zero's original custom
adapter. Zero therefore does not auto-detect its old keys, advertise it in the
catalog, or retain its transport implementation. The released import and
provider-type names remain as a no-network compatibility tombstone so upgrades
fail with `AI_PROVIDER_RETIRED` and supported host guidance. Zero never silently
redirects data to a different vendor.

## Model Aliases

Aliases keep apps fast to write:

```ts
await ai.generateText({ model: 'fast', prompt });
await ai.generateText({ model: 'smart', prompt });
await ai.embed({ model: 'embedding', value });
await ai.rerank({ model: 'reranking', query, documents });
```

Default alias resolution is provider-aware:

1. When Gateway is active, its matching OpenAI/Anthropic models are preferred.
2. Direct Anthropic can satisfy `smart`.
3. Direct Groq can satisfy `fast`.
4. OpenAI and Google provide later text and modality candidates.
5. If no active provider matches a fixed candidate, the generated alias is
   absent and using it fails with `AI_MODEL_NOT_CONFIGURED`.

Explicit aliases and `ZERO_AI_*_MODEL` env values override defaults.
Activation alone does not invent a model ID: cloud-only Bedrock, Azure, or
Vertex setups commonly need explicit aliases or provider-qualified models.

## Observability

Implemented stable codes:

1. `AI_CONFIGURED`
2. `AI_PROVIDER_ENABLED`
3. `AI_PROVIDER_SKIPPED`
4. `AI_PROVIDER_FAILED`
5. `AI_MODEL_ALIAS_UNRESOLVED`
6. `AI_REQUEST_STARTED`
7. `AI_REQUEST_COMPLETED`
8. `AI_REQUEST_FAILED`
9. `AI_TOOL_FAILED`
10. `AI_STEP_STARTED`, `AI_STEP_COMPLETED`, `AI_STEP_FAILED`
11. `AI_MODEL_CALL_STARTED`, `AI_MODEL_CALL_COMPLETED`, `AI_MODEL_CALL_FAILED`
12. `AI_AGENT_RUN_STARTED`, `AI_AGENT_RUN_COMPLETED`,
    `AI_AGENT_RUN_CANCELLED`, `AI_AGENT_RUN_FAILED`
13. `AI_AGENT_STEP_STARTED`
14. `AI_AGENT_TOOL_STARTED`, `AI_AGENT_TOOL_COMPLETED`, `AI_AGENT_TOOL_FAILED`
15. `AI_STATUS_ACCESS_DENIED`

Metadata should include:

1. Provider id.
2. Provider type.
3. Model id or alias.
4. Capability.
5. Duration.
6. Token usage when available.
7. Tool names when relevant.

Framework-owned metadata must not include:

1. API keys.
2. Raw prompts by default.
3. Raw model output by default.
4. Private tool arguments or results.

Caller-supplied request metadata is recursively bounded and redacts
prompt/content/payload and credential-shaped keys. Callers should still pass
only operational correlation data, never sensitive records. `AI_CONFIGURED`
contains the resolved provider-status count and configured alias names.

Provider initialization is stricter: it replaces the raw construction error
with a generic event error and keeps only provider ID/type plus a closed safe
classification (`Error`, `TypeError`, `RangeError`, `ReferenceError`,
`SyntaxError`, `URIError`, `AggregateError`, or `provider_error`). It never
emits an arbitrary vendor class name or message. Runtime request failures
can retain the raw error channel for an app-local sink, so configured external
sinks remain responsible for error serialization/redaction.

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

The server barrel re-exports the execution surface from `@zero/framework/ai`.
Representative imports are:

```ts
import {
  AIOutput,
  AIService,
  AIAgentRegistry,
  AIDurableAgentService,
  AIDurableAgentWorkflowRuntime,
  createAIPlugin,
  defineAIAgent,
  defineAIAgentTool,
  defineAITools,
  getAI,
  toModelMessages,
} from '@zero/framework/server';
```

Provider/configuration, generation, embeddings/reranking, hosted-file/video,
agent, and durable-agent request/result types are exported from the same
server boundary. The four documented durable-agent capacity constants are
public from both `@zero/framework/ai` and `@zero/framework/server`.

The client barrel does not export server AI execution primitives. Later, it can
export UI hooks for protected app-owned AI endpoints, but model execution must
stay server-side by default.

## Documentation

Primary docs:

1. `docs/ai.md`
2. `docs/ai-providers.md`
3. `docs/ai-generation.md`
4. `docs/ai-embeddings-reranking.md`
5. `docs/ai-files-video.md`
6. `docs/ai-conversations.md`
7. `docs/ai-tools.md`
8. `docs/ai-agents.md`
9. `docs/ai-durable-agents.md`
10. `docs/ai-meta-llama.md` retirement and migration note

The cross-cutting configuration, system-map, observability, Vector, Torrent,
starter, environment-example, README, and `llms.txt` references link back to
those canonical guides.

Docs should explain:

1. How env auto-detection works.
2. Which providers become active from which keys.
3. How to inspect active and inactive provider readiness.
4. How to set aliases.
5. How to migrate retired `meta/<model>` references to an explicitly chosen host.
6. How to send single prompts.
7. How to send conversations.
8. How to define tools.
9. How to add a custom provider adapter.
10. Why public AI routes are not enabled by default.
11. How structured output, timeout, retry, and lifecycle semantics work.
12. How hosted files, video operations, ephemeral agents, and durable agents
    preserve provider, authority, persistence, and redaction boundaries.

## Implementation Phases

### Phase 1: Contracts And Config

1. Add `src/ai/ai-types.ts`.
2. Add `src/ai/ai-errors.ts`.
3. Add `src/ai/ai-provider-catalog.ts`.
4. Add `src/ai/ai-env.ts`.
5. Add config support to `AppConfig`.
6. Add tests for env/provider resolution.

### Phase 2: Provider Compatibility Foundation

1. Install required AI SDK dependencies.
2. Add provider-boundary tests with mocked fetch.
3. Keep Zero's application-facing model contract independent of provider SDK internals.

### Phase 3: Registry And Service

1. Add `ai-registry.ts`.
2. Add `ai-model-aliases.ts`.
3. Add `ai-service.ts`.
4. Implement `generateText`, `streamText`, `embed`, `embedMany`, `rerank`,
   `generateImage`, `transcribe`, and `generateSpeech`.
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
   - a supported hosted Llama provider
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

### Phase 9: AI SDK 7 Expansion

Implemented in the current AI service:

1. Provider-neutral instructions/reasoning and typed output through
   `AIOutput`.
2. Total, step, stream-chunk, and tool timeouts plus retry-aware streaming.
3. Typed runtime/tool context, signed tool approvals, and content-free
   lifecycle callbacks.
4. Bounded `embedMany()` and document `rerank()` operations with provider
   response integrity checks.
5. Immutable, versioned, bounded ephemeral agent definitions and tools.
6. Operation-specific provider-hosted file upload/metadata/download/delete
   with durable provider locators.
7. Preview video generate/start/status with fixed media ceilings and
   model-pinned durable operation envelopes.
8. A first-party durable-agent bridge that compiles exact agent versions into
   finite Torrent graphs with private scratch state, durable approvals, live
   authority reconstruction, scope-checked progress/results, and bounded tool
   fan-out.
9. A mandatory Bun prompt downloader which pins validated public DNS results,
   revalidates redirects, and sequentially materializes assets under one shared
   64-MiB generation-request budget while leaving provider-native URLs remote.

See [AI Generation And Streaming](./ai-generation.md),
[AI Embeddings And Reranking](./ai-embeddings-reranking.md),
[AI Agents](./ai-agents.md),
[Durable AI Agents With Torrent](./ai-durable-agents.md), and
[AI Hosted Files And Video](./ai-files-video.md) for the supported contracts.

## Risks

1. AI SDK types may shift between major versions.
   - Mitigation: Zero pins AI SDK 7, exposes stable request/error/output
     facades where needed, and keeps adapter tests close to each provider.
2. Hosted provider APIs can be retired.
   - Mitigation: remove dead transports, retain actionable compatibility
     tombstones for released names, and never silently redirect vendors.
3. Auto aliases could surprise developers.
   - Mitigation: expose `ai.status()` and make explicit aliases easy.
4. Tool execution can leak data if treated casually.
   - Mitigation: tools are server-side only, app-defined, and observability
     avoids raw tool args by default.
5. Public AI execution routes can become a security and billing hazard.
   - Mitigation: no public execution routes in core; optional plugin later.

## Original First Working Slice (Completed)

The original production-quality slice that proved the architecture was:

1. `ai: true` config.
2. Env auto-detection for the initial provider set.
3. A provider adapter proving the initial abstraction (subsequently retired).
4. `ai.status()`.
5. `ai.generateText()`.
6. `ai.streamText()`.
7. `ai.conversation().generate()`.
8. Simple app-defined tools.
9. Observability events.
10. Docs and env example.

That slice established the service used by the current broad provider catalog.
The provider expansion retains the same service/model contracts, so app code
does not need a provider-specific execution layer.
