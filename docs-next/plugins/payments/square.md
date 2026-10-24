---
id: zero.payments.square
type: reference
audience: [developer, agent, operator]
owner: payments
status: draft
visibility: internal
system: payments
feature: Square provider
applies_to: ["Matching 2.6.0 framework and @zero/plugin-payments 0.2.0 archives; identify by commit and hash"]
modes: [single tenant, multi tenant, Square sandbox, Square production]
---

# Square Payments

[Payments](./index.md) · [API facade](./api.md) · [Merchant charges](./merchant-charges.md)

Square implements the existing `zero.payments` and `client.payments` methods,
including Guardian subjects, durable operation receipts, verified webhooks,
ReactiveDB projections, live SSE revisions and bounded entitlement expiry.
Choose `squarePayments` instead of `stripePayments` during trusted server setup;
request handlers do not select a provider or merchant. The plugin pins official
`square` SDK 46.0.0 and Square API **2026-09-16**.

## Configuration

```ts
// server/plugins/payments.ts
import { squarePayments } from '@zero/plugin-payments/square';

export default squarePayments({
  mode: 'test', // Square sandbox; use live explicitly for production.
  connectionId: 'my-app-square-sandbox',
  merchantId: Bun.env.SQUARE_MERCHANT_ID!,
  locationId: Bun.env.SQUARE_LOCATION_ID!,
  // Optional overrides for SQUARE_ACCESS_TOKEN / SQUARE_WEBHOOK_SIGNATURE_KEY.
  accessToken: Bun.env.SQUARE_ACCESS_TOKEN,
  webhookSignatureKeys: [Bun.env.SQUARE_WEBHOOK_SIGNATURE_KEY!],
  webhookNotificationUrl: 'https://app.example.com/api/webhooks/square',
  policyVersion: 'billing-v1',
  catalog: {
    pro: { label: 'Pro', kind: 'subscription',
      planVariationId: Bun.env.SQUARE_PRO_PLAN_VARIATION_ID!,
      features: { advancedSearch: true, maximumProjects: 100 } },
    credits: { label: 'Credit pack', kind: 'payment',
      itemVariationId: Bun.env.SQUARE_CREDITS_VARIATION_ID! },
  },
  allowedOrigins: ['https://app.example.com'],
  successUrl: 'https://app.example.com/billing/return',
  // Optional app-owned authenticated billing page, not a Square-hosted portal.
  // portalUrl: 'https://app.example.com/billing',
});
```

`squarePayments` and `getSquarePayments` are also available from the package root.
Use `catalog: {}` for merchant-only [custom-amount sales](./merchant-charges.md).
No customer, catalog product or Zero account is needed by that trusted API.

The [shared durability and Guardian configuration](./configuration.md) applies.
Use the existing file-backed SYSTEM database with `synchronous: 'FULL'` or EXTRA;
do not relocate or recreate an application's databases. Test/live maps to the
SDK's sandbox/production origin. Zero verifies that the token can read the exact
merchant and active location, then uses the location's currency and IANA time zone.
Connection identity includes provider, mode, merchant and location. Never reuse
an existing Stripe connection ID for Square or switch one ledger's merchant.

Square-specific options are `merchantId`, `locationId`, `accessToken`, one to four
`webhookSignatureKeys`, exact `webhookNotificationUrl`, and optional `portalUrl`.
The default webhook path is `/api/webhooks/square`; the authenticated API path
remains `/api/_zero/payments`. Timeout defaults to 30 seconds, bounds 100–60,000ms;
Square SDK retries are disabled. A shared deadline also bounds a scoped request's
provider work. `fetch` is an explicitly trusted test/proxy transport override.
Common policies, callbacks, freshness bounds and return-origin validation retain
the Stripe configuration's names and behavior.

For the full configured surface, an OAuth token needs `MERCHANT_PROFILE_READ`,
`CUSTOMERS_READ`, `CUSTOMERS_WRITE`, `ITEMS_READ`, `ORDERS_READ`, `ORDERS_WRITE`,
`PAYMENTS_READ`, `PAYMENTS_WRITE`, `SUBSCRIPTIONS_READ`, `SUBSCRIPTIONS_WRITE`,
`INVOICES_READ` and `INVOICES_WRITE`. Plan swaps require the invoice/order write
permissions as well as subscription access. Request only the subset needed for
your enabled workflow; a merchant-only charge app does not need customer/catalog
management. See [Square's current permission reference](https://developer.squareup.com/docs/oauth-api/square-permissions).
Credential provisioning, consent and OAuth token renewal remain application-owned;
this adapter does not silently onboard a different merchant.

## Catalog and capabilities

One-time catalog offers use fixed-price item variations. Subscription offers use
plan **variation** IDs with one STATIC paid phase and quantity one. Variable prices,
discount phases, free trials and complex plans require an explicit native workflow;
they are rejected rather than given misleading normalized semantics. The initial
checkout price must match the selected plan; Square allows checkout amounts to
override plan pricing, so Zero validates the canonical total against its captured
intent. See [Square subscription checkout](https://developer.squareup.com/docs/checkout-api/subscription-plan-checkout).

| Facade behavior | Stripe | Square |
| --- | --- | --- |
| Custom-amount checkout and direct tokenized charge | Supported | Supported in the configured location currency |
| Catalog checkout | Price aliases | Item or plan variation aliases |
| Hosted customer portal | Stripe portal | Optional authenticated app `portalUrl`; otherwise unsupported |
| Subscription preview and proration | Supported for normalized single-item subscriptions | Explicitly unsupported |
| Plan change | Explicit immediate/proration policy | Next-period swap with `proration: 'none'` and `paymentBehavior: 'error_if_incomplete'` |
| Cancellation | Period end or immediate | Period end only |
| Resume | Remove scheduled cancellation | Delete the scheduled CANCEL action on an ACTIVE subscription |
| Invoice documents | Hosted URL and available PDF | Hosted URL; `pdfUrl: null` |

`status().capabilities` reports these differences. Unsupported operations reject
with `PAYMENTS_CAPABILITY_UNSUPPORTED` (501). A scheduled swap is returned as
`subscription.pendingChange: { offers, effectiveAt }`; `offers` continues to
describe the current plan. It does not imply that a new plan was paid immediately.

## Ownership and paid evidence

Square-hosted checkout may create or select its own buyer customer record. That
record is not a Zero login, organization or proof of access. Zero retains its
separate customer directory and records each admitted checkout's local intent,
order reference, exact total/currency and catalog selection. Canonical subscription
phases' order-template references connect a buyer-selected subscription back to
that original intent. Invoices and payments inherit only proven ownership.
No email/phone match or webhook-supplied subject can reassign a resource.
Even a provider customer already bound to another Zero user is not sufficient:
admitted checkout lineage wins, and an ordinary directory binding does not import
unproven Square financial resources. `adoptCustomer` explicitly authorizes importing
an existing customer's legacy resources and should be used only after an operator
has established the correct owner.

Subscribe to `payment.created`, `payment.updated`, `refund.created`, `refund.updated`,
the applicable `subscription.*`, `invoice.*`, `customer.*` and `order.*` events.
Configure the webhook subscription for API **2026-09-16**, sandbox or production as
appropriate. `x-square-hmacsha256-signature` is checked in constant time over the
exact registered notification URL plus the untouched body, using each configured
key during rotation. Do not derive the URL from Host or proxy headers. See
[Square signature verification](https://developer.squareup.com/docs/webhooks/step3validate).

The durable inbox retains compact verified event identifiers, not Square's raw
card/customer payload. The worker retrieves canonical resources before updating
views or calling integrations. Unknown, unrelated merchant resources do not become
Zero subjects automatically. Use explicit trusted adoption for existing customers.

An ACTIVE subscription alone grants nothing. Its exact most recent canonical
invoice must be PAID; `chargedThroughDate` is only an invoiced-through date, not
payment proof. Grants expire at the next local midnight after that date, bounded
by cancellation, using the provider time zone including daylight saving changes.
Missing or invalid evidence fails closed. A canonically deleted bound customer
loses grants while the binding and historical records remain for operator review.

## Recovery and limits

Keep the same operation ID and input after a timeout or lost response. Idempotent
Square writes use a non-PII 45-character key. Cancellation, swap and action deletion
have no provider idempotency key: Zero records the physical attempt before sending,
serializes subscription mutations with a durable resource fence, and checks
canonical state on recovery. It never blindly sends an unresolved attempt again.
A genuinely ambiguous result requires merchant reconciliation, not a new operation ID.

Reconciliation bounds subscription discovery to 1,000 items and per-subscription
invoice lineage to 1,000. It refreshes recent invoice/order pages of 100 and up to
100 recent owned orders/payments, plus the exact latest invoice of **every** owned
subscription even when that invoice is outside the history page. It reuses
canonical search results where possible; other needed resources are read in
batches of six. Lifetime transaction history remains stored and pageable; it does
not turn every refresh into a full-history scan or impose a lifetime purchase cap.
Exceeding the subscription/evidence bound fails without publishing partial grants.
Size freshness, worker capacity and these normalized billing use cases deliberately;
the full SDK is available for application-owned high-volume accounting workflows.

History lists use the private, canonically reconciled resource ledger with
ownership-checked keyset cursors (20 by default, maximum 100). `invoices.read`,
`invoices.document`, merchant charge reads and explicit reconciliation fetch current
provider state. Initial adoption imports recent history; older history can be
imported through an explicit trusted native workflow. These are not merchant-wide
browser search endpoints.

Use `getSquarePayments(zero).native` for the full official SDK in trusted composition.
Those native calls do not automatically create Zero command receipts, resource
ownership or entitlements. Marketplace OAuth onboarding, payouts, embedded payment
collection UI and advanced catalog authoring are not normalized by this adapter.

Before live sales, qualify the configured account's checkout, payment tokens,
webhook delivery, subscriptions, refunds and recovery in an authorized Square sandbox.
Repository tests use synthetic SDK transport and real loopback Zero apps; they do
not create a real merchant transaction.
