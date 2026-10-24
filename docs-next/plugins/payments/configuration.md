---
id: zero.payments.configuration
type: reference
audience: [developer, agent, operator]
owner: payments
status: draft
visibility: internal
system: payments
feature: configuration
applies_to: ["feature/stripe-payments-foundation with @zero/plugin-payments 0.1.0"]
modes: [single tenant, multi tenant, Stripe test, Stripe live]
---

# Stripe Payments Configuration

[Payments](./index.md) · [Operations](./operations.md)

Install the optional package alongside the matching updated framework. The core
framework does not depend on Stripe. This plugin pins the official `stripe`
package to **23.0.1** and its API version to **2026-09-30.endive**.

## Declare The Optional Plugin

Use the existing `server/plugins/` discovery convention, or put the returned
router in `createApp({ serverExtensions: [...] })`. Do not mount a second auth
server or implement a separate customer lookup in the application.

```ts
// server/plugins/payments.ts
import { stripePayments } from '@zero/plugin-payments';

export default stripePayments({
  mode: 'test',
  connectionId: 'platform-test',
  accountId: 'acct_REPLACE_WITH_YOUR_MERCHANT',
  // Omit these two options to use STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET.
  secretKey: Bun.env.STRIPE_SECRET_KEY,
  webhookSecrets: [Bun.env.STRIPE_WEBHOOK_SECRET!],
  policyVersion: 'billing-v1',
  catalog: {
    pro: {
      label: 'Pro', price: Bun.env.STRIPE_PRO_PRICE_ID!, kind: 'subscription',
      quantity: { min: 1, max: 20 },
      features: { advancedSearch: true, maximumProjects: 100 },
    },
    credits: {
      label: 'Credit pack', price: Bun.env.STRIPE_CREDITS_PRICE_ID!, kind: 'payment',
    },
  },
  allowedOrigins: ['https://app.example.com'],
  successUrl: 'https://app.example.com/billing/return?session_id={CHECKOUT_SESSION_ID}',
  cancelUrl: 'https://app.example.com/billing',
  portalReturnUrl: 'https://app.example.com/billing',
});
```

The deployment needs a **file-backed system database** with
`synchronous: 'FULL'` (or EXTRA) for power-loss durability. Application/Fabric databases
may retain their existing modes. Hot/ephemeral system storage is refused because
a webhook must not be acknowledged before its receipt is durable. The plugin
refuses weaker synchronous settings instead of silently changing a shared database.
For example, set `systemDb: { mode: 'file', path: './data/system.db', synchronous: 'FULL' }`
in the app's normal configuration; keep its actual existing database path. Explicit
`allowEphemeralTestMode: true` permits disposable **test-mode fixtures only**.

Restricted Stripe keys must permit the account identity read and the specific
customer, price, Checkout, subscription, invoice, PaymentIntent, portal and refund
operations you enable. A denied account read is not silently bypassed. Use a
separate minimal key for test fixtures and rotate deployment secrets normally.

## Options And Defaults

| Option | Behavior |
| --- | --- |
| `mode` | Required `test` or `live`; keys do not automatically enable payments. |
| `connectionId` | Stable private ledger namespace, 1–80 letters/digits/underscores/hyphens. Bound permanently to provider, merchant and mode. |
| `accountId` | Exact platform `acct_...`; verified using the authenticated Stripe account API before provider operations. |
| `secretKey` | Explicit secret/restricted key or `STRIPE_SECRET_KEY`; must match mode. Server only. |
| `webhookSecrets` | One to four signing secrets, or `STRIPE_WEBHOOK_SECRET`; supports overlapping rotation. |
| `catalog` | At most 100 aliases for unique Stripe prices. Prices remain authoritative for amount/currency. |
| `policyVersion` | Required stable version of the app-owned entitlement mapping. Change it when grants change. Old-version grants fail closed until reconciled. |
| `subject` | `auto` by default: current organization in a validated tenant scope, current user otherwise. `user` and `organization` are explicit alternatives. |
| `access` | Optional Guardian requirements for `read`, `manage`, `refund`, `reconcile`. Ownership boundaries still apply. |
| `acceptingSales` | Defaults true. False blocks new Checkout/subscription changes but preserves cancellation, portal and reads. |
| `allowedOrigins` | Required exact HTTPS origins. HTTP is permitted only on loopback. Credentials, fragments and arbitrary redirect origins are rejected. |
| `successUrl`, `cancelUrl`, `portalReturnUrl` | Required server-controlled URLs on declared origins. Requests cannot override them. |
| `basePath` | `/api/_zero/payments`; disjoint from the webhook path. Configure the same override in `createClient({ payments: { basePath } })`. |
| `webhookPath` | `/api/webhooks/stripe`; signature-authenticated, not session-authenticated. |
| `timeoutMs`, `maxNetworkRetries` | 30,000ms and 1; ranges 100–60,000ms and 0–2. Provider POST retries keep the same idempotency key. |
| `maxProjectionAgeMs` | 300,000ms. Worker refreshes existing projections before expiry; stale grants are withheld. Range 1,000–86,400,000ms. |
| `onChange`, `onEvent` | Optional durable, at-least-once integration callbacks. See [webhooks](./webhooks.md). |
| `callbackTimeoutMs` | 15,000ms, range 100–60,000ms. Callbacks receive an abort signal and must honor it. |
| `httpClient` | Trusted official-SDK HTTP transport override, useful for synthetic fixtures; never browser-configurable. |

Quantities default to exactly one, with configurable integer bounds up to
100,000. Features are booleans or nonnegative integer limits; one key must have
the same type across offers. Boolean grants combine with OR and numeric limits
with MAX, not addition or seat multiplication. One-time purchases use the
event callback for application fulfillment; they do not implicitly grant recurring
subscription entitlements.

## Guardian And Billing Subjects

Single-tenant users manage their own customer by default. In organization mode,
read/manage/reconcile require a current tenant `owner` or `admin`. Refunds default
to the platform-admin policy and still operate only on the caller's current
billing subject. Configure a declared permission to delegate refunds to a tenant
billing role; this never grants access to another organization's payments.

Per-user billing inside a tenant includes that tenant in the binding key, so a
user's personal customer in one workspace is not reused in another. An
organization-only configuration fails closed outside a validated tenant scope.

Declare custom permissions in Guardian before referencing them in `access`.
Configuration shapes and Guardian permission references are validated during
plugin setup, before payment tables or provider operations are installed.
Organization billing roles are not inferred from a client-supplied role string.
The built-in HTTP readers are user-session routes. Explicit app-owned machine
routes and sealed workflows can compose the scoped service with their own
admitted Guardian API-key policy; the plugin never exposes its merchant SDK there.
