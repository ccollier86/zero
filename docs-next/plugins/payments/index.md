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
applies_to: ["Matching 2.6.0 framework and @zero/plugin-payments 0.2.1 archives; identify by commit and hash"]
modes: [single tenant, multi tenant, Stripe test, Stripe live, Square sandbox, Square production]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "78f1193b79723348734000db614e7098d5a942fe"
  snapshot: dirty
  date: "2026-10-24"
  evidence_level: source-observed
related_packages:
  - package: "@zero/plugin-payments"
    version: "0.2.1"
    maturity: preview
---

# Stripe and Square Payments

[Plugins](../index.md) · [Backend](../../backend/index.md)

`@zero/plugin-payments` supplies optional Stripe and Square payments behind one
Zero facade. It supplies
hosted Checkout, customer bindings, subscriptions, invoice previews, portal
sessions, invoice/payment history, authorized refunds, entitlements, verified
webhooks, durable retries and a typed Zero facade. Installing it alone does not
start a worker, create tables, expose routes or contact a payment provider.

Use `zero.payments` in a Guardian-admitted server handler and `client.payments`
in a Zero frontend. Both address the current user or organization, not a
customer ID supplied by a browser. Financial state remains on the system
database while application features use normal Guardian/Fabric boundaries.

For custom-amount sales without a catalog product, customer or Zero user, use the
trusted merchant `charges` capability. It supports both hosted checkout and direct
tokenized charges with the same inputs on either provider. It does not expose an
unrestricted amount selector in browser billing routes.

## Guides

- [Configuration](./configuration.md): installation, required merchant/mode,
  private credentials, catalog aliases, return URLs and authorization policy.
- [API facade](./api.md): server, browser, trusted merchant APIs and exact routes.
- [Square](./square.md): configuration, permissions, ownership and capability differences.
- [Custom amount merchant charges](./merchant-charges.md): subjectless payments,
  hosted links, tokenized direct charges, refunds and integration callbacks.
- [Webhooks and reactive state](./webhooks.md): raw signature verification,
  canonical reconciliation, entitlement freshness and integration callbacks.
- [Operations](./operations.md): idempotency, recovery, durability, deployment,
  package compatibility and testing.
- [Roadmap](./roadmap.md): features outside this first integration.

## Product Boundaries

The normalized self-service facade covers a platform collecting payments from
its own users or organizations. Multi-tenant billing subjects are not Stripe
Connect merchants. Marketplace onboarding/payouts, embedded card collection UI,
metered billing policies, tax administration and a reusable billing management
UI are not implemented by this package.

Configure one provider owner per app. Square uses merchant/location identifiers
and catalog aliases rather than Stripe IDs; unsupported semantics return
`PAYMENTS_CAPABILITY_UNSUPPORTED`, not a fabricated success. Discover differences
with `status().capabilities`.

For advanced provider products, trusted setup code can obtain the full official
SDK through `getStripePayments(zero).native` or `getSquarePayments(zero).native`.
That is an explicit merchant
escape hatch, not a public proxy and not a promise of automatic Zero ownership,
command receipts or entitlement semantics for every provider API.

No card number, CVV, payment amount, arbitrary customer, merchant or tenant selector
is accepted by the browser Checkout API. A successful return redirect is not
payment confirmation. [Webhook processing](./webhooks.md) owns confirmation.

The implementation is merged to `main`; the feature branch retains its review
history. An older package also labeled 2.6.0 does not necessarily include the new
payments bridge. Use a matching framework/plugin artifact pair as described in
[operations](./operations.md). A saved local archive is not an npm publication,
and updating the framework does not install or update this optional plugin.
