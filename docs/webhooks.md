# Webhooks Plan

Zero should eventually provide a first-class webhook system, but it should be
built in layers. Incoming webhook verification is a smaller, useful helper.
Durable outgoing delivery is a larger platform subsystem because it needs
persistence, retries, replay, signing, admin controls, and workflow/table-event
integration.

> **Status: proposed design, not current API.** Every code block in this page is
> non-runnable pseudocode for a future webhook package. Zero does not currently
> export `verifyWebhook` or provide `zero.webhooks`. Current workflows are
> registered through `AppConfig.workflows.register`, and current browser calls
> use `client.api.workflows`; see [Durable Workflows](./workflows.md).

## Scope

The webhook system has two related but separate jobs:

| Area | Purpose | Relative size |
| --- | --- | --- |
| Inbound webhooks | Verify third-party requests and route accepted events into app code or workflows. | Small to medium |
| Outbound webhooks | Deliver Zero/app events to external systems with signing, retries, logs, replay, and dead-letter handling. | Medium to large |

Keep these separate internally. Apps may use only inbound verification, only
outbound delivery, or both.

## Inbound Webhooks

Inbound support should make it easy to accept provider webhooks safely without
rewriting signature verification for every app.

Planned helpers:

```ts
import { verifyWebhook } from '@zero/framework/server';

export async function POST({ request, zero }) {
  const event = await verifyWebhook(request, {
    provider: 'stripe',
    secret: Bun.env.STRIPE_WEBHOOK_SECRET,
    toleranceMs: 5 * 60 * 1000,
  });

  await zero.workflows.start('payment-event', {
    provider: 'stripe',
    event,
  });

  return Response.json({ received: true });
}
```

Provider modes:

| Provider | Behavior |
| --- | --- |
| `generic-hmac` | Verify timestamp + body HMAC using Zero's generic scheme. |
| `stripe` | Verify Stripe-style signatures against the raw body. |
| `github` | Verify GitHub SHA-256 signature headers. |
| `slack` | Verify Slack timestamp/signature and URL challenge flow. |
| `custom` | Caller supplies a verification function. |

Important requirements:

- Preserve raw request body for signature verification.
- Use timing-safe comparison.
- Enforce optional timestamp tolerance to reduce replay risk.
- Let apps write provider-specific routing in app-owned routes.
- Optionally record accepted inbound event IDs for idempotency/deduplication.
- Never log signing secrets or raw sensitive payloads through observability.

## Outbound Webhooks

Outbound webhooks should be durable deliveries, not a bare `fetch()` wrapper.
The platform should be able to register endpoints, emit events, retry failures,
sign payloads, and replay deliveries.

Planned service shape:

```ts
const webhooks = zero.webhooks;

const endpoint = await webhooks.endpoints.create({
  name: 'notify-slack',
  url: 'https://hooks.slack.com/services/...',
  events: ['tasks.created', 'workflow.completed'],
  signing: { algorithm: 'hmac-sha256' },
  retries: { maxAttempts: 5, backoffMs: 1000 },
  timeoutMs: 10000,
});

await webhooks.emit('tasks.created', {
  taskId: 'task_123',
  title: 'Follow up',
});
```

One-off sends should also be available for app code and workflow steps:

```ts
await zero.webhooks.send({
  url: 'https://example.com/hook',
  event: 'intake.submitted',
  payload: { intakeId },
  signingSecret: Bun.env.PARTNER_WEBHOOK_SECRET,
});
```

The one-off path is still signed and observable, but it does not require a
stored endpoint unless the app wants retries/replay.

## Event Sources

Zero should support explicit app events first, then add automatic sources.

| Source | Event examples | Notes |
| --- | --- | --- |
| App code | `webhooks.emit('intake.submitted', payload)` | Lowest risk, easiest to reason about. |
| Workflows | `workflow.started`, `workflow.completed`, `workflow.failed`, app-defined step events | Should be available as a workflow step and as lifecycle triggers. |
| Table changes | `{table}.created`, `{table}.updated`, `{table}.deleted` | Useful, but needs policy/filter controls so sensitive tables are not leaked. |
| Auth | `auth.register`, `auth.login`, `auth.logout`, `auth.password_reset` | Should be opt-in with redaction. |
| Storage | `storage.object.created`, `storage.object.deleted` | Should avoid public URLs unless the app opts in. |
| Custom platform events | App-defined namespaced event names. | Do not overload observability logs for business webhooks. |

Business webhook events should be distinct from observability events. They can
emit observability records, but the payload contracts and privacy rules are
different.

## Workflow Integration

Workflows should be able to send and receive webhook events. The examples in
this section describe a future bridge. In particular, the current
`StepContext` does not contain `zero`; a real implementation must inject or
close over a supported webhook service without changing the workflow context
implicitly.

Outbound workflow activity:

```ts
import type { WorkflowRegistry } from '@zero/framework/workflows';

interface AppWebhookSender {
  send(
    message: { endpoint: string; event: string; payload: unknown },
    options: { idempotencyKey?: string; signal?: AbortSignal },
  ): Promise<unknown>;
}

function registerWebhookWorkflowActivity(
  registry: WorkflowRegistry,
  webhooks: AppWebhookSender,
): void {
  registry.registerActivity({
    name: 'webhook.send',
    version: '1',
    handler: async (ctx) => webhooks.send({
      endpoint: 'partner-intake',
      event: 'intake.submitted',
      payload: { workflowInput: ctx.workflowInput, input: ctx.input },
    }, {
      idempotencyKey: ctx.idempotencyKey,
      signal: ctx.signal,
    }),
  });
}
```

Inbound webhook route to workflow:

```ts
const event = await verifyWebhook(request, {
  provider: 'github',
  secret: Bun.env.GITHUB_WEBHOOK_SECRET,
});

await zero.workflows.start('github-event', event);
```

Workflow wait events should also work:

```ts
await zero.workflows.sendEvent(instanceId, 'partner.approved', event);
```

## Signing

Zero's default outbound signing should be generic and easy for receiving apps
to verify.

Recommended headers:

| Header | Value |
| --- | --- |
| `Zero-Webhook-Id` | Stable event id. |
| `Zero-Delivery-Id` | Delivery attempt group id. |
| `Zero-Event` | Event name. |
| `Zero-Timestamp` | Unix milliseconds. |
| `Zero-Signature` | HMAC-SHA256 over timestamp + event id + body. |

Inbound generic verification should use the same scheme. Provider-specific
verification should follow the provider's documented signature format.

Signing secrets should be generated by Zero for stored endpoints unless the app
provides one. Secrets should be returned once at creation or rotation time,
then only stored through the platform's secret/config boundary. If Zero does
not yet have encrypted secret storage when this ships, docs must be clear that
apps should provide secrets through environment/config instead of persisting raw
secrets in normal database rows.

## Persistence

Durable outbound delivery needs platform tables.

Planned tables:

| Table | Purpose |
| --- | --- |
| `_zero_webhook_endpoints` | Stored destination configuration, event filters, status, signing metadata, retry policy. |
| `_zero_webhook_events` | App/platform event envelope and payload snapshot. |
| `_zero_webhook_deliveries` | Endpoint-specific delivery status, next retry, attempt count, final result. |
| `_zero_webhook_attempts` | Per-attempt HTTP status, duration, response excerpt, error, timestamp. |
| `_zero_webhook_inbound_events` | Optional inbound dedupe/audit store by provider event id. |

Delivery rows should be safe to show in an admin UI. Headers, payload excerpts,
and response bodies need redaction and size limits.

## Delivery Semantics

Default delivery policy:

- At-least-once delivery.
- Stable event ID and delivery ID for idempotency.
- Exponential backoff with max attempts.
- Timeout per attempt.
- Dead-letter status after attempts are exhausted.
- Manual replay from a previous event or failed delivery.
- Optional endpoint pause/resume.
- Optional test delivery.

Receiving systems must treat webhook delivery as at-least-once and dedupe with
`Zero-Webhook-Id` or their own resource IDs.

## Admin And Developer APIs

Backend API surface:

```ts
zero.webhooks.endpoints.create(config);
zero.webhooks.endpoints.update(endpointId, patch);
zero.webhooks.endpoints.pause(endpointId);
zero.webhooks.endpoints.resume(endpointId);
zero.webhooks.endpoints.rotateSecret(endpointId);
zero.webhooks.emit(eventName, payload, options);
zero.webhooks.send(options);
zero.webhooks.deliveries.list(filter);
zero.webhooks.deliveries.replay(deliveryId);
zero.webhooks.verify(request, options);
```

Frontend/admin components can come later:

- `WebhookEndpointList`
- `WebhookEndpointEditor`
- `WebhookDeliveryLog`
- `WebhookDeliveryDetail`
- `WebhookTestPanel`

## Phases

1. **Inbound verification helpers**
   - Add raw-body-safe `verifyWebhook()`.
   - Support generic HMAC first.
   - Add Stripe/GitHub/Slack helpers after the generic verifier is tested.
   - Document file-route examples that start workflows or call app services.

2. **One-off outbound sender**
   - Add `zero.webhooks.send()` with optional signing secret and headers.
   - Emit observability events for success/failure.
   - Provide workflow step examples.

3. **Durable outbound delivery**
   - Add endpoint/event/delivery/attempt tables.
   - Add scheduler-backed retry worker.
   - Add `webhooks.emit()` and endpoint event matching.
   - Add pause/resume/replay/test APIs.

4. **Event source integrations**
   - Add explicit workflow lifecycle events.
   - Add opt-in table mutation hooks with table/column redaction policy.
   - Add auth/storage event emitters where safe.

5. **Admin UI**
   - Add endpoint management and delivery log organisms.
   - Add retry/replay/test controls.
   - Add secret rotation flow that only shows the new secret once.

## Near-Term Recommendation

Do not build the full durable outbound system before the current platform
stabilization work is done. It is worthwhile, but it is a real subsystem.

The best first slice is inbound verification plus a one-off signed sender. That
would unlock common app needs and workflow integrations without committing to a
full delivery queue/admin UI immediately. The durable delivery engine can come
after the form, workflow, and package-mode APIs are more settled.
