# Meta Llama Provider

Zero includes a custom AI SDK provider adapter for Meta's hosted Llama API.

This is different from a generic OpenAI-compatible adapter. Meta's native API
can return Meta-specific completion and stream event shapes, so Zero keeps a
native adapter and exposes it under the developer-facing provider id `meta`.

## Enable

Set either env key:

```txt
LLAMA_API_KEY=...
META_LLAMA_API_KEY=...
```

Then enable AI:

```ts
const app = await createApp({
  db,
  tables,
  ai: true,
});
```

## Use

```ts
const result = await ai.generateText({
  model: 'meta/Llama-4-Maverick-17B-128E-Instruct-FP8',
  prompt: 'Explain the latest account activity.',
});
```

## Supported Features

The adapter supports:

1. Non-streaming text generation.
2. Streaming text generation.
3. Text prompts.
4. Image URL and base64/data URL prompt parts.
5. Function tool definitions.
6. Assistant tool call messages.
7. Tool result messages.
8. JSON response format mapping.
9. Usage extraction from `usage` and Meta metrics payloads.

## Custom Base URL

```ts
ai: {
  providers: {
    meta: {
      type: 'meta-llama',
      apiKey: Bun.env.META_LLAMA_API_KEY,
      baseURL: Bun.env.META_LLAMA_BASE_URL,
    },
  },
}
```

The default base URL is:

```txt
https://api.llama.com/v1
```
