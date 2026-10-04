# AI Conversations

Zero provides a conversation builder so app code can send multi-turn context
without hand-building AI SDK message arrays.

## Builder API

```ts
const ai = getAI();
if (!ai) throw new Error('AI is not enabled.');

const thread = ai.conversation({
  model: 'smart',
  instructions: 'You are a precise assistant for this app.',
});

thread.user('Summarize this customer.');
thread.assistant('The customer has two open invoices.');
thread.user('Now compare that with the latest notes.');

const result = await thread.generate({
  temperature: 0.2,
});
```

## Direct API

```ts
const result = await ai.generateConversation({
  model: 'smart',
  instructions: 'Use short answers.',
  messages: [
    { role: 'user', content: 'First question' },
    { role: 'assistant', content: 'First answer' },
    { role: 'user', content: 'Follow-up question' },
  ],
});
```

`system` remains supported for compatibility, but `instructions` is preferred
for new SDK 7 code. Instruction messages already present in the conversation
are normalized into the same boundary.

## Multimodal User Messages

```ts
await ai.generateConversation({
  model: 'groq/meta-llama/llama-4-scout-17b-16e-instruct',
  messages: [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Describe this image.' },
        { type: 'image', url: 'https://example.com/image.png' },
      ],
    },
  ],
});
```

Zero normalizes image parts into AI SDK file parts with an inferred image media
type. If the selected model cannot consume that URL directly, Zero uses its
mandatory Bun DNS-pinned and redirect-validated prompt downloader. One request
has a shared 64-MiB budget across all assets Zero materializes locally.
See [Remote Image And File Inputs](./ai-generation.md#remote-image-and-file-inputs).

## Streaming

```ts
const stream = ai.streamConversation({
  model: 'fast',
  messages,
  timeout: { totalMs: 30_000, firstChunkMs: 5_000, chunkMs: 10_000 },
  streamRetries: 1,
});

for await (const delta of stream.textStream) {
  process.stdout.write(delta);
}
```

Conversation generation accepts the same structured output, reasoning,
timeout, typed context, tool approval, step-control, telemetry, and lifecycle
options as text generation. See
[AI Generation And Streaming](./ai-generation.md).

For Bedrock, a later turn with no active tools preserves completed historical
tool calls/results/approvals as bounded, labeled text because Bedrock requires
a current tool configuration for native tool blocks. Nothing is re-executed,
no tool definition is injected, and active-tool turns retain their native
representation. Unsafe or oversized history fails closed with
`AI_REQUEST_INVALID` rather than being silently removed. See
[Bedrock inactive-tool history](./ai-generation.md#bedrock-inactive-tool-history)
for the exact 1-MiB and content boundary.

## Persistence

Zero does not persist chat threads. Apps should store durable
conversation history in normal ReactiveDB tables when needed. A dedicated
thread store can be added later as a separate module.

## Transient Session Helper

For server-side workflows where you want to send a new user input while
automatically passing previous user and assistant turns back into the model, use
`ai.session()`.

This is an in-memory helper only. It is not a chat store, route, thread system,
or persistence layer.

```ts
const session = ai.session({
  model: 'smart',
  instructions: 'You are a precise assistant for this workflow.',
  maxMessages: 12,
});

const first = await session.send('Summarize this customer.');
const second = await session.send('Now compare that with the latest invoice.');

return second.text;
```

`send()` appends the user message, calls the selected model with all retained
messages, then appends the assistant text response. Use `session.messages()` if
you need to inspect or persist the current history yourself.

## Related Documentation

- [AI](./ai.md)
- [AI Generation And Streaming](./ai-generation.md)
- [AI Hosted Files And Video](./ai-files-video.md)
- [AI Tools](./ai-tools.md)
- [AI Agents](./ai-agents.md)
