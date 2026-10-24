---
id: zero.payments
type: index
audience: [developer, agent, operator]
owner: payments
status: draft
visibility: internal
system: payments
feature: overview
maturity: preview
applies_to: ["feature/stripe-payments-foundation with @zero/plugin-payments 0.1.0"]
modes: [single tenant, multi tenant, Stripe test, Stripe live]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "8850d12a24f1744818ab17fa37bb3dbf235229da"
  snapshot: dirty
  date: "2026-10-23"
  evidence_level: source-observed
related_packages:
  - package: "@zero/plugin-payments"
    version: "0.1.0"
    maturity: preview
---

# Stripe Payments

[Plugins](../index.md) · [Backend](../../backend/index.md)

`@zero/plugin-payments` is Zero's optional Stripe billing foundation. It supplies
hosted Checkout, customer bindings, subscriptions, invoice previews, portal
sessions, invoice/payment history, authorized refunds, entitlements, verified
webhooks, durable retries and a typed Zero facade. Installing it alone does not
start a worker, create tables, expose routes or contact Stripe.

Use `zero.payments` in a Guardian-admitted server handler and `client.payments`
in a Zero frontend. Both address the current user or organization, not a
customer ID supplied by a browser. Financial state remains on the system
database while application features use normal Guardian/Fabric boundaries.

## Guides

- [Configuration](./configuration.md): installation, required merchant/mode,
  private credentials, catalog aliases, return URLs and authorization policy.
- [API facade](./api.md): server, browser, trusted merchant APIs and exact routes.
- [Webhooks and reactive state](./webhooks.md): raw signature verification,
  canonical reconciliation, entitlement freshness and integration callbacks.
- [Operations](./operations.md): idempotency, recovery, durability, deployment,
  package compatibility and testing.
- [Roadmap](./roadmap.md): features outside this first integration.

## Product Boundaries

The normalized self-service facade covers a platform collecting payments from
its own users or organizations. Multi-tenant billing subjects are not Stripe
Connect merchants. Square, Connect onboarding/payouts, custom card collection,
metered billing policies, tax administration and a reusable billing management
UI are not implemented by this package.

For advanced Stripe products, trusted setup code can obtain the full official
Stripe SDK through `getStripePayments(zero).native`. That is an explicit merchant
escape hatch, not a public proxy and not a promise of automatic Zero ownership,
command receipts or entitlement semantics for every Stripe API.

No card number, CVV, payment amount, arbitrary customer, merchant or tenant selector
is accepted by the browser Checkout API. A successful return redirect is not
payment confirmation. [Webhook processing](./webhooks.md) owns confirmation.

The source is on `feature/stripe-payments-foundation`, based on the 2.6.0 main
line. An older package also labeled 2.6.0 does not necessarily include the new
payments bridge. Use a matching framework/plugin artifact pair as described in
[operations](./operations.md); a branch implementation is not a registry release.
