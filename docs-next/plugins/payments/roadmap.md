---
id: zero.payments.roadmap
type: roadmap
audience: [developer, agent, maintainer]
owner: payments
status: draft
visibility: internal
system: payments
feature: roadmap
---

# Payments Roadmap

[Payments](./index.md)

The implemented Stripe foundation and scoped facade are described in the other
guides. The following items are future integrations, not hidden configuration
switches or claims that the full Stripe product suite has Zero semantics.

- Square as a separate provider adapter with honest capability differences.
- Stripe Connect merchant onboarding, delegated account management and payouts.
- Reusable billing settings, invoices and administration UI using Zero components.
- Embedded payment/Elements flows, with explicit payment-method/client-secret boundaries.
- Usage/metered billing, subscription bundles/schedules and application-owned grace policies.
- Tax/discount/credit-note administration and custom invoice authoring workflows.
- Thin/v2 webhook destinations and additional normalized resource families.
- An administration/Doctor surface for queue health, safe recovery and upgrade readiness.

The full official Stripe SDK is already available to trusted setup as an escape
hatch. Adding one of these products there does not automatically implement its
authorization, durable command, reconciliation or UI contract in Zero.
