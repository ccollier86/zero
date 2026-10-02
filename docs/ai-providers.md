# AI Providers

Zero auto-enables supported AI providers when `ai: true` and that provider's
required env key is present.

This page is the source of truth for the env keys a developer must set before
calling a provider from app code. If a key is missing, the provider remains
visible in `ai.status()` but inactive, and calls to that provider fail before a
provider request is sent.

## Env Auto-Detection

| Provider ID | Backing adapter | Required env key | Alternative key | Optional base URL override | Default base URL | Declared capabilities |
| --- | --- | --- | --- | --- | --- | --- |
| `openai` | `@ai-sdk/openai` | `OPENAI_API_KEY` | none | `OPENAI_BASE_URL` | AI SDK default | text, streaming, tools, vision, embeddings, images, transcription, speech |
| `anthropic` | `@ai-sdk/anthropic` | `ANTHROPIC_API_KEY` | none | `ANTHROPIC_BASE_URL` | AI SDK default | text, streaming, tools, vision |
| `google` | `@ai-sdk/google` | `GEMINI_API_KEY` | `GOOGLE_API_KEY` | `GOOGLE_BASE_URL` | AI SDK default | text, streaming, tools, vision |
| `groq` | `@ai-sdk/groq` | `GROQ_API_KEY` | none | `GROQ_BASE_URL` | AI SDK default | text, streaming, tools |
| `xai` | `@ai-sdk/xai` | `XAI_API_KEY` | none | `XAI_BASE_URL` | AI SDK default | text, streaming, tools, vision |
| `cohere` | `@ai-sdk/cohere` | `COHERE_API_KEY` | none | `COHERE_BASE_URL` | AI SDK default | text, streaming, tools |
| `meta` | Zero `meta-llama` adapter | `LLAMA_API_KEY` | `META_LLAMA_API_KEY` | `META_BASE_URL` or `META_LLAMA_BASE_URL` | `https://api.llama.com/v1` | text, streaming, tools, vision |
| `deepseek` | `@ai-sdk/openai-compatible` | `DEEPSEEK_API_KEY` | none | `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | text, streaming, tools |
| `perplexity` | `@ai-sdk/openai-compatible` | `PERPLEXITY_API_KEY` | `PERPLEXITYAI_API_KEY` | `PERPLEXITY_BASE_URL` | `https://api.perplexity.ai` | text, streaming, tools |
| `voyage` | `@ai-sdk/openai-compatible` | `VOYAGE_API_KEY` | none | `VOYAGE_BASE_URL` | `https://api.voyageai.com/v1` | text, streaming, tools, embeddings |
| `deepgram` | `@ai-sdk/deepgram` | `DEEPGRAM_API_KEY` | none | `DEEPGRAM_BASE_URL` | AI SDK default | transcription, speech |

For providers with an alternative key, either key activates the provider. If
both are present, Zero uses the first key listed in the table.

## Minimal Env Examples

OpenAI:

```txt
OPENAI_API_KEY=sk-...
```

Anthropic:

```txt
ANTHROPIC_API_KEY=sk-ant-...
```

Google:

```txt
GEMINI_API_KEY=...
# or
GOOGLE_API_KEY=...
```

Groq:

```txt
GROQ_API_KEY=gsk_...
```

xAI:

```txt
XAI_API_KEY=xai-...
```

Cohere:

```txt
COHERE_API_KEY=...
```

Meta Llama:

```txt
LLAMA_API_KEY=...
# or
META_LLAMA_API_KEY=...
```

DeepSeek:

```txt
DEEPSEEK_API_KEY=...
```

Perplexity:

```txt
PERPLEXITY_API_KEY=pplx-...
# or
PERPLEXITYAI_API_KEY=pplx-...
```

Voyage:

```txt
VOYAGE_API_KEY=pa-...
```

Deepgram:

```txt
DEEPGRAM_API_KEY=...
```

## Base URLs

For normal use, do not set base URL variables. Native AI SDK providers use
their own defaults, and Zero provides defaults for the built-in
OpenAI-compatible providers in the table.

Set base URL variables only when using a proxy, a local gateway, a self-hosted
compatible endpoint, or a provider endpoint override.

Optional base URL env overrides use the provider id or type:

```txt
OPENAI_BASE_URL=https://proxy.example.com/v1
ANTHROPIC_BASE_URL=https://proxy.example.com
GOOGLE_BASE_URL=https://proxy.example.com
GROQ_BASE_URL=https://proxy.example.com/openai/v1
XAI_BASE_URL=https://proxy.example.com/v1
COHERE_BASE_URL=https://proxy.example.com
META_BASE_URL=https://api.llama.com/v1
META_LLAMA_BASE_URL=https://api.llama.com/v1
DEEPSEEK_BASE_URL=https://api.deepseek.com
PERPLEXITY_BASE_URL=https://api.perplexity.ai
VOYAGE_BASE_URL=https://api.voyageai.com/v1
DEEPGRAM_BASE_URL=https://proxy.example.com
```

OpenAI-compatible catalog providers also accept `OPENAI_COMPATIBLE_BASE_URL`,
but provider-specific keys are clearer when multiple compatible providers are
configured. A custom explicit `openai-compatible` provider that is not one of
Zero's catalog providers must provide a `baseURL` in `createApp()` config or a
matching provider-id env key such as `LOCAL_BASE_URL`.

## Explicit Provider Config

Explicit provider config wins over env auto-detection for the same provider id,
but omitted settings can still inherit env values:

```ts
ai: {
  providers: {
    openai: {
      type: 'openai',
      // apiKey/baseURL omitted: Zero reads OPENAI_API_KEY and OPENAI_BASE_URL.
    },
    local: {
      type: 'openai-compatible',
      // With provider id "local", Zero can read LOCAL_API_KEY and LOCAL_BASE_URL.
    },
  },
}
```

For catalog providers, Zero uses the catalog env keys from the table above. For
non-catalog explicit providers, Zero checks provider-id keys first:

```txt
LOCAL_API_KEY=...
LOCAL_BASE_URL=http://127.0.0.1:11434/v1
```

Then it checks the adapter type key, such as `OPENAI_COMPATIBLE_API_KEY` or
`OPENAI_COMPATIBLE_BASE_URL`.

## Custom Provider Adapters

Use `type: 'custom'` only when you provide an AI SDK provider object or factory.
An API key alone does not activate a custom provider because Zero would have no
adapter to call.

```ts
ai: {
  providers: {
    internal: {
      type: 'custom',
      adapter: ({ apiKey, baseURL }) => createInternalAIProvider({ apiKey, baseURL }),
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

The adapter can also be an object returned by the AI SDK `customProvider()`
helper. If `type: 'custom'` is configured without `adapter`, the provider remains
inactive with reason `missing_custom_provider_adapter`, and platform doctor
reports `ai.provider.custom_adapter_missing`.

Run platform doctor after changing AI config:

```txt
bun run doctor -- --config ./zero.config.ts
```

Doctor checks inactive configured providers, custom OpenAI-compatible providers
without a base URL, custom providers without an adapter, aliases that point at
missing/inactive providers, aliases that are not `provider/model`, provider
capability mismatches, and optional AI status endpoint access policy.

## Startup Behavior

With this config:

```ts
const app = await createApp({
  db,
  tables,
  ai: true,
});
```

Zero scans the exact env keys above at startup.

1. If a provider key is present, that provider is active.
2. If no key is present, that provider is inactive with reason
   `missing_env_key`.
3. If a provider is selected in a `model` string but inactive, the call fails
   with `AI_PROVIDER_NOT_ACTIVE`.
4. Secret values are kept inside provider config and are never returned from
   `ai.status()`.
5. Alias/model resolution failures emit `ZERO_AI_MODEL_ALIAS_UNRESOLVED` before
   any provider request is started.

## Model IDs

Use `providerId/modelId`:

```ts
await ai.generateText({
  model: 'openai/gpt-4o',
  prompt: '...',
});

await ai.generateText({
  model: 'meta/Llama-4-Maverick-17B-128E-Instruct-FP8',
  prompt: '...',
});
```

Provider ids are developer-facing. `meta` maps internally to Zero's custom
`meta-llama` adapter.

Example model strings:

| Provider ID | Example model string |
| --- | --- |
| `openai` | `openai/gpt-4o` |
| `anthropic` | `anthropic/claude-opus-4.5` |
| `google` | `google/gemini-2.5-pro` |
| `groq` | `groq/llama-3.3-70b-versatile` |
| `xai` | `xai/grok-2-vision-1212` |
| `cohere` | `cohere/command-r-plus` |
| `meta` | `meta/Llama-4-Maverick-17B-128E-Instruct-FP8` |
| `deepseek` | `deepseek/deepseek-chat` |
| `perplexity` | `perplexity/sonar-pro` |
| `voyage` | `voyage/voyage-3` |
| `deepgram` | `deepgram/nova-3`, `deepgram/aura-2-helena-en` |

Zero does not hard-code every provider model name. The provider id must match
this table, and the model id after the slash must be valid for that provider
account.

Provider/model selection is always per call. Tools, Torrent workflows, jobs,
and route handlers all use the same request shape:

```ts
await ai.generateConversation({
  model: 'anthropic/claude-opus-4.5',
  messages,
  tools,
});

await ai.generateConversation({
  model: 'meta/Llama-4-Maverick-17B-128E-Instruct-FP8',
  messages,
  tools,
});
```

Zero checks the selected provider's declared capabilities before calling it. A
tool request sent to a provider without tool support fails with a clear
`AI_CAPABILITY_NOT_SUPPORTED` error.

## Speech

Speech generation uses the same provider/model string format:

```ts
const audio = await ai.generateSpeech({
  model: 'speech',
  text: 'Your report is ready.',
  outputFormat: 'mp3',
});
```

With `DEEPGRAM_API_KEY` set, the default `speech` alias resolves to
`deepgram/aura-2-helena-en`. You can select a Deepgram voice directly:

```ts
await ai.generateSpeech({
  model: 'deepgram/aura-2-zeus-en',
  text: 'System check complete.',
});
```

Deepgram provider-specific speech options can be passed through
`providerOptions.deepgram`:

```ts
await ai.generateSpeech({
  model: 'deepgram/aura-2-helena-en',
  text: 'Export complete.',
  providerOptions: {
    deepgram: {
      container: 'wav',
      sampleRate: 24000,
    },
  },
});
```

## Aliases

Default aliases are selected from active providers. You can override them with
env:

```txt
ZERO_AI_FAST_MODEL=groq/llama-3.3-70b-versatile
ZERO_AI_SMART_MODEL=meta/Llama-4-Maverick-17B-128E-Instruct-FP8
ZERO_AI_EMBEDDING_MODEL=openai/text-embedding-3-small
ZERO_AI_IMAGE_MODEL=openai/gpt-image-1
ZERO_AI_TRANSCRIPTION_MODEL=openai/gpt-4o-mini-transcribe
ZERO_AI_SPEECH_MODEL=deepgram/aura-2-helena-en
```

Or with `createApp()`:

```ts
ai: {
  aliases: {
    smart: 'anthropic/claude-opus-4.5',
    fast: 'groq/llama-3.3-70b-versatile',
  },
}
```

## Status

Inspect active providers:

```ts
const status = ai.status();
```

No AI routes are mounted by default. Apps that deliberately want an HTTP
inspection route can opt in:

```ts
ai: {
  statusEndpoint: { enabled: true },
}
```

The service status, and optional endpoint if enabled, return provider ids,
types, active flags, capabilities, alias health, and env key names. They do not
return secret values.

Example:

```ts
const status = ai.status();
const openai = status.providers.find((provider) => provider.id === 'openai');

if (!openai?.active) {
  throw new Error(`OpenAI is not configured: ${openai?.reason}`);
}
```
