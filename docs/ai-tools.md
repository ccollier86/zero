# AI Tools

AI tools let model calls execute app-owned server functions.

Tools are server-side only. They are not routes and should enforce any domain
authorization required by the app.

## Define Tools

```ts
import { t } from 'elysia';
import { aiTool, defineAITools, getAI } from '@zero/framework/server';

const tools = defineAITools({
  getCustomer: aiTool({
    description: 'Load one customer by id.',
    input: t.Object({
      customerId: t.String(),
    }),
    execute: async ({ customerId }) => {
      return customers.get(customerId);
    },
  }),
});

const ai = getAI();
if (!ai) throw new Error('AI is not enabled.');

const result = await ai.generateConversation({
  model: 'smart',
  messages: [{ role: 'user', content: 'What is customer cust_123 doing?' }],
  tools,
});
```

The `input` schema is JSON Schema-compatible. Elysia `t.*` schemas work because
they are JSON-schema shaped.

## Provider And Model Selection

Tools are attached to an AI request; they do not choose the provider. The
request's `model` selects the provider and model:

```ts
await ai.generateConversation({
  model: 'openai/gpt-4o',
  messages,
  tools,
});

await ai.generateConversation({
  model: 'meta/Llama-4-Maverick-17B-128E-Instruct-FP8',
  messages,
  tools,
});
```

Aliases work the same way:

```ts
await ai.generateConversation({
  model: 'smart',
  messages,
  tools,
});
```

Zero validates provider capability before the provider call. If the selected
provider is active but does not advertise tool support, the call fails before
sending the request.

## Workflows And Jobs

Workflow step handlers and scheduled jobs can use the same server-side AI
service directly, or use `createAIWorkflowHandler()` for common one-step AI
handlers.

Direct use:

```ts
import { getAI } from '@zero/framework/server';

registry.registerHandler('summarizeCustomer', async (ctx) => {
  const ai = getAI();
  if (!ai) throw new Error('AI is not enabled.');

  return ai.generateConversation({
    model: 'smart',
    messages: [
      { role: 'user', content: `Summarize ${ctx.workflowInput.customerId}` },
    ],
    tools,
  });
});
```

Helper use:

```ts
import { createAIWorkflowHandler } from '@zero/framework/server';

registry.registerHandler('summarizeCustomer', createAIWorkflowHandler({
  model: 'smart',
  system: 'Summarize customer records for internal staff.',
  prompt: (ctx) => `Summarize customer ${ctx.input.customerId}`,
  tools,
}));
```

The helper returns generated text by default. Set `output: 'result'` when a
workflow step needs the full AI SDK result, such as usage metadata.

## Tool Failures

Tool execution failures are emitted through Zero observability as:

```txt
ai.tool.failed
```

The event does not include raw tool arguments by default.

## Security

Do not expose unrestricted tools to AI calls. Treat every tool as a server-side
capability boundary:

1. Check the current user or job context before reading private data.
2. Validate tool input with a schema.
3. Keep destructive tools explicit and narrow.
4. Avoid logging raw tool arguments unless the app opts into that separately.
