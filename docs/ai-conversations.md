# AI Conversations

Zero provides a conversation builder so app code can send multi-turn context
without hand-building AI SDK message arrays.

## Builder API

```ts
const ai = getAI();
if (!ai) throw new Error('AI is not enabled.');

const thread = ai.conversation({
  model: 'smart',
  system: 'You are a precise assistant for this app.',
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
  system: 'Use short answers.',
  messages: [
    { role: 'user', content: 'First question' },
    { role: 'assistant', content: 'First answer' },
    { role: 'user', content: 'Follow-up question' },
  ],
});
```

## Multimodal User Messages

```ts
await ai.generateConversation({
  model: 'meta/Llama-4-Maverick-17B-128E-Instruct-FP8',
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
type.

## Streaming

```ts
const stream = ai.streamConversation({
  model: 'fast',
  messages,
});

for await (const delta of stream.textStream) {
  process.stdout.write(delta);
}
```

## Persistence

The first AI slice does not persist chat threads. Apps should store durable
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
  system: 'You are a precise assistant for this workflow.',
  maxMessages: 12,
});

const first = await session.send('Summarize this customer.');
const second = await session.send('Now compare that with the latest invoice.');

return second.text;
```

`send()` appends the user message, calls the selected model with all retained
messages, then appends the assistant text response. Use `session.messages()` if
you need to inspect or persist the current history yourself.
