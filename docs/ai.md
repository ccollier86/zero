# AI

Zero includes an opt-in server-side AI layer for app code, loaders, jobs,
Torrent workflows, and plugins.

The AI layer is internal by default. It does not expose public OpenAI-compatible
routes unless a future app/plugin deliberately adds them.

## Enable AI

```ts
import { createApp } from '@zero/framework/server';

const app = await createApp({
  db: { mode: 'file', path: './data/app.db' },
  tables,
  auth: true,
  ai: true,
});
```

`ai: true` auto-detects built-in providers from env. Simple providers activate
from their API key; Claude Platform on AWS, Bedrock, Azure, and Vertex use
provider-specific cloud readiness rules. Zero ships official adapters for the
major language, embedding, image, transcription, and speech providers, plus
Vercel AI Gateway,
Open Responses, OpenAI-compatible endpoints, and custom AI SDK providers. See
[AI Providers](./ai-providers.md) for the complete catalog and exact activation
requirements.

Generated app config runs the same readiness resolver as the runtime, so
complete API-key, bearer-token, cloud-credential, ADC, and base-URL env shapes
auto-enable AI consistently. `ZERO_AI_ENABLED=false` suppresses that result;
`true` forces the plugin on but does not invent credentials or opt into
Gateway OIDC. Declare Gateway OIDC in trusted config with
`{ type: 'gateway', apiKey: null }`; omitting `apiKey` still inherits an
ambient `AI_GATEWAY_API_KEY`.

Zero exposes text, streaming, structured output, tools, vision, embeddings,
batch embeddings, reranking, images, transcription, speech, bounded
provider-hosted files, preview video, bounded ephemeral agents, and the
Torrent-durable agent bridge. Provider capability flags describe an adapter's
available surfaces; the selected provider/model must also support the requested
operation. See [AI Hosted Files And Video](./ai-files-video.md) for provider
binding, fixed transfer ceilings, reusable file references, and durable video
operation envelopes; see [AI Agents](./ai-agents.md) and
[Durable AI Agents With Torrent](./ai-durable-agents.md) for the two execution
lifecycles.

## Use AI In Server Code

```ts
import { getAI } from '@zero/framework/server';

const ai = getAI();
if (!ai) throw new Error('AI is not enabled.');

const result = await ai.generateText({
  model: 'smart',
  prompt: 'Summarize this customer account.',
});

return result.text;
```

Friendly aliases are resolved to active provider models:

| Alias | Purpose |
| --- | --- |
| `fast` | Lower-latency chat model. |
| `smart` | Stronger chat/reasoning model. |
| `embedding` | Text embedding model. |
| `image` | Image generation model. |
| `transcription` | Audio transcription model. |
| `speech` | Text-to-speech model. |
| `reranking` | Document reranking model. |
| `video` | Preview video generation model. |

Zero creates a default alias only when an active provider matches a fixed
candidate for that capability. Cloud-only Bedrock, Azure, or Vertex config can
therefore be fully active without producing `fast` or `smart`; use a
provider-qualified model or configure `ai.aliases` / `ZERO_AI_*_MODEL`.

Use explicit model ids when you want full control:

```ts
await ai.generateText({
  model: 'groq/meta-llama/llama-4-scout-17b-16e-instruct',
  prompt: 'Write a concise project summary.',
});
```

The provider is the part before the first slash. This is how app code selects
which provider/model to use for a normal text call, a conversation, a workflow
step, or a tool-enabled request.

<a id="status"></a>

## Runtime Status

AI status is available through the service:

```ts
const status = ai.status();
```

No AI routes are mounted by default. If an app explicitly wants a protected
runtime inspection route, opt in:

```ts
ai: {
  statusEndpoint: { enabled: true },
}
```

That exposes:

```txt
GET /api/_zero/ai/status
```

Route access defaults to:

1. Admin-only when auth is enabled.
2. Development-only when auth is disabled.

The status payload includes every resolved provider entry, including inactive
catalog/config entries with their bounded reason, plus capability flags, alias
health, source, and configured env key names. `active` means readiness passed
and the provider adapter was constructed; it does not guarantee every model
supports every declared adapter capability. Status never returns API keys,
cloud credentials, token/credential providers, headers, or custom fetch
implementations.

## Core Methods

```ts
import { t } from 'elysia';
import { AIOutput } from '@zero/framework/server';

await ai.generateText({ model: 'smart', prompt: '...' });
const stream = ai.streamText({ model: 'fast', prompt: '...' });

const structured = await ai.generateText({
  model: 'smart',
  prompt: 'Extract the account id and risk level.',
  output: AIOutput.object({
    schema: t.Object({
      accountId: t.String(),
      risk: t.Union([t.Literal('low'), t.Literal('high')]),
    }),
  }),
});

const embedding = await ai.embed({
  model: 'embedding',
  value: 'Document text',
});

const embeddings = await ai.embedMany({
  model: 'embedding',
  values: ['First document', 'Second document'],
});

const ranking = await ai.rerank({
  model: 'reranking',
  query: 'Which document explains tenant isolation?',
  documents: ['Torrent runs workflows.', 'Fabric isolates tenant databases.'],
  topN: 1,
});

const image = await ai.generateImage({
  model: 'image',
  prompt: 'Product mockup on a clean desk',
});

const transcript = await ai.transcribe({
  model: 'transcription',
  audio: audioBytes,
});

const speech = await ai.generateSpeech({
  model: 'speech',
  text: 'Hello from Zero.',
  outputFormat: 'mp3',
});

const uploaded = await ai.files.upload({
  data: { type: 'text', text: 'Provider-reusable context' },
  mediaType: 'text/plain',
  filename: 'context.txt',
});

const video = await ai.video.start({
  model: 'video',
  prompt: 'A product reveal in a clean studio.',
});
```

Generation requests expose SDK 7 instructions, provider-neutral reasoning,
typed output, runtime/tool context, active-tool/step controls, signed approval
configuration, total/step/stream/tool timeouts, retries, and lifecycle
callbacks. Existing `system`, plain-text, numeric-timeout, conversation, and
tool-helper calls remain compatible. See
[AI Generation And Streaming](./ai-generation.md) for the complete contract
and migration notes.

`embedMany()` preserves input order and bounds value count, byte size,
parallelism, and retries. `rerank()` accepts a homogeneous set of strings or
plain JSON objects and validates provider result integrity. See
[AI Embeddings And Reranking](./ai-embeddings-reranking.md).

Remote image/file message parts which a model cannot consume by URL are
materialized through Zero's DNS-pinned, redirect-validated Bun downloader with
a fixed 64-MiB aggregate budget per generation request. Assets are downloaded
sequentially; provider-native URLs remain remote and do not consume that
budget. See
[AI Generation And Streaming](./ai-generation.md#remote-image-and-file-inputs).

The same Bun-only network boundary DNS-pins every resolved public address,
revalidates every redirect, preserves HTTP/TLS authority, honors cancellation,
and bounds default URL-audio transcription and provider-returned video
downloads. Trusted code can replace only the transcription download callback;
doing so explicitly assumes that transport and byte-limit policy.

`ai.files` provides bounded provider-hosted upload, metadata, download, and
delete operations. `ai.video` provides preview generate, asynchronous start,
and model-pinned status operations. Neither surface mounts a route or replaces
Guardian/Fabric ownership checks. See
[AI Hosted Files And Video](./ai-files-video.md).

`transcribe()` only works when an active provider supports transcription. The
sibling transcription server remains a separate optional service because it
already ships its own SDK. URL audio uses Zero's DNS-pinned,
redirect-revalidated Bun downloader with a 64-MiB ceiling by default. Trusted
app code can supply `request.download` as an explicit replacement, in which
case that callback owns outbound-network and byte-limit policy.

`generateSpeech()` only works when an active provider supports text-to-speech.
With `DEEPGRAM_API_KEY` set and no earlier active Gateway speech candidate, the
default `speech` alias resolves to `deepgram/aura-2-helena-en`.

## Torrent Workflows And Jobs

The AI plugin mounts before the scheduler and Torrent workflow plugins, so workflow
activities and scheduled jobs can use the same server-side service. Put workflow
registration inside `AppConfig.workflows.register`:

```ts
import { defineZeroConfig } from '@zero/framework/server';
import { flow, step } from '@zero/framework/workflows';

export default defineZeroConfig({
  // db, tables, auth, ai...
  workflows: {
    register(registry, { ai }) {
      if (!ai) throw new Error('AI is not enabled.');
      registry.registerActivity({
        name: 'ai.summarize-record',
        version: '1',
        handler: async (ctx) => {
          ctx.signal?.throwIfAborted();
          const result = await ai.generateConversation({
            model: 'smart',
            messages: [
              { role: 'user', content: JSON.stringify(ctx.workflowInput) },
            ],
            abortSignal: ctx.signal,
            metadata: { workflowIdempotencyKey: ctx.idempotencyKey },
          });
          return { text: result.text };
        },
      });

      registry.create({
        name: 'summarize-record',
        flow: flow(step('summarize', 'ai.summarize-record')),
      });
    },
  },
});
```

For common workflow activities, `createAIWorkflowHandler()` wraps that pattern:

```ts
import { createAIWorkflowHandler } from '@zero/framework/server';

registry.registerActivity({
  name: 'ai.summarize-record',
  handler: createAIWorkflowHandler({
    service: ai,
    model: 'smart',
    system: 'Summarize records for internal review.',
    prompt: (ctx) => JSON.stringify(ctx.input),
  }),
});
```

Here `ai` is the app-local service supplied to the surrounding
`workflows.register(registry, { ai })` callback. Passing it explicitly avoids
binding the handler to a process-global compatibility service.

The helper adds workflow instance/step metadata to the AI request, combines
the workflow's cancellation signal with any configured AI abort signal, and
revalidates `ctx.assertCurrentAuthority()` immediately before the provider
request. Workflow execution is at-least-once after a crash, so use
`ctx.idempotencyKey` for any separate nontransactional effect that must not
happen twice.
See [Torrent: Durable Workflows](./workflows.md) for activity versions and schemas,
graph authoring, retry/deadline/recovery semantics, and owner-scoped live state.

For a bounded agent loop that persists its private transcript and typed
contexts, pauses through Torrent interactions for approval, and resumes under
fresh Guardian authority after restart, use the first-party durable bridge.
It compiles the same immutable `defineAIAgent()` definition into a finite
version-pinned graph; see
[Durable AI Agents With Torrent](./ai-durable-agents.md).

For repeated server-side calls that should carry previous user and assistant
turns, use the transient session helper:

```ts
const session = ai.session({
  model: 'smart',
  system: 'Keep answers short.',
  maxMessages: 12,
});

await session.send('Summarize this record.');
const followup = await session.send('Now list the open risks.');
```

The session helper is bounded in-memory history only; it is not persisted chat
storage.

## AI Plus Vector Search

AI embeddings and vector storage stay separate. Generate embeddings with
`AIService`, then store/search them with `VectorService`, or use the thin
bridge helper:

```ts
import { createAIVectorBridge, getAI, getVectorStore } from '@zero/framework/server';

const ai = getAI();
const vectors = getVectorStore();
if (!ai || !vectors) throw new Error('AI/vector services are not enabled.');

const bridge = createAIVectorBridge({ ai, vectors });

await bridge.embedAndUpsert('knowledge', {
  id: 'doc_1',
  text: 'Zero can compose AI embeddings with local zvec storage.',
  metadata: { bucket: 'docs' },
});
```

See [Vector Store](./vector.md) for index config, filters, scoped helpers, and
workflow examples.

## Explicit Config

Auto-detection is the default for `ai: true`, but explicit config wins:

```ts
ai: {
  providers: {
    bedrock: {
      type: 'amazon-bedrock',
      settings: {
        region: 'us-east-1',
        credentialProvider: () => loadApplicationAwsCredentials(),
      },
    },
    local: {
      type: 'openai-compatible',
      baseURL: 'http://127.0.0.1:11434/v1',
      apiKey: Bun.env.LOCAL_API_KEY,
    },
  },
  aliases: {
    smart: 'bedrock/us.anthropic.claude-sonnet-4-20250514-v1:0',
    fast: 'local/llama3.2',
  },
}
```

If an explicit catalog provider omits `apiKey` or `baseURL`, Zero still checks
that provider's env keys, such as `OPENAI_API_KEY` and `OPENAI_BASE_URL`.
Set either field to `null` to suppress its env inheritance; `baseURL: null` can
still use an adapter's fixed service endpoint. Non-catalog explicit providers
use provider-id keys such as `LOCAL_API_KEY` and `LOCAL_BASE_URL`. Explicit
blank strings normalize to omission and therefore still inherit env; use
`null` for suppression. Explicit
alternate auth settings suppress ambient API keys, while configuring an
explicit API key and alternate mode together fails closed.

Provider IDs must match `[A-Za-z0-9][A-Za-z0-9._-]*`, and resolved base URLs
must be absolute HTTP(S) URLs. Non-custom adapters also reject populated
`settings.*` fields they do not support. Settings strings are normalized, and
nested URLs, interval values, booleans, and callbacks are runtime-validated.
These configuration mistakes fail startup with `AI_PROVIDER_CONFIG_INVALID`
instead of being ignored.

Provider configuration also accepts request `headers`, a custom `fetch`, and a
typed `settings` object for cloud credentials/endpoints, gateway metadata
caching, media polling, and other adapter construction options. Bedrock needs a
region plus static/dynamic SigV4 credentials, or bearer auth with either a
region or a model-runtime endpoint from `BEDROCK_BASE_URL`,
`AMAZON_BEDROCK_BASE_URL`, `AWS_ENDPOINT_URL_BEDROCK_RUNTIME`, or
`AWS_ENDPOINT_URL`. `AWS_ENDPOINT_URL_BEDROCK_AGENT_RUNTIME` independently
selects the reranking service endpoint; it does not replace the region that
reranking requires. Region alone does not opt in to ambient AWS identity.
Anthropic accepts either `ANTHROPIC_API_KEY` or bearer
`ANTHROPIC_AUTH_TOKEN`. Azure needs an endpoint and a key/token provider.
Vertex accepts express API-key mode or project/location with Google Cloud
authentication.

Use `gateway: { type: 'gateway', apiKey: null }` to opt in to Vercel OIDC
without inheriting `AI_GATEWAY_API_KEY`. Env auto-detection deliberately
requires that key, so ambient OIDC is never attempted without explicit config.

`AIOutput.text()`, `AIOutput.object()`, `AIOutput.array()`,
`AIOutput.choice()`, and `AIOutput.json()` provide Zero's typed structured-
output surface. A completed response that does not match the requested output
fails with the stable `AI_OUTPUT_INVALID` code.

For fully custom AI SDK providers, use `type: 'custom'` with an `adapter` object
or adapter factory. `type: 'custom'` without `adapter` stays inactive instead of
reporting a provider Zero cannot call.

## Related Docs

- [AI Providers](./ai-providers.md)
- [AI Generation And Streaming](./ai-generation.md)
- [AI Embeddings And Reranking](./ai-embeddings-reranking.md)
- [AI Hosted Files And Video](./ai-files-video.md)
- [AI Agents](./ai-agents.md)
- [Durable AI Agents With Torrent](./ai-durable-agents.md)
- [AI Conversations](./ai-conversations.md)
- [AI Tools](./ai-tools.md)
- [Retired Meta Llama Provider](./ai-meta-llama.md)
- [Vector Store](./vector.md)
- [Observability](./observability.md)
