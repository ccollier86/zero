# AI Providers

Zero provides one server-side AI service over official AI SDK provider
adapters, OpenAI-compatible endpoints, and custom AI SDK providers. Enable the
layer with `ai: true`; providers become active only
when their own credential and endpoint requirements are satisfied.

This page is the canonical provider configuration reference. See [AI](./ai.md)
for service methods, conversations, tools, workflows, and vector composition.
See [AI Hosted Files And Video](./ai-files-video.md) for the operation-level
file/video contracts; catalog capability flags alone do not replace those
bounds.

## Supported Zero Capabilities

Zero exposes these provider/model capabilities:

- text generation, streaming, reasoning controls, and structured output
- tool calls and vision input
- single and batch text embeddings
- document reranking
- image generation
- audio transcription
- speech generation
- bounded provider-hosted files where an adapter exposes the required operation
- preview video generation where an adapter exposes the required operation

`AIOutput` exposes SDK 7 text, object, array, choice, and untyped JSON output
modes. Reranking is a stable bounded `AIService` operation. Video uses a
separate preview surface because its provider operation envelopes and media
downloads require different durability and size boundaries. Hosted files are
also operation-specific: upload support does not imply metadata, download, or
delete support.

For source compatibility, public `AIProviderCapabilities` keeps the original
eight flags (`text` through `speech`) required and makes SDK 7 additions such
as `reranking`, `video`, hosted-file operations, and preview adapter surfaces
optional. Config resolution fills every flag; runtime/status code uses
`ResolvedAIProviderCapabilities`, where all capability booleans are present.

The capabilities below describe the surfaces implemented by each adapter, not
a promise that every model from that provider supports every surface. Select a
model that supports the operation you call. Zero rejects a provider-level
capability mismatch with `AI_CAPABILITY_NOT_SUPPORTED`; provider/model
compatibility errors still come from the provider.

## API-Key Providers

With `ai: true`, each complete credential shape in this table activates its
provider. When single-key alternatives are listed, Zero uses the first
non-empty key in the documented order; Kling's legacy pair must be complete.

| Provider ID | Adapter type | Auto-detected key(s) | Declared Zero capabilities |
| --- | --- | --- | --- |
| `gateway` | `gateway` | `AI_GATEWAY_API_KEY` | text, streaming, tools, vision, embeddings, images, transcription, speech, reranking, video; preview realtime/evaluation/batch |
| `openai` | `openai` | `OPENAI_API_KEY` | text, streaming, tools, vision, embeddings, images, transcription, speech, hosted-file upload/metadata/download/delete, skills; preview realtime/evaluation/batch |
| `anthropic` | `anthropic` | `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN` | text, streaming, tools, vision, hosted-file upload, skills; preview evaluation/batch |
| `google` | `google` | `GEMINI_API_KEY`, `GOOGLE_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY` | text, streaming, tools, vision, embeddings, images, transcription, speech, video, hosted-file upload; preview realtime/evaluation/batch |
| `groq` | `groq` | `GROQ_API_KEY` | text, streaming, tools, vision, transcription |
| `xai` | `xai` | `XAI_API_KEY` | text, streaming, tools, vision, images, transcription, speech, video, hosted-file upload/metadata/download/delete; preview realtime/batch |
| `cohere` | `cohere` | `COHERE_API_KEY` | text, streaming, tools, vision, embeddings, reranking |
| `mistral` | `mistral` | `MISTRAL_API_KEY` | text, streaming, tools, vision, embeddings, transcription, speech |
| `togetherai` | `togetherai` | `TOGETHER_API_KEY`, `TOGETHER_AI_API_KEY` | text, streaming, tools, vision, embeddings, images, reranking |
| `deepinfra` | `deepinfra` | `DEEPINFRA_API_KEY` | text, streaming, tools, vision, embeddings, images |
| `deepseek` | `deepseek` | `DEEPSEEK_API_KEY` | text, streaming, tools, vision, hosted-file upload |
| `cerebras` | `cerebras` | `CEREBRAS_API_KEY` | text, streaming, tools |
| `perplexity` | `perplexity` | `PERPLEXITY_API_KEY`, `PERPLEXITYAI_API_KEY` | text, streaming, tools, vision, embeddings |
| `fireworks` | `fireworks` | `FIREWORKS_API_KEY` | text, streaming, tools, vision, embeddings, images |
| `voyage` | `voyage` | `VOYAGE_API_KEY` | embeddings, reranking |
| `fal` | `fal` | `FAL_API_KEY`, `FAL_KEY` | images, transcription, speech, video |
| `luma` | `luma` | `LUMA_API_KEY` | images |
| `deepgram` | `deepgram` | `DEEPGRAM_API_KEY` | transcription, speech |
| `elevenlabs` | `elevenlabs` | `ELEVENLABS_API_KEY` | transcription, speech |
| `hume` | `hume` | `HUME_API_KEY` | speech |
| `revai` | `revai` | `REVAI_API_KEY` | transcription |
| `assemblyai` | `assemblyai` | `ASSEMBLYAI_API_KEY` | transcription |
| `gladia` | `gladia` | `GLADIA_API_KEY` | transcription |
| `fish-audio` | `fish-audio` | `FISH_AUDIO_API_KEY` | transcription, speech |
| `replicate` | `replicate` | `REPLICATE_API_TOKEN` | images, video |
| `prodia` | `prodia` | `PRODIA_TOKEN` | text, streaming, vision, images, video |
| `black-forest-labs` | `black-forest-labs` | `BFL_API_KEY` | images, video |
| `bytedance` | `bytedance` | `ARK_API_KEY` | images, video |
| `klingai` | `klingai` | `KLINGAI_API_KEY`, or complete `KLINGAI_ACCESS_KEY` + `KLINGAI_SECRET_KEY` | video |
| `cartesia` | `cartesia` | `CARTESIA_API_KEY` | transcription, speech; preview realtime |
| `gmicloud` | `gmicloud` | `GMI_CLOUD_APIKEY` | text, streaming, tools |
| `quiverai` | `quiverai` | `QUIVERAI_API_KEY` | images |
| `baseten` | `baseten` | `BASETEN_API_KEY` | text, streaming, tools; embeddings with a valid `/sync` or `/sync/v1` `settings.modelURL` |
| `huggingface` | `huggingface` | `HUGGINGFACE_API_KEY` | text, streaming, tools, vision |
| `moonshotai` | `moonshotai` | `MOONSHOT_API_KEY` | text, streaming, tools, vision |
| `alibaba` | `alibaba` | `ALIBABA_API_KEY` | text, streaming, tools, vision, embeddings, video |
| `minimax` | `minimax` | `MINIMAX_API_KEY` | text, streaming, tools, video |
| `zai` | `zai` | `ZAI_API_KEY` | text, streaming, tools, vision |
| `topaz` | `topaz` | `TOPAZ_API_KEY` | images |

`deepseek`, `perplexity`, and `voyage` now use their native official adapters.
Existing explicit configurations that use their established provider IDs with
`type: 'openai-compatible'` remain accepted for compatibility.

Kling AI accepts either `KLINGAI_API_KEY` or the complete legacy
`KLINGAI_ACCESS_KEY` / `KLINGAI_SECRET_KEY` pair. The API key wins during env
resolution. A partial legacy pair remains inactive with
`partial_klingai_credentials`, and explicit config rejects mixing both modes.

### Vercel AI Gateway OIDC

Env auto-detection requires `AI_GATEWAY_API_KEY`. An explicit Gateway provider
still inherits that ambient key when `apiKey` is omitted. To select the
official adapter's Vercel OIDC flow unambiguously, suppress key inheritance
with `apiKey: null`:

```ts
ai: {
  providers: {
    gateway: { type: 'gateway', apiKey: null },
  },
}
```

This distinction prevents an inactive catalog entry from silently attempting
ambient OIDC. `ZERO_AI_ENABLED=true` only forces the plugin on; it does not
change this security boundary. If no ambient key exists, an explicit Gateway
entry with omitted `apiKey` also reaches OIDC, but `null` is the portable
declaration that remains OIDC when deployment env changes.

## Cloud Providers

Claude Platform on AWS, Amazon Bedrock, Azure OpenAI, and Google Vertex AI have
activation rules that cannot be represented by a single generic API key.

| Provider ID | Adapter type | Activation | Declared Zero capabilities |
| --- | --- | --- | --- |
| `anthropic-aws` | `anthropic-aws` | workspace ID plus region/endpoint and either API key or complete static/dynamic SigV4 credentials | text, streaming, tools, vision, hosted-file upload, skills |
| `azure` | `azure` | endpoint plus API key or explicit token provider | text, streaming, tools, vision, embeddings, images, transcription, speech |
| `bedrock` | `amazon-bedrock` | region plus complete static/dynamic SigV4 credentials, or bearer plus a region/model-runtime endpoint | text, streaming, tools, vision, embeddings, images, reranking |
| `google-vertex` | `google-vertex` | express key, or project/location with Google Cloud auth | text, streaming, tools, vision, embeddings, images, speech, video; transcription outside express-key mode |

### Claude Platform on AWS

The provider ID and adapter type are both `anthropic-aws`. Every credential
mode requires `ANTHROPIC_AWS_WORKSPACE_ID`. Choose exactly one authentication
strategy:

1. API key: `ANTHROPIC_AWS_API_KEY`, plus `AWS_REGION` (or
   `AWS_DEFAULT_REGION`) or `ANTHROPIC_AWS_BASE_URL`.
2. Static SigV4: `AWS_REGION`, `AWS_ACCESS_KEY_ID`, and
   `AWS_SECRET_ACCESS_KEY`, with optional `AWS_SESSION_TOKEN`.
3. Dynamic SigV4: trusted `settings.region` and
   `settings.credentialProvider` in explicit app config.

When the API-key env is present, Zero does not also inherit ambient static AWS
credentials. Partial static credentials leave the provider inactive. Explicit
config rejects an API key combined with SigV4 settings instead of choosing an
ambiguous authentication mode.

```txt
ANTHROPIC_AWS_WORKSPACE_ID=wrkspc_example
ANTHROPIC_AWS_API_KEY=...
AWS_REGION=us-east-1
```

The workspace ID is not the Zero provider ID and does not select application
authority; it is forwarded only to the official provider adapter.

Dynamic credentials stay in trusted server configuration:

```ts
ai: {
  providers: {
    'anthropic-aws': {
      type: 'anthropic-aws',
      settings: {
        workspaceId: 'wrkspc_example',
        region: 'us-east-1',
        credentialProvider: loadApplicationAwsCredentials,
      },
    },
  },
}
```

### Amazon Bedrock

The provider ID is `bedrock`; its adapter type is `amazon-bedrock`. Choose
exactly one credential strategy:

1. Bearer token: `AWS_BEARER_TOKEN_BEDROCK`.
2. Static credentials: `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`, with
   optional `AWS_SESSION_TOKEN`.
3. An explicit `settings.credentialProvider` supplied by trusted server code.

SigV4 with static or dynamic AWS credentials requires a region. Bearer-token
mode does not use SigV4; it requires either a region (to derive the normal
runtime endpoint) or an explicit model-runtime endpoint. The agent-runtime
endpoint alone does not activate ordinary model operations. Generic
Zero/provider endpoint overrides take precedence over service-specific AWS
endpoints, and the AWS-wide endpoint is the final fallback. This supports
private/proxied endpoints without inventing an unused signing region for
non-reranking calls.

`AWS_REGION` is preferred over the `AWS_DEFAULT_REGION` fallback:

```txt
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_SESSION_TOKEN=
```

Bedrock has two service endpoints. Text, embedding, and image operations use
`settings.runtimeBaseURL` or `AWS_ENDPOINT_URL_BEDROCK_RUNTIME`; reranking uses
`settings.agentRuntimeBaseURL` or
`AWS_ENDPOINT_URL_BEDROCK_AGENT_RUNTIME`. A selected generic
`BEDROCK_BASE_URL` or `AMAZON_BEDROCK_BASE_URL` applies to both services and
takes precedence over the service-specific env values. The AWS-wide
`AWS_ENDPOINT_URL` is the final fallback. Bedrock reranking still requires a
region even when the agent-runtime endpoint is explicit because the installed
official adapter requires it; without a region Zero does not advertise the
reranking capability.

Bearer auth against an endpoint override can instead use:

```txt
AWS_BEARER_TOKEN_BEDROCK=...
AWS_ENDPOINT_URL_BEDROCK_RUNTIME=https://bedrock-runtime.example.internal
```

An incomplete static pair leaves the provider inactive with
`partial_aws_credentials`. Region-only configuration does not silently opt in
to ambient credentials. For workload identity, instance roles, profiles, or a
rotating credential chain, make that choice explicit:

```ts
ai: {
  providers: {
    bedrock: {
      type: 'amazon-bedrock',
      settings: {
        region: 'us-east-1',
        credentialProvider: async () => {
          const credentials = await loadApplicationAwsCredentials();
          return {
            accessKeyId: credentials.accessKeyId,
            secretAccessKey: credentials.secretAccessKey,
            sessionToken: credentials.sessionToken,
          };
        },
      },
    },
  },
}
```

The credential callback stays in server memory and is never returned by
`ai.status()`. Complete env-based static credentials are detected by the
generated starter. A dynamic credential callback is app code, so declare the
provider explicitly as shown instead of relying on env auto-detection.

Bedrock Converse requires a current tool configuration whenever native
tool-use/result blocks are sent. On a later text-only turn, the official
adapter would otherwise remove completed tool calls, results, and approvals
from history. Zero's Bedrock-only compatibility boundary instead projects
those historical parts into explicitly labeled, non-executable text when the
current call has no active tools. It does not add tool definitions, change
`toolChoice`, or mutate the caller's messages. When tools are active, Zero
leaves the native Bedrock blocks unchanged. This behavior applies to both
generation and streaming, including calls narrowed to `activeTools: []`.

The synthesized history is limited to 1 MiB of UTF-8 text per model call.
Plain JSON inputs/results, denials/errors, approvals, text output, and inline
text-file result content can be preserved. Empty tool messages, excessive
nesting, non-JSON values, binary/reference files, custom content, or an
oversized projection fail closed with `AI_REQUEST_INVALID` and HTTP `400`
instead of silently dropping or ambiguously converting history. The projection
preserves context for the model; it does not make historical output trusted or
authorized application input.

### Azure OpenAI

Azure needs an endpoint plus credentials:

- Endpoint: `AZURE_RESOURCE_NAME` or `AZURE_BASE_URL`.
- Credentials: `AZURE_API_KEY`, or an explicit `settings.tokenProvider` for
  Microsoft Entra authentication.

The normal env-only form is:

```txt
AZURE_RESOURCE_NAME=my-openai-resource
AZURE_API_KEY=...
```

For Entra or advanced endpoint behavior, configure the provider explicitly:

```ts
ai: {
  providers: {
    azure: {
      type: 'azure',
      settings: {
        resourceName: 'my-openai-resource',
        tokenProvider: () => acquireAzureOpenAIToken(),
        apiVersion: '2025-04-01-preview',
      },
    },
  },
}
```

`settings.speechBaseURL` and `settings.useDeploymentBasedUrls` are also
available when the Azure deployment requires them.

### Google Vertex AI

Vertex supports either:

- express API-key mode through `GOOGLE_VERTEX_API_KEY`; or
- Google Cloud authentication with `GOOGLE_VERTEX_PROJECT` and
  `GOOGLE_VERTEX_LOCATION`.

```txt
GOOGLE_VERTEX_PROJECT=my-project
GOOGLE_VERTEX_LOCATION=us-central1
```

The official adapter resolves Application Default Credentials in the
project/location form. Trusted app code can pass authentication configuration
through `settings.googleAuthOptions`. Vertex express API-key mode does not
advertise transcription through Zero. Complete project/location env config is
detected by the generated starter; custom ADC options belong in explicit
trusted provider config.

## Open Responses

`open-responses` activates from `OPEN_RESPONSES_BASE_URL`; it is intended for a
server that implements the Open Responses protocol:

```ts
ai: {
  providers: {
    responses: {
      type: 'open-responses',
      baseURL: Bun.env.RESPONSES_BASE_URL,
      apiKey: Bun.env.RESPONSES_API_KEY,
      settings: { strictResponseInput: true },
    },
  },
}
```

The generated starter detects `OPEN_RESPONSES_BASE_URL` as a complete
activation signal even though this provider has no API-key env.
The adapter declares text, streaming, tools, and vision surfaces; model/server
support still determines which of those operations succeeds.

### OpenAI-Compatible Endpoints

For any OpenAI-compatible endpoint, use an application-chosen provider ID and
an explicit base URL:

```ts
ai: {
  providers: {
    local: {
      type: 'openai-compatible',
      baseURL: 'http://127.0.0.1:11434/v1',
      apiKey: Bun.env.LOCAL_API_KEY,
      capabilities: {
        text: true,
        streaming: true,
        tools: false,
      },
    },
  },
}
```

If `apiKey` or `baseURL` is omitted for a non-catalog provider, Zero checks
`{PROVIDER_ID}_API_KEY` and `{PROVIDER_ID}_BASE_URL`, followed by the adapter
type equivalents. The example above can therefore inherit `LOCAL_API_KEY` and
`LOCAL_BASE_URL`. A compatible provider without a base URL remains inactive.

## Explicit Provider Configuration

Explicit config wins over auto-detection for the same provider ID. Credential
and endpoint values have an intentional three-state contract:

| Value | Resolution behavior |
| --- | --- |
| omitted / `undefined` | Inherit the provider/catalog environment binding, unless an explicit alternate auth mode suppresses API-key inheritance. |
| non-empty string | Use that exact key/token or endpoint override. |
| `null` | Suppress environment inheritance for that field. The adapter's fixed service endpoint still applies when one exists. |

Blank or whitespace-only strings normalize to omission before environment
inheritance. Use `null`, not an empty string, when inheritance must be
suppressed.

This distinction matters for Gateway OIDC (`apiKey: null`), for forcing a
resource-name Azure endpoint despite an ambient `AZURE_BASE_URL`
(`baseURL: null`), and for any deployment where inherited secrets must not
silently select an auth mode.

Alternate explicit credentials are authoritative: Anthropic
`settings.authToken`, Claude Platform on AWS SigV4 settings, Bedrock SigV4
settings, Kling access-key settings, Azure `settings.tokenProvider`, and Vertex
project/location or `googleAuthOptions` suppress ambient API-key inheritance.
Supplying both an explicit `apiKey` string and the corresponding alternate
explicit mode fails with `AI_PROVIDER_CONFIG_INVALID`.

When config is entirely env-driven and both modes are present, Zero uses the
API-key/bearer entry first: Anthropic API key before bearer token, Claude
Platform on AWS API key before static SigV4 credentials, Bedrock bearer before
static SigV4 credentials, Kling API key before its legacy access-key pair, and
Vertex express key before project/location ADC. This is deterministic; use
explicit config to choose a different mode.

For example, omitted values inherit normal OpenAI env bindings:

```ts
ai: {
  providers: {
    openai: {
      type: 'openai',
      headers: { 'X-Application': 'billing-worker' },
      fetch: instrumentedFetch,
    },
    voyage: false,
  },
  aliases: {
    smart: 'openai/gpt-4o',
  },
}
```

Provider IDs in the built-in catalog reject accidental swaps between built-in
adapter types instead of inheriting the wrong env or capabilities. An explicit
`custom` or `openai-compatible` provider may intentionally replace a catalog
ID; compatible providers still require their own `baseURL`. The three legacy
cases that retain their catalog endpoint defaults are `deepseek`, `perplexity`,
and `voyage` with `openai-compatible`.

Provider IDs must match `[A-Za-z0-9][A-Za-z0-9._-]*`. They cannot contain the
`/` separator used by model references. Any resolved `baseURL` must be an
absolute `http://` or `https://` URL; invalid IDs or endpoints fail startup
with `AI_PROVIDER_CONFIG_INVALID`.

Common settings:

| Field | Purpose |
| --- | --- |
| `enabled` | Keep a provider visible but inactive when `false`. |
| `apiKey` | API key or bearer token; omit to inherit env, or use `null` to suppress key inheritance. |
| `baseURL` | Provider endpoint override; omit to inherit env, or use `null` to suppress the env override. |
| `headers` | Extra provider request headers. |
| `fetch` | Custom fetch for proxies, tests, tracing, or request middleware. |
| `settings` | Provider-specific construction settings. |
| `capabilities` | Capability overrides, primarily for custom/compatible providers. |
| `adapter` | AI SDK provider object/factory required by `type: 'custom'`. |

Capability overrides cannot make a built-in adapter expose a surface its
catalog entry does not implement. `openai-compatible` has a deliberate ceiling
of text, streaming, tools, vision, embeddings, and images; it cannot enable
transcription or speech. A `custom` adapter may declare any Zero capability it
actually implements. Overrides can always disable a supported capability.

`settings` fields are server-only:

| Setting | Provider/use |
| --- | --- |
| `authToken` | Anthropic bearer token used instead of `apiKey`; inherited from `ANTHROPIC_AUTH_TOKEN` only when no API key is selected. |
| `workspaceId`, `region`, `accessKeyId`, `secretAccessKey`, `sessionToken`, `credentialProvider` | Claude Platform on AWS workspace and API-key-or-SigV4 authentication. `workspaceId` is always required; API-key mode does not inherit ambient static credentials. |
| `region`, `runtimeBaseURL`, `agentRuntimeBaseURL`, `accessKeyId`, `secretAccessKey`, `sessionToken`, `credentialProvider` | Amazon Bedrock region, separate model-runtime/agent-runtime endpoints, and SigV4 credential alternatives; static env credentials are ignored when bearer auth is selected. Reranking uses the agent-runtime endpoint and requires a region. |
| `resourceName`, `tokenProvider`, `apiVersion`, `speechBaseURL`, `useDeploymentBasedUrls` | Azure endpoint/auth/version behavior. |
| `project`, `location`, `googleAuthOptions` | Google Vertex project/location and Google authentication. |
| `metadataCacheRefreshMillis` | Vercel AI Gateway metadata refresh interval. |
| `strictResponseInput` | Open Responses assistant-history serialization behavior. |
| `modelURL`, `performanceClient` | Baseten dedicated endpoint and optional native performance-client constructor. `modelURL` must end in `/sync` or `/sync/v1`; the constructor is accepted only with that URL. Embeddings are advertised only after this validation succeeds. |
| `embeddingBaseURL` | Alibaba embedding endpoint override. |
| `includeUsage` | Usage-detail forwarding for compatible/selected provider adapters. |
| `pollIntervalMillis`, `pollTimeoutMillis` | Polling controls for asynchronous media providers that support them. |
| `accessKey`, `secretKey` | Kling AI's legacy credential pair. Prefer `apiKey`; Zero requires both legacy values and rejects mixed explicit modes. |
| `version`, `webSocket` | Cartesia API version and an optional constructable WebSocket implementation for realtime-capable trusted server integrations. |
| `generateId` | Request-ID factory for providers that support caller-generated IDs. |
| `videoBaseURL` | Constructor endpoint accepted by Alibaba/MiniMax preview video models. |

TypeScript is the authoring contract, and Zero also validates settings at
runtime before constructing an SDK provider. Known strings are trimmed;
nested endpoint fields require absolute HTTP(S) URLs; polling/cache intervals
must be positive safe integers; and declared boolean/callback fields must have
the correct runtime type. Keep credentials and credential/token callbacks in
trusted server config; none are projected into status. Non-`custom` adapters
reject unsupported or invalid populated `settings.*` fields with
`AI_PROVIDER_CONFIG_INVALID` rather than silently ignoring them. Custom
adapters receive their app-defined settings object unchanged.

## Custom Provider Adapters

Use `type: 'custom'` with an AI SDK provider object or factory:

```ts
ai: {
  providers: {
    internal: {
      type: 'custom',
      adapter: ({ apiKey, baseURL, headers, fetch, settings }) =>
        createInternalAIProvider({ apiKey, baseURL, headers, fetch, settings }),
      capabilities: {
        text: true,
        streaming: true,
        tools: true,
      },
    },
  },
  aliases: {
    smart: 'internal/large',
  },
}
```

A custom provider without `adapter` remains inactive with reason
`missing_custom_provider_adapter`.

## Current Configuration Boundary

Zero's built-in provider catalog describes adapter activation and broad
capability surfaces. It is not a live model catalog: Zero does not currently
poll Vercel AI Gateway or provider model endpoints, maintain model pricing,
or continuously discover model-specific options/capabilities. Model IDs remain
explicit aliases or provider-qualified application choices.

Provider credentials, endpoints, aliases, and construction settings currently
come from trusted app config and environment variables. Zero does not provide
a database-backed provider-settings or secret-management control plane. A
future model catalog or database/env configuration layer must preserve the
same server-only credential, readiness, redaction, and live-authorization
boundaries; it is not part of the implemented API documented here.

Zero integrates official adapters only where the public service has a matching
operation. Evaluation-only adapters such as TypeSafe are not catalog entries
because Zero does not currently expose a public evaluation operation. Topaz is
advertised as image-only: its current video adapter requires an empty prompt,
while Zero's video contract deliberately requires a non-blank prompt. Zero does
not claim or bypass an operation whose contracts are incompatible.

## Model References

Every model reference uses `providerId/modelId` with a slash:

```ts
await ai.generateText({
  model: 'openai/gpt-4o',
  prompt: 'Summarize the account.',
});

await ai.generateText({
  model: 'gateway/anthropic/claude-opus-4.5',
  prompt: 'Review the account risks.',
});

await ai.embed({
  model: 'voyage/voyage-3',
  value: 'Document text',
});

await ai.generateSpeech({
  model: 'deepgram/aura-2-helena-en',
  text: 'The report is ready.',
});
```

Zero does not maintain an exhaustive model-name catalog. The portion before
the first slash selects an active Zero provider; the remainder is passed to
that provider adapter. Gateway model IDs naturally contain another slash, so
`gateway/openai/gpt-4o-mini` selects provider ID `gateway` and passes
`openai/gpt-4o-mini` to the Gateway adapter.

## Aliases

Default aliases are created only when an active provider matches one of Zero's
fixed candidates for that capability. When Gateway is active, those candidates
prefer its matching OpenAI or Anthropic models before direct providers.
Activating Bedrock, Azure, Vertex, or another provider not present in a given
candidate list does not invent a model ID and may leave that alias absent. Use
`providerId/modelId`, explicit `ai.aliases`, or `ZERO_AI_*_MODEL` in that case.
Explicit config or env aliases always override generated aliases.

The built-in candidate order is:

| Alias | Ordered candidates (first active, capable provider wins) |
| --- | --- |
| `fast` | `gateway/openai/gpt-4o-mini`; `groq/llama-3.3-70b-versatile`; `openai/gpt-4o-mini`; `google/gemini-2.5-flash`; `anthropic/claude-haiku-4-5` |
| `smart` | `gateway/anthropic/claude-opus-4.5`; `anthropic/claude-opus-4-5`; `openai/gpt-4o`; `google/gemini-2.5-pro`; `groq/llama-3.3-70b-versatile` |
| `embedding` | `gateway/openai/text-embedding-3-small`; `openai/text-embedding-3-small`; `voyage/voyage-3`; `google/gemini-embedding-001` |
| `image` | `gateway/openai/gpt-image-1`; `openai/gpt-image-1`; `google/imagen-4.0-generate-001` |
| `transcription` | `gateway/openai/gpt-4o-mini-transcribe`; `openai/gpt-4o-mini-transcribe`; `deepgram/nova-3`; `groq/whisper-large-v3-turbo` |
| `speech` | `gateway/openai/tts-1`; `deepgram/aura-2-helena-en`; `openai/gpt-4o-mini-tts`; `openai/tts-1` |
| `reranking` | `gateway/cohere/rerank-v3.5`; `cohere/rerank-v3.5`; `voyage/rerank-2.5`; `bedrock/amazon.rerank-v1:0`; `togetherai/Salesforce/Llama-Rank-v1` |
| `video` | `gateway/google/veo-3.1-fast-generate-001`; `google/veo-3.1-fast-generate-preview`; `google-vertex/veo-3.1-fast-generate-001`; `xai/grok-imagine-video`; `minimax/MiniMax-H3` |

Default aliases can be overridden through config or env. The same block can
select the default hosted-file provider:

```txt
ZERO_AI_FAST_MODEL=groq/llama-3.3-70b-versatile
ZERO_AI_SMART_MODEL=anthropic/claude-opus-4-5
ZERO_AI_EMBEDDING_MODEL=voyage/voyage-3
ZERO_AI_IMAGE_MODEL=openai/gpt-image-1
ZERO_AI_TRANSCRIPTION_MODEL=deepgram/nova-3
ZERO_AI_SPEECH_MODEL=deepgram/aura-2-helena-en
ZERO_AI_RERANKING_MODEL=cohere/rerank-v3.5
ZERO_AI_VIDEO_MODEL=google/veo-3.1-fast-generate-preview
ZERO_AI_FILES_PROVIDER=openai
```

`ZERO_AI_FILES_PROVIDER` selects an operation-level provider, not a model
alias. See [AI Hosted Files And Video](./ai-files-video.md).

## Base URLs

The generic env convention is `{PROVIDER_ID}_BASE_URL`, with punctuation
converted to underscores. Examples include `OPENAI_BASE_URL`,
`GOOGLE_VERTEX_BASE_URL`, `FISH_AUDIO_BASE_URL`, and
`BLACK_FOREST_LABS_BASE_URL`. New official adapters follow the same rule, for
example `ANTHROPIC_AWS_BASE_URL`, `PRODIA_BASE_URL`, `KLINGAI_BASE_URL`,
`CARTESIA_BASE_URL`, `GMICLOUD_BASE_URL`, and `TOPAZ_BASE_URL`. Zero also checks
the adapter-type name for an explicit provider whose ID differs from its type.

Every resolved override must be an absolute HTTP(S) URL. Relative paths and
non-HTTP schemes fail startup with `AI_PROVIDER_CONFIG_INVALID`.

Leave base URL variables empty for ordinary provider usage. Zero forwards
native adapter overrides directly. For official audio adapters with fixed
origins (Deepgram, ElevenLabs, Hume, Rev.ai, AssemblyAI, and Gladia), Zero
supplies an origin-rewriting fetch wrapper so an explicit override is never
silently ignored.

## Startup, Status, And Errors

At startup Zero:

1. Resolves explicit config and env-detected catalog providers.
2. Checks each provider's complete activation requirements.
3. Constructs active adapters through the provider factory boundary.
4. Emits enabled/skipped status without secret values.
5. Fails startup with `AI_PROVIDER_CONFIG_INVALID` or
   `AI_PROVIDER_INITIALIZATION_FAILED` when an active adapter cannot be built.

`ai.status()` returns every resolved provider entry, not only usable adapters.
With auto-detection enabled this includes untouched catalog entries as
inactive, with `source: 'env'`, no `configuredBy` values, and a bounded reason.
Explicitly disabled providers remain visible with `config_disabled`. Active
means the readiness check passed and an adapter instance was constructed; it
does not promise that every provider model supports every declared surface.

Inactive reasons include `missing_api_key`,
`missing_api_key_or_oidc_opt_in`, `missing_workspace_id`, `missing_region`,
`missing_credentials`, `partial_aws_credentials`,
`partial_klingai_credentials`, `missing_azure_endpoint`, `missing_project`,
`missing_location`, or `missing_base_url`. Status includes provider IDs, types,
source, safe base-URL origin, capability flags, aliases, and env variable names;
it never includes API keys, cloud credentials, token providers, headers, or
custom fetch functions. URL paths, user info, query parameters, and fragments
are omitted because any of them can contain proxy credentials.

On startup `AI_CONFIGURED` records the resolved provider-status count and alias
names. Provider startup events are emitted for active/configured entries;
untouched inactive catalog entries are not individually emitted. Provider
initialization observability records only provider ID, provider type, and a
closed safe failure classification (`Error`, `TypeError`, `RangeError`,
`ReferenceError`, `SyntaxError`, `URIError`, `AggregateError`, or
`provider_error`), never an arbitrary vendor class name or message. Request
events sanitize caller metadata recursively and
redact prompt/content/payload and credential-shaped keys; the framework never
copies prompts, messages, generated content, files, audio, or tool arguments
into metadata itself. A raw request error can remain in the app-local event
error channel, so external sinks still own safe serialization. See
[Observability](./observability.md) for the complete policy.

Run Doctor after changing provider configuration:

```txt
bun run doctor -- --config ./zero.config.ts
```

Doctor checks inactive configured providers, cloud readiness, compatible
providers without a base URL, custom providers without an adapter, invalid or
inactive aliases, capability mismatches, and optional status-route policy.
Runtime resolution separately rejects invalid provider IDs, non-HTTP(S) base
URLs, conflicting credential modes, and unsupported or invalid adapter
settings.

## Related Documentation

- [AI](./ai.md)
- [AI Generation And Streaming](./ai-generation.md)
- [AI Embeddings And Reranking](./ai-embeddings-reranking.md)
- [AI Hosted Files And Video](./ai-files-video.md)
- [AI Agents](./ai-agents.md)
- [AI Conversations](./ai-conversations.md)
- [AI Tools](./ai-tools.md)
- [Retired Meta Llama Provider](./ai-meta-llama.md)
- [Vector Store](./vector.md)
- [Observability](./observability.md)
