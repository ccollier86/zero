---
id: zero.payments.webhooks
type: architecture
audience: [developer, agent, operator]
owner: payments
status: draft
visibility: internal
system: payments
feature: webhooks and reactive state
applies_to: ["Matching 2.6.0 framework and @zero/plugin-payments 0.2.1 archives; identify by commit and hash"]
modes: [Stripe v1 snapshot events, Square events, ReactiveDB system plane]
---

# Payment Webhooks And Reactive State

[Payments](./index.md) · [Operations](./operations.md)

The Stripe webhook verifies the exact raw UTF-8 body with the official SDK,
including its timestamp/signature tolerance. Square verifies HMAC over its exact
configured public notification URL plus body; see [Square setup and ownership](./square.md).
Each Elysia route explicitly uses
`parse: 'none'`. Bodies are bounded to 512 KiB, including chunked requests.
Do not insert a JSON/body parser ahead of this route.

## Stripe Endpoint Setup

Create a Stripe **v1 snapshot** webhook endpoint using API version
**2026-09-30.endive** and the configured `webhookPath`. Keep test and live
endpoints/secrets separate. Subscribe to the billing families you use:

- `checkout.session.*` for completion, asynchronous payment outcomes and expiry.
- `customer.created`, `customer.updated`, `customer.deleted`.
- `customer.subscription.*` for subscription changes and lifecycle.
- `invoice.*`, `payment_intent.*`, `charge.*`, `refund.*` for financial state.

Thin/v2 events are not accepted by this snapshot handler. Stripe account/context,
mode and API-version mismatches are rejected. Supported events are stored before
HTTP acknowledgement; a persistence failure returns 503 so Stripe can retry.
Unsupported but valid snapshot events return `supported: false` without running
application fulfillment. [Stripe's webhook guide](https://docs.stripe.com/webhooks)
explains raw-body verification, duplicate delivery and event-ordering behavior.

## Processing And Recovery

```text
raw body → signature verification → durable inbox → HTTP acknowledgement
                                       ↓
                         fenced worker claim and customer binding
                                       ↓
                        current Stripe reads outside SQLite transactions
                                       ↓
                     reactive projection and notification outbox commit
                                       ↓
                          application integration callbacks
```

The event ID deduplicates deliveries. Changing only Stripe's `pending_webhooks`
delivery count is accepted; reuse with different immutable signed content is a
conflict. Claims, command receipts and customer locks use durable compare-and-swap
fences; a stale worker cannot publish over a newer resource owner. Each customer
is reconciled from Stripe's current resources, not from an event's age or body.
Reconciliation exhausts up to 1,000 subscriptions, including paginated items
(up to 1,000 per subscription and 10,000 aggregate), and fails instead of granting
from a silently truncated set. History previews retain the latest 20 payments
and invoices; use paginated readers for older history.

Provider calls never hold an SQLite transaction. Only the system database is
involved in a billing commit; application/Fabric databases are not assumed to
commit atomically with it. After completion, raw inbox payloads are cleared while
their event digest/identity remain available for deduplication. Retrying or
quarantined jobs retain their private payload for recovery.

An event for an unbound customer retries/quarantines; it cannot choose a Zero
subject from metadata. Explicitly adopt an existing customer through the trusted
API, then replay the event. These are Stripe's customer-bound event semantics;
Square additionally follows its admitted checkout/order lineage and ignores
unrelated merchant resources. Events without a customer do not establish a binding.
Locally admitted [merchant charges](./merchant-charges.md) use a separate intent
and `onMerchantEvent` callback, without inventing a subject/customer binding.

## Entitlements And Freshness

Grants come from the server-owned offer mapping and canonical subscriptions.
The following trial and zero-due policy describes Stripe; Square requires the
latest PAID invoice and uses its actual location/subscription calendar boundary.
Active subscriptions require paid or open zero-due invoice evidence; valid trials
use their explicit expiry. Past-due/unpaid/canceled subscriptions do not receive
an implicit grace policy. Expired item periods do not grant features.

The projection records its policy version and private per-source grant expiry.
Expired periods/trials lose their own grants without removing independent paid
subscriptions' still-valid grants. This evidence is not sent to browsers or
application callbacks. A changed policy or projection older than
`maxProjectionAgeMs` withholds all grants. The worker schedules refreshes at the
next grant expiry or halfway through the configured
freshness window so an otherwise quiet monthly subscription does not simply
lose access after five minutes. An unavailable provider can still cause stale
grants to be withheld; applications may design an explicit grace policy later.

Billing never assigns Guardian roles, changes permissions, revokes login or
blocks account recovery. Authentication and billing feature access remain separate.

## Application Callbacks

`onChange({ eventId, subject, snapshot }, { signal })` is a durable projection
notification committed atomically with its view. `onEvent(event, { signal })`
receives a verified provider event ID and a freshly retrieved, allowlisted
resource summary for Checkout, payments, invoices, subscriptions, charges or
refunds. The original event body is not a payment-success proof.

The subjectless `onMerchantEvent` callback receives the same safe confirmation
information plus local merchant operation correlation; see [merchant charges](./merchant-charges.md).
All callbacks are **at least once**. Deduplicate side effects with `eventId`.
Projection consumers also fence by subject/revision; an older callback must not
overwrite a newer application projection. Callbacks must honor their abort signal
and finish within `callbackTimeoutMs`. Timeouts remain durable retry work, not
successful deliveries.

For Fabric/Torrent integration, enqueue a normal app-owned durable workflow using
the callback's stable event ID and server-owned subject mapping. Keep your workflow
definition, resource realm and application authorization explicit. Do not create
an untracked background task or grant a tenant role because an invoice was paid.
Order fulfillment is application policy: for example, act only on the canonical
Checkout `paymentStatus: 'paid'` and verify the matching order/offer and amount.

## Browser Updates

`client.payments.watch({ signal })` consumes an authenticated SSE revision stream.
It emits `{ revision, version }` initially and on later changes/heartbeats; fetch
`snapshot()` when `version` changes (fall back to `revision` for older transports).
The version also changes when a time-limited grant expires without a database
write. The server uses ReactiveDB's committed change feed,
including the managed external dispatcher, rather than polling the provider per UI.
Slow readers coalesce to the newest revision using a pull-based, bounded stream;
they do not build an unbounded event queue. Cancellation removes its database
listener even while the consumer is paused. A heartbeat revalidates Guardian
authority at most every 15 seconds; each event is also revalidated before delivery.

The standard client transport rejects in-flight results after an auth/scope
boundary changes and aborts its old stream. No billing cache survives a switch.
Unmount the view with an abort signal and reauthorize/reconnect after a stream
error; the iterator does not silently retry forever with stale authority.
