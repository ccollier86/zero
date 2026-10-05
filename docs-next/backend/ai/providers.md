---
id: zero.ai.providers
type: reference
audience: [developer, agent, operator]
owner: ai
status: draft
visibility: internal
system: ai
feature: providers
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

# Providers And Capabilities

[Zero AI](./index.md) · [Configuration](./configuration.md) · [Documentation index](../../index.md)

Zero ships 44 built-in adapter catalog entries, plus explicit
`openai-compatible` and `custom` adapters. This reference describes the inspected
static Zero catalog, not a remotely refreshed model list or pricing database.
Credential environment names below are checked in order during auto-detection;
explicit records also check the normalized provider-ID API-key binding first.

## Built-In Catalog

Capability flags are adapter-level maxima. They are not a promise that every
model/account has every listed capability. `realtime`, `evaluation`, `batch`
and `skills` flags do not create matching standalone Zero service methods:
the public Zero operations remain those documented by AIService and its
files/video/agent surfaces. Video is preview.

| Default ID | Adapter type | Credential env names, first nonblank wins | Static maximum capability flags |
| --- | --- | --- | --- |
| `gateway` | `gateway` | `AI_GATEWAY_API_KEY` | `text`, `streaming`, `tools`, `vision`, `embeddings`, `images`, `transcription`, `speech`, `reranking`, `video`, `realtime`, `evaluation`, `batch` |
| `openai` | `openai` | `OPENAI_API_KEY` | `text`, `streaming`, `tools`, `vision`, `embeddings`, `images`, `transcription`, `speech`, `files`, `fileMetadata`, `fileDownload`, `fileDelete`, `skills`, `realtime`, `evaluation`, `batch` |
| `azure` | `azure` | `AZURE_API_KEY` | `text`, `streaming`, `tools`, `vision`, `embeddings`, `images`, `transcription`, `speech` |
| `anthropic` | `anthropic` | `ANTHROPIC_API_KEY` | `text`, `streaming`, `tools`, `vision`, `files`, `skills`, `evaluation`, `batch` |
| `anthropic-aws` | `anthropic-aws` | `ANTHROPIC_AWS_API_KEY` | `text`, `streaming`, `tools`, `vision`, `files`, `skills` |
| `bedrock` | `amazon-bedrock` | `AWS_BEARER_TOKEN_BEDROCK` | `text`, `streaming`, `tools`, `vision`, `embeddings`, `images`, `reranking` |
| `google` | `google` | `GEMINI_API_KEY` → `GOOGLE_API_KEY` → `GOOGLE_GENERATIVE_AI_API_KEY` | `text`, `streaming`, `tools`, `vision`, `embeddings`, `images`, `transcription`, `speech`, `video`, `files`, `realtime`, `evaluation`, `batch` |
| `google-vertex` | `google-vertex` | `GOOGLE_VERTEX_API_KEY` | `text`, `streaming`, `tools`, `vision`, `embeddings`, `images`, `transcription`, `speech`, `video` |
| `groq` | `groq` | `GROQ_API_KEY` | `text`, `streaming`, `tools`, `vision`, `transcription` |
| `xai` | `xai` | `XAI_API_KEY` | `text`, `streaming`, `tools`, `vision`, `images`, `transcription`, `speech`, `video`, `files`, `fileMetadata`, `fileDownload`, `fileDelete`, `realtime`, `batch` |
| `cohere` | `cohere` | `COHERE_API_KEY` | `text`, `streaming`, `tools`, `vision`, `embeddings`, `reranking` |
| `mistral` | `mistral` | `MISTRAL_API_KEY` | `text`, `streaming`, `tools`, `vision`, `embeddings`, `transcription`, `speech` |
| `togetherai` | `togetherai` | `TOGETHER_API_KEY` → `TOGETHER_AI_API_KEY` | `text`, `streaming`, `tools`, `vision`, `embeddings`, `images`, `reranking` |
| `deepinfra` | `deepinfra` | `DEEPINFRA_API_KEY` | `text`, `streaming`, `tools`, `vision`, `embeddings`, `images` |
| `deepseek` | `deepseek` | `DEEPSEEK_API_KEY` | `text`, `streaming`, `tools`, `vision`, `files` |
| `cerebras` | `cerebras` | `CEREBRAS_API_KEY` | `text`, `streaming`, `tools` |
| `perplexity` | `perplexity` | `PERPLEXITY_API_KEY` → `PERPLEXITYAI_API_KEY` | `text`, `streaming`, `tools`, `vision`, `embeddings` |
| `fireworks` | `fireworks` | `FIREWORKS_API_KEY` | `text`, `streaming`, `tools`, `vision`, `embeddings`, `images` |
| `voyage` | `voyage` | `VOYAGE_API_KEY` | `embeddings`, `reranking` |
| `fal` | `fal` | `FAL_API_KEY` → `FAL_KEY` | `images`, `transcription`, `speech`, `video` |
| `luma` | `luma` | `LUMA_API_KEY` | `images` |
| `deepgram` | `deepgram` | `DEEPGRAM_API_KEY` | `transcription`, `speech` |
| `elevenlabs` | `elevenlabs` | `ELEVENLABS_API_KEY` | `transcription`, `speech` |
| `hume` | `hume` | `HUME_API_KEY` | `speech` |
| `revai` | `revai` | `REVAI_API_KEY` | `transcription` |
| `assemblyai` | `assemblyai` | `ASSEMBLYAI_API_KEY` | `transcription` |
| `gladia` | `gladia` | `GLADIA_API_KEY` | `transcription` |
| `fish-audio` | `fish-audio` | `FISH_AUDIO_API_KEY` | `transcription`, `speech` |
| `replicate` | `replicate` | `REPLICATE_API_TOKEN` | `images`, `video` |
| `prodia` | `prodia` | `PRODIA_TOKEN` | `text`, `streaming`, `vision`, `images`, `video` |
| `black-forest-labs` | `black-forest-labs` | `BFL_API_KEY` | `images`, `video` |
| `bytedance` | `bytedance` | `ARK_API_KEY` | `images`, `video` |
| `klingai` | `klingai` | `KLINGAI_API_KEY` | `video` |
| `cartesia` | `cartesia` | `CARTESIA_API_KEY` | `transcription`, `speech`, `realtime` |
| `gmicloud` | `gmicloud` | `GMI_CLOUD_APIKEY` | `text`, `streaming`, `tools` |
| `quiverai` | `quiverai` | `QUIVERAI_API_KEY` | `images` |
| `baseten` | `baseten` | `BASETEN_API_KEY` | `text`, `streaming`, `tools`, `embeddings` |
| `huggingface` | `huggingface` | `HUGGINGFACE_API_KEY` | `text`, `streaming`, `tools`, `vision` |
| `open-responses` | `open-responses` | None; endpoint required | `text`, `streaming`, `tools`, `vision` |
| `moonshotai` | `moonshotai` | `MOONSHOT_API_KEY` | `text`, `streaming`, `tools`, `vision` |
| `alibaba` | `alibaba` | `ALIBABA_API_KEY` | `text`, `streaming`, `tools`, `vision`, `embeddings`, `video` |
| `minimax` | `minimax` | `MINIMAX_API_KEY` | `text`, `streaming`, `tools`, `video` |
| `zai` | `zai` | `ZAI_API_KEY` | `text`, `streaming`, `tools`, `vision` |
| `topaz` | `topaz` | `TOPAZ_API_KEY` | `images` |

`AI_PROVIDER_CATALOG` and `AI_PROVIDER_TYPES` are public static metadata exports
from `@zero/framework/ai`. `AIProviderCatalogEntry`,
`AIProviderCapabilities`, `ResolvedAIProviderCapabilities` and
`AICapability` describe their contracts. The eight legacy required flags are
text, streaming, tools, vision, embeddings, images, transcription and speech;
later flags are optional in the compatibility input and normalize to booleans.

For a built-in, explicit capability overrides may reduce this maximum. Trying
to enable an unsupported operation raises `AI_PROVIDER_CONFIG_INVALID`.
Disabling files also disables metadata/download/delete; those operations cannot
be enabled independently without uploads. A model lookup can still reject a
model whose adapter-level capability was permitted.

## Activation Is Separate From Capability

Most API-key adapters require a nonblank key. Cloud/compatibility adapters use
the readiness rules in [provider settings](./provider-settings.md). An inactive
record is kept in safe status with its reason, but no SDK client is constructed
for it. A ready adapter still does not prove its credentials work remotely.

`AIService.getStatus()` returns `AIStatus`: safe provider statuses, alias
statuses and an optional files-provider status. Each provider status contains
ID/type, active/source/reason, configuration environment key names, capabilities
and a sanitized endpoint origin. It deliberately omits secrets, endpoint paths,
query strings and raw construction settings.

Startup adapter construction failures emit the standard initialization failure
event and raise `AI_PROVIDER_INITIALIZATION_FAILED` without copying raw vendor
error text into that public error. A custom factory must return a supported SDK
provider shape; it is trusted application code, not a sandbox.

## Custom Provider IDs

A provider ID identifies the app's configuration record, not necessarily the
adapter type. You can declare two OpenAI-compatible providers under different
IDs and use `internal/model-id` and `external/model-id` without rebuilding
generation UI/transport. Read [configuration precedence](./configuration.md#provider-detection-and-precedence)
before assuming `autoDetect: false` also disables explicit-record env fallback.

Model references split at the first slash; `gateway/vendor/model-id` selects the
Zero provider `gateway` and sends `vendor/model-id` to that adapter. The gateway
is an outbound provider adapter; Zero does not expose a public OpenAI-compatible
proxy endpoint simply because this adapter is enabled.

## Compatibility Adapters

### OpenAI-Compatible

Declare `type: 'openai-compatible'` and an absolute HTTP(S) baseURL; a key is
optional if the app's trusted endpoint does not need one. Headers/fetch and
`settings.includeUsage` are available. This adapter can support text, streaming,
tools, vision, embeddings and images when explicitly advertised; it cannot
advertise the separate speech/transcription/rerank/video/files surface.

The default explicit custom/compatible surface is text, streaming and tools,
with other flags false. Enable only modalities your endpoint actually implements.
Zero's compatibility contract does not prove an arbitrary endpoint follows the
provider protocol.

### Custom

Declare `type: 'custom'` with an `adapter` SDK ProviderV3/ProviderV4 object or
a factory. A factory receives `AICustomProviderContext`: the configured ID,
resolved key/baseURL, headers, fetch, settings and capability map. Zero normalizes
vendor method aliases for language/embedding/image/audio/reranking/files
operations while binding methods to their provider instance.

Custom adapters use their declared capabilities, not a built-in maximum. Their
construction settings are trusted app-owned semantics; the built-in
unsupported-setting admission table does not constrain the custom factory.
Credential handling and remote endpoint authority remain your responsibility.

## Amazon Bedrock

The default catalog ID is `bedrock`; the adapter type is `amazon-bedrock`.
Its runtime service handles language, embeddings and images; reranking uses
Bedrock Agent Runtime. Use [cloud settings](./provider-settings.md#aws-providers)
for explicit credential modes and independently resolved endpoints.

Zero also owns a compatibility correction for conversation history on turns
with no active tools: historical tool calls/results are preserved as bounded
non-executable text when Bedrock cannot accept native tool blocks. This does not
activate tools, alter toolChoice or execute history. Active native tool blocks
remain native. Unsupported binary/reference-file, non-JSON, excessive-depth or
over-1-MiB projections fail closed. This preservation is not a general history
summarizer or storage feature.

## Provider-Specific Capability Constraints

- Vertex transcription requires ADC-style project/location configuration; express
  API-key mode or missing project/location removes that capability.
- Bedrock reranking requires a region even when runtime inference uses a custom
  endpoint.
- Baseten embeddings require a modelURL.
- Prodia's static catalog includes text/stream/vision/image/video; Topaz includes
  images, not video under Zero's prompt contract.
- Direct Meta-hosted Llama is retired. `createMetaLlama` and `metaLlama` are
  compatibility tombstones; model lookup/config activation raises
  `AI_PROVIDER_RETIRED` rather than contacting the retired service. Llama models
  available through another provider are not affected by that tombstone.
- There is no Zero model-evaluation operation, and no TypeSafe adapter is listed.

## Static Default Model Candidates

Default aliases choose the first candidate whose local provider is active and
capability-compatible. That selection is not a live model entitlement check.
Prefer explicit aliases for production workloads and review them with your
account/model rollout policy. The precise candidate list belongs to this source
version; it is not an evergreen recommendation.

| Alias | Candidate order |
| --- | --- |
| fast | gateway/openai/gpt-4o-mini → groq/llama-3.3-70b-versatile → openai/gpt-4o-mini → google/gemini-2.5-flash → anthropic/claude-haiku-4-5 |
| smart | gateway/anthropic/claude-opus-4.5 → anthropic/claude-opus-4-5 → openai/gpt-4o → google/gemini-2.5-pro → groq/llama-3.3-70b-versatile |
| embedding | gateway/openai/text-embedding-3-small → openai/text-embedding-3-small → voyage/voyage-3 → google/gemini-embedding-001 |
| image | gateway/openai/gpt-image-1 → openai/gpt-image-1 → google/imagen-4.0-generate-001 |
| transcription | gateway/openai/gpt-4o-mini-transcribe → openai/gpt-4o-mini-transcribe → deepgram/nova-3 → groq/whisper-large-v3-turbo |
| speech | gateway/openai/tts-1 → deepgram/aura-2-helena-en → openai/gpt-4o-mini-tts → openai/tts-1 |
| reranking | gateway/cohere/rerank-v3.5 → cohere/rerank-v3.5 → voyage/rerank-2.5 → bedrock/amazon.rerank-v1:0 → togetherai/Salesforce/Llama-Rank-v1 |
| video | gateway/google/veo-3.1-fast-generate-001 → google/veo-3.1-fast-generate-preview → google-vertex/veo-3.1-fast-generate-001 → xai/grok-imagine-video → minimax/MiniMax-H3 |

## Verification And Related Guides

Inspect safe status first; distinguish invalid config, inactive credentials,
missing aliases and unsupported capabilities from actual remote failure. Use
synthetic environment maps for local resolver tests and provider doubles for
operation tests. No live provider call was made to qualify this static table.

[Configuration](./configuration.md) owns precedence, suppression and aliases.
[Provider settings](./provider-settings.md) owns every construction setting and
cloud credential alternative. [Roadmap](./roadmap.md) covers future model/pricing
catalog and control-plane work, which this static reference does not imply.
