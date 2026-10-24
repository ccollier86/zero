# Zero Payments

Optional Stripe and Square payments for Zero. Install alongside the matching
framework that exports `@zero/framework/payments`; importing the package alone
starts nothing. Version 0.2.0 adds Square and subjectless custom-amount payments
through the same facade; install matching framework and plugin archives.

```ts
// server/plugins/payments.ts
import { stripePayments } from '@zero/plugin-payments';

export default stripePayments({
  mode: 'test', connectionId: 'my-app-test', accountId: 'acct_YOUR_ACCOUNT',
  policyVersion: 'v1', catalog: {
    pro: { label: 'Pro', price: Bun.env.STRIPE_PRO_PRICE_ID!, kind: 'subscription', features: { pro: true } },
  },
  allowedOrigins: ['https://app.example.com'],
  successUrl: 'https://app.example.com/billing/return?session_id={CHECKOUT_SESSION_ID}',
  cancelUrl: 'https://app.example.com/billing',
  portalReturnUrl: 'https://app.example.com/billing',
});
```

Supply server-only `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`. Use a durable
file-backed Zero system database with `synchronous: 'FULL'` and a Stripe v1 snapshot webhook endpoint on
API version `2026-09-30.endive`. The official `stripe` SDK is pinned to 23.0.1.

Use `zero.payments` in authorized server handlers and `client.payments` in the
frontend. Checkout/customer/portal/subscription/refund mutations take a stable
`operationId`; keep it when retrying. Never treat a success redirect as proof
of payment. Never put keys, raw card data or arbitrary amounts into the self-service facade.

For Square, declare `squarePayments` from this package or its `/square` export.
Use `merchantId`, `locationId`, `SQUARE_ACCESS_TOKEN`,
`SQUARE_WEBHOOK_SIGNATURE_KEY`, and the exact `webhookNotificationUrl`.
The official Square SDK is pinned to 46.0.0 with API version `2026-09-16`.
The same `zero.payments` / `client.payments` methods apply; check
`status().capabilities` before offering provider-specific actions.

Trusted plugin setup can obtain `getPayments(zero).charges`. Both providers support
`charges.checkout({ operationId, total: { amount: 2500, currency: 'usd' }, description: 'Custom work' })`
without a catalog product, Zero user or provider customer. `charges.create` takes
the same fields plus a provider `paymentToken`, and optional Square
`verificationToken`. Amounts are positive integer minor units. This API is never
mounted as an untrusted arbitrary-amount endpoint. See the canonical merchant guide
for direct-charge confirmation, refunds, callbacks and safe retries.

Canonical guides ship with the framework under `docs-next/plugins/payments/`:
overview, configuration, API, Square, merchant charges, webhooks, operations and roadmap.
The optional plugin does not replace Guardian, ReactiveDB, Fabric or Torrent.
Marketplace onboarding/payouts and a billing UI remain future work. Advanced
provider APIs remain available through the explicitly trusted
`getStripePayments(zero).native` or `getSquarePayments(zero).native` escape hatch.
