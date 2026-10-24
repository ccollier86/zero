---
id: zero.payments.api
type: reference
audience: [developer, agent]
owner: payments
status: draft
visibility: internal
system: payments
feature: api
applies_to: ["feature/stripe-payments-foundation with @zero/plugin-payments 0.1.0"]
modes: [server, browser, trusted setup]
---

# Payments API Facade

[Payments](./index.md) · [Configuration](./configuration.md)

Request handlers receive `zero.payments: ScopedPayments | null`. Trusted setup
receives the backend owner; it must use `forAuthority` for request operations.
An app without the plugin has a null server service. `client.payments` is a
provider-free transport and does not install or enable server payments.

```ts
import { defineEndpoint } from '@zero/framework/server';

export default defineEndpoint({
  method: 'POST', path: '/app/start-pro-checkout', auth: 'user',
  handler: ({ zero }) => {
    if (!zero.payments) throw new Error('Payments are not configured');
    return zero.payments.checkout.create({
      operationId: crypto.randomUUID(), offer: 'pro', quantity: 1,
    });
  },
});
```

For retry-safe application commands, create the operation ID once and retain it
across failures. The example creates a new intent on each invocation; do not
blindly invoke it again after a lost response. The browser facade accepts a
stable operation ID directly:

```ts
import { getClient } from '@zero/framework/react';

const client = getClient();
if (!client) throw new Error('Zero client is not initialized');
const operationId = crypto.randomUUID(); // Retain until this checkout intent settles.
const session = await client.payments.checkout.create({ operationId, offer: 'pro' });
if (session.url) window.location.assign(session.url);
```

## Scoped Methods

| Group | Methods and semantics |
| --- | --- |
| Root | `status()`, `catalog()`, `snapshot()`, `reconcile()`, `watch({ signal })` |
| Customers | `customers.ensure({ operationId })`; one durable customer binding per subject. |
| Operations | `operations.read(operationId)` returns current-subject command status/error/retry timing, without merchant parameters or portal capabilities. |
| Checkout | `checkout.create({ operationId, offer, quantity? })`; `checkout.read(sessionId)` checks ownership. |
| Portal | `portal.create({ operationId })`; return URL is fixed by server configuration. |
| Subscriptions | `list()`, `preview(input)`, `change(input)`, `cancel(input)`, `resume(input)` |
| Invoices | `list({ limit?, after? })`, `read(invoiceId)`, `document(invoiceId)` |
| Payments | `payments.list({ limit?, after? })` |
| Refunds | `refunds.create({ operationId, paymentId, amount?, reason? })`; `refunds.list({ paymentId, limit?, after? })` |
| Entitlements | `entitlements.read()` returns current bounded grants, never Guardian roles. |

Server `status()` is synchronous; browser `status()` is an HTTP request. The
remaining server/browser method contracts match. Import shared types from
`@zero/framework/payments`; use `@zero/framework/payments/client` or
`@zero/plugin-payments/client` for a standalone browser transport.

`snapshot()` and `subscriptions.list()` read the durable local projection, not
Stripe on every render. It includes revision, subject, environment, policy version,
freshness, a content `version`, safe customer details, all reconciled subscriptions and the latest 20
invoices/payments. The paginated history methods read Stripe and return
`{ items, next? }`, with a default limit of 20 and maximum of 100. Cursors and
retrieved resource IDs are checked against the same customer binding.

Money uses integer minor currency units and explicit currency, never floats
pretending to be dollars. Raw payment client secrets, card data, SDK responses
and webhook payloads are not projected. Invoice document URLs are returned only
by the separately authorized `invoices.document` reader and are not stored in
the reactive billing view.

Command inputs are copied before asynchronous admission. Changing the caller's
object cannot change the reserved payment intent. `operations.read` distinguishes
`retryable` (known not to have executed), `unknown` (provider acceptance is not
settled), `rejected`, `pending` and `complete`. Retryable errors include
`retryable: true` in HTTP responses; retain the same operation ID and input.
Read-only provider failures return `PAYMENTS_READ_UNAVAILABLE`, not an unknown
financial outcome.

## Subscription Changes

Change/preview input contains `subscriptionId`, `offer`, optional `quantity`,
explicit `proration` (`create_prorations`, `always_invoice`, `none`) and optional
`prorationDate`. Preview returns `total`, `amountDue` and `prorationDate`; reuse
that timestamp in the corresponding change. With `proration: 'none'`, no proration
timestamp is sent to Stripe. Change additionally requires
`operationId` and `paymentBehavior`: `error_if_incomplete` or
`pending_if_incomplete`. Payment success is not inferred from an HTTP 200 when
Stripe has left an update pending.

Self-service changes support a single-item subscription. Bundles, schedules,
metered item transitions and other complex arrangements require an explicit
trusted workflow rather than silently replacing unrelated items.

Cancellation input adds `timing: 'period-end' | 'immediate'`. Immediate cancellation
does not silently prorate or issue an invoice; a refund is a separate authorized
operation. Resume removes a scheduled cancellation on an active/trialing
subscription; it does not resurrect a fully canceled subscription.

Refund reasons are `requested_by_customer`, `duplicate` or `fraudulent`. Amount
must be a positive safe integer within the remaining payment balance. Stripe
remains the final atomic authority when concurrent refunds compete.

## HTTP Routes

All paths below are relative to `basePath` and require a Guardian user session.
Mutation bodies use exactly the facade input; unexpected fields are rejected.

| Method | Path |
| --- | --- |
| GET | `/status`, `/catalog`, `/snapshot`, `/subscriptions`, `/entitlements` |
| POST | `/customers/ensure`, `/checkout`, `/portal` |
| GET | `/checkout/:id` |
| GET | `/operations/:id` |
| POST | `/subscriptions/preview`, `/subscriptions/change`, `/subscriptions/cancel`, `/subscriptions/resume` |
| GET | `/invoices`, `/invoices/:id`, `/invoices/:id/document`, `/payments` |
| POST | `/refunds`, `/reconcile` |
| GET | `/refunds?paymentId=pi_...`, `/events` |

Billing JSON and event responses use `Cache-Control: no-store`. The webhook
route is separate and accepts only a valid Stripe signature over the exact body.
No route accepts arbitrary Stripe method names, API keys, account selectors,
return URLs or card/price amounts.

## Trusted Merchant Integration

`getStripePayments(zero)` is for `defineZeroPlugin.setup` or other explicitly
trusted server composition. Its `native` property exposes the full typed
official SDK, including products outside the normalized facade. Application code
owns authorization, idempotency, validation and bookkeeping for those calls.

The owner also provides `adoptCustomer(subject, customerId)` for an explicit
migration, `reconcileCustomer(customerId)`, `jobs.list({ status?, limit?, after? })`,
`jobs.retry(jobId)`, `store.pending()` and `drain()`. Job inspection defaults to
unfinished work, uses keyset pagination (20 by default, at most 100), and returns
IDs, kind, status, attempt count, due time and a safe error code, never payloads.
`jobs.retry` returns whether a retryable/quarantined job was requeued and wakes
the worker. These are trusted operator APIs, not self-service browser methods.
Adoption verifies the merchant/environment and refuses reassignment
or sharing a customer between subjects. Never feed a browser-supplied subject
into this trusted API. Never auto-adopt by matching email or webhook metadata.

`onEvent` and `onChange` are the preferred integration seams for application
workflows. A framework-provided manager UI, invoice authoring API or Connect
dashboard is not implied by the availability of the underlying Stripe SDK.
