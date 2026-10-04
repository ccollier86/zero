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
  model: 'groq/meta-llama/llama-4-scout-17b-16e-instruct',
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

## SDK 7 Tool Controls

Generation requests can bind typed runtime/tool context, limit the active tool
set, stabilize tool ordering, prepare the next step, stop a bounded loop, and
require approval:

```ts
const result = await ai.generateConversation({
  model: 'smart',
  messages,
  tools,
  runtimeContext: {
    tenantId: authority.tenantId,
    actorId: authority.userId,
  },
  activeTools: ['getCustomer'],
  toolOrder: ['getCustomer'],
  timeout: {
    totalMs: 30_000,
    toolMs: 5_000,
    tools: { getCustomerMs: 2_000 },
  },
  stopWhen: ({ steps }) => steps.length >= 6,
});
```

`aiTool()` remains the small backward-compatible helper for JSON-schema input
and a server-side function. Use `defineAIAgentTool()` when a multi-step agent
needs schema-validated per-tool context, typed execution services, output
schemas, approval policy, or run budgets. See [AI Agents](./ai-agents.md).

## Tool Approval

Direct generation accepts the SDK 7 approval configuration:

```ts
const result = await ai.generateConversation({
  model: 'smart',
  messages,
  tools,
  toolApproval: {
    issueRefund: {
      type: 'user-approval',
      reason: 'A human must approve refunds.',
    },
  },
  toolApprovalSecret: Bun.env.ZERO_AI_APPROVAL_SECRET,
});
```

Keep the HMAC secret in trusted server configuration and use at least 32 bytes
of high-entropy material. Signing binds an approval response to the issued tool
call; it does not authorize the actor or make the external effect idempotent.
The app must present the returned approval request, return the signed response
through the SDK message flow, and recheck live Guardian/domain authority before
executing the effect.

## Torrent Workflows And Jobs

Torrent activities and scheduled jobs can use the same server-side AI service
directly, or use `createAIWorkflowHandler()` for common one-activity calls.
Register the examples below inside
`AppConfig.workflows.register(registry)` so registration finishes before
workflow recovery begins.

Direct use:

```ts
workflows: {
  register(registry, { ai }) {
    if (!ai) throw new Error('AI is not enabled.');
    registry.registerActivity({
      name: 'ai.summarize-customer',
      version: '1',
      handler: async (ctx) => {
        ctx.signal?.throwIfAborted();
        const input = ctx.workflowInput as { customerId: string };

        const result = await ai.generateConversation({
          model: 'smart',
          messages: [
            { role: 'user', content: `Summarize ${input.customerId}` },
          ],
          tools,
          abortSignal: ctx.signal,
          metadata: { workflowIdempotencyKey: ctx.idempotencyKey },
        });
        return { text: result.text };
      },
    });
  },
}
```

Helper use:

```ts
import { createAIWorkflowHandler } from '@zero/framework/server';

registry.registerActivity({
  name: 'ai.summarize-customer',
  handler: createAIWorkflowHandler<{ customerId: string }>({
    service: ai,
    model: 'smart',
    system: 'Summarize customer records for internal staff.',
    prompt: (ctx) => `Summarize customer ${ctx.input.customerId}`,
    tools,
  }),
});
```

In the helper example, `ai` is the same app-local service from the surrounding
`workflows.register(registry, { ai })` callback.

The helper returns generated text by default. Set `output: 'result'` when a
workflow step needs the full AI SDK result, such as usage metadata. It combines
the workflow cancellation signal with a configured AI abort signal and calls
`ctx.assertCurrentAuthority()` immediately before the provider request.
Workflow handlers are recovered with at-least-once semantics; pass
`ctx.idempotencyKey` to separate external effects that must be deduplicated.
See [Torrent: Durable Workflows](./workflows.md) for activity schemas/versioning, graph
authoring, retry/deadline/recovery, memory, and authorization contracts.

Use [Durable AI Agents With Torrent](./ai-durable-agents.md) when the complete
bounded model/tool loop—not merely one AI activity—must preserve private state,
wait for approval, recover after restart, and revalidate live authority.

## Tool Failures

Tool execution failures are emitted through Zero observability as:

```txt
ai.tool.failed
```

Framework-owned event metadata does not include tool arguments or results. The
original thrown error remains in the app-local event error channel, so app
errors and external sink serializers must not embed sensitive tool data.

SDK 7 model-step and tool-execution callbacks are composed with Zero's
content-free lifecycle events. Framework metadata may include call, step, and
tool identifiers and duration, but never the tool input/output, runtime/tool
context, prompt, or generated content. See
[AI Generation And Streaming](./ai-generation.md#lifecycle-callbacks-and-telemetry).

## Security

Do not expose unrestricted tools to AI calls. Treat every tool as a server-side
capability boundary:

1. Check the current user or job context before reading private data.
2. Validate tool input with a schema.
3. Keep destructive tools explicit and narrow.
4. Avoid logging raw tool arguments unless the app opts into that separately.

## Related Documentation

- [AI](./ai.md)
- [AI Generation And Streaming](./ai-generation.md)
- [AI Agents](./ai-agents.md)
- [Durable AI Agents With Torrent](./ai-durable-agents.md)
- [Torrent: Durable Workflows](./workflows.md)
- [Observability](./observability.md)
