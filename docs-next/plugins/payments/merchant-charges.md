---
id: zero.payments.merchant-charges
type: reference
audience: [developer, agent, operator]
owner: payments
status: draft
visibility: internal
system: payments
feature: custom amount merchant charges
applies_to: ["Matching 2.6.0 framework and @zero/plugin-payments 0.2.1 archives; identify by commit and hash"]
modes: [trusted server, Stripe test, Stripe live, Square sandbox, Square production]
---

# Custom Amount Merchant Charges

[Payments](./index.md) · [Square](./square.md) · [Operations](./operations.md)

Both providers support one-off payments for a custom amount without a catalog
product, provider customer, Zero user or organization. Use hosted checkout to get
a payment link, or a provider-generated token for a direct charge. The same
`MerchantPayments` interface powers both. No user record is created implicitly.

## Trusted server capability

During `defineZeroPlugin.setup`, obtain `getPayments(zero).charges` from
`@zero/plugin-payments` and retain it only in private server composition.
`getStripePayments` and `getSquarePayments` provide the same `.charges` capability
plus the matching native SDK. Helpers reject request-scoped facades; ordinary
`zero.payments` handlers and `client.payments` never receive this authority.

The plugin exposes **no arbitrary-amount HTTP route**. An application that exposes
sales must authorize its own command, validate the order and amount on the server,
and allow only the intended actions. A provider token does not prove permission to
refund or charge any amount. Do not charge during plugin startup or expose `.native`
or `.charges` wholesale to an unauthenticated request.

In the following trusted business-logic examples, `charges` is the private capability
captured during setup. Generate one operation ID per business action and retain it
until the outcome is settled.

```ts
const checkout = await charges.checkout({
  operationId: 'invoice-2026-001-checkout',
  total: { amount: 2500, currency: 'usd' }, // $25.00, not 25 floating dollars.
  description: 'One-off consultation',
  reference: 'external-invoice-2026-001', // Optional app correlation, not identity.
});
// Deliver checkout.url through the app's authorized workflow.
// A visit to successUrl is not proof of payment.
```

Catalog configuration may be empty (`catalog: {}`). Hosted checkout has no
pre-existing product requirement: Stripe receives inline price data; Square
receives an ad hoc order line. Each provider may create its own internal order or
product data while fulfilling that request. The configured return URL remains
server-controlled.

## Direct tokenized charges

```ts
const payment = await charges.create({
  operationId: 'invoice-2026-001-charge',
  total: { amount: 2500, currency: 'usd' },
  description: 'One-off consultation',
  paymentToken, // Stripe PaymentMethod pm_... or Square Web Payments token.
  // verificationToken, // Square buyer verification, when required.
  reference: 'external-invoice-2026-001',
});
```

`total.amount` must be a positive safe integer in minor currency units and currency
must be a three-letter code. Square requires the location currency; the provider
still enforces its supported currencies and minimum/maximum amounts. Raw PAN/CVV,
customer/tenant selectors and undocumented fields are rejected. Tokenization and
any buyer verification happen through the provider's client SDK, not by sending
raw card details through Zero.

A returned payment is not necessarily successful. Inspect its normalized `status`
and use canonical webhook confirmation for fulfillment. Stripe may require buyer
authentication; `charges.clientAction(payment.id)` is a separate trusted read that
returns `{ provider: 'stripe', clientSecret }` only while confirmation is needed,
or null. An app may send that secret only to the intended payer for the provider
confirmation UI. It is never included in command receipts or reactive views.
Square `clientAction` returns null because tokenization/verification is performed
before sending the direct-charge request. Embedded collection UI is app-owned.

## Shared methods

| Method | Result and authority |
| --- | --- |
| `checkout({ operationId, total, description, reference? })` | Hosted checkout `{ id, url, status }`. No customer/product/user required. |
| `create({ operationId, total, description, paymentToken, verificationToken?, reference? })` | Safe `BillingPayment` acknowledgment; status is explicit. |
| `read(paymentId)` | Canonical payment for the configured trusted merchant/location. |
| `readCheckout(checkoutId)` | Canonical `{ id, status, paymentStatus }`; Square links must have a local merchant binding. |
| `refund({ operationId, paymentId, amount?, reason? })` | Full remaining or specified partial refund in minor units. |
| `clientAction(paymentId)` | Separately retrieved Stripe confirmation secret or null; never browser-wide authority. |
| `operations.read(operationId)` | Merchant command status and safe retry timing, isolated from user command namespaces. |

Refund reasons are `requested_by_customer`, `duplicate` or `fraudulent`.
Trusted merchant reads/refunds can operate on a payment that has no Zero user
association. Refunding an existing subject-bound payment does not reassign it.
Provider-native administration is available separately for advanced products.
Full Stripe refunds use captured funds minus prior refunds, not an uncaptured
authorization balance. Refund/session totals and canonical resource IDs are
checked before a successful acknowledgment is stored.

## Confirmation and durable integration

Configure `onMerchantEvent(event, { signal })` on either provider plugin for
subjectless sales. The callback carries `eventId`, provider, event type,
`providerCreatedAt`, original local `operationId`, optional application `reference`,
and a safe canonical resource summary. Direct charges and hosted checkout are
correlated through durable local intents; webhook metadata alone grants no trust.
Facade-created refunds correlate to their own refund intent once bound. External
refunds of a known payment may correlate to the originating payment intent instead.

Callbacks are durable, **at least once**, bounded by `callbackTimeoutMs`, and receive
an abort signal. Deduplicate downstream side effects by `eventId` and verify the
expected resource, amount/currency and payment state. Use an app-owned durable
Fabric/Torrent workflow for fulfillment rather than an untracked background task.
Merchant events do not mint subscription grants, create users or assign Guardian roles.

Operations retain exact captured totals and outbound parameters across recovery.
A completed receipt replays without charging again. An unknown result must reuse
the same operation ID and input; inspect `charges.operations.read` before deciding
what happened. Never replace a timed-out operation with a new ID just to retry it.
The shared safe replay window is 23 hours; older unresolved operations require
merchant reconciliation. See [operations and recovery](./operations.md).

Credentials and tokenized provider request parameters are private server data.
Pending/unknown direct-charge recovery may retain the token in the private SYSTEM
request ledger. Protect that database and its backups with deployment encryption,
access control and an explicit retention policy. Tokens, verification data, client
secrets, payment URLs and raw provider responses must not enter ordinary logs or
reactive application projections.
