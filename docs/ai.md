# AI

Zero includes an opt-in server-side AI layer for app code, loaders, jobs,
workflows, and plugins.

The AI layer is internal by default. It does not expose public OpenAI-compatible
routes unless a future app/plugin deliberately adds them.

## Enable AI

```ts
import { createApp } from '@platform/server';

const app = await createApp({
  db: { mode: './data/app.db' },
  tables,
  auth: true,
  ai: true,
});
```

`ai: true` auto-detects configured providers from env keys. Add one or more
provider keys and Zero will make those providers active at startup.

## Use AI In Server Code

```ts
import { getAI } from '@platform/server';

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

Use explicit model ids when you want full control:

```ts
await ai.generateText({
  model: 'meta/Llama-4-Maverick-17B-128E-Instruct-FP8',
  prompt: 'Write a concise project summary.',
});
```

The provider is the part before the first slash. This is how app code selects
which provider/model to use for a normal text call, a conversation, a workflow
step, or a tool-enabled request.

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

The status payload includes active providers, capability flags, alias health,
and configured env key names. It never returns API keys.

## Core Methods

```ts
await ai.generateText({ model: 'smart', prompt: '...' });
const stream = ai.streamText({ model: 'fast', prompt: '...' });

const embedding = await ai.embed({
  model: 'embedding',
  value: 'Document text',
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
```

`transcribe()` only works when an active provider supports transcription. The
sibling transcription server remains a separate optional service because it
already ships its own SDK.

`generateSpeech()` only works when an active provider supports text-to-speech.
With `DEEPGRAM_API_KEY` set, the default `speech` alias resolves to
`deepgram/aura-2-helena-en`.

## Workflows And Jobs

The AI plugin mounts before the scheduler and workflow plugins, so workflow
handlers and scheduled jobs can use the same server-side service:

```ts
import { getAI } from '@platform/server';

registry.registerHandler('summarizeRecord', async (ctx) => {
  const ai = getAI();
  if (!ai) throw new Error('AI is not enabled.');

  return ai.generateConversation({
    model: 'smart',
    messages: [
      { role: 'user', content: JSON.stringify(ctx.workflowInput) },
    ],
  });
});
```

For common workflow steps, `createAIWorkflowHandler()` wraps that pattern:

```ts
import { createAIWorkflowHandler } from '@platform/server';

registry.registerHandler('summarizeRecord', createAIWorkflowHandler({
  model: 'smart',
  system: 'Summarize records for internal review.',
  prompt: (ctx) => JSON.stringify(ctx.input),
}));
```

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
import { createAIVectorBridge, getAI, getVectorStore } from '@platform/server';

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
    meta: {
      type: 'meta-llama',
      apiKey: Bun.env.META_LLAMA_API_KEY,
      baseURL: Bun.env.META_LLAMA_BASE_URL,
    },
    local: {
      type: 'openai-compatible',
      baseURL: 'http://127.0.0.1:11434/v1',
      apiKey: Bun.env.LOCAL_API_KEY,
    },
  },
  aliases: {
    smart: 'meta/Llama-4-Maverick-17B-128E-Instruct-FP8',
    fast: 'local/llama3.2',
  },
}
```

If an explicit catalog provider omits `apiKey` or `baseURL`, Zero still checks
that provider's env keys, such as `OPENAI_API_KEY` and `OPENAI_BASE_URL`.
Non-catalog explicit providers use provider-id keys such as `LOCAL_API_KEY` and
`LOCAL_BASE_URL`.

For fully custom AI SDK providers, use `type: 'custom'` with an `adapter` object
or adapter factory. `type: 'custom'` without `adapter` stays inactive instead of
reporting a provider Zero cannot call.

## Related Docs

- [AI Providers](./ai-providers.md)
- [AI Conversations](./ai-conversations.md)
- [AI Tools](./ai-tools.md)
- [Meta Llama Provider](./ai-meta-llama.md)
- [Vector Store](./vector.md)
