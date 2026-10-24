# Zero Stripe Payments

Optional Stripe billing foundation for Zero. Install alongside the matching
framework that exports `@zero/framework/payments`; importing the package alone
starts nothing. The source preview is on `feature/stripe-payments-foundation`.

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
of payment. Never put keys, card data or arbitrary amounts into the facade.

Canonical guides ship with the framework under `docs-next/plugins/payments/`:
overview, configuration, API, webhooks, operations and roadmap. The optional
plugin does not replace Guardian, ReactiveDB, Fabric or Torrent. Square/Connect
and a billing UI are future work; advanced Stripe APIs remain available through
the explicitly trusted `getStripePayments(zero).native` escape hatch.
