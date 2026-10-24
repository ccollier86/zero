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

The implemented Stripe/Square adapters, custom-amount merchant payments and scoped facade are described in the other
guides. The following items are future integrations, not hidden configuration
switches or claims that every provider product has normalized Zero semantics.

- Stripe Connect merchant onboarding, delegated account management and payouts.
- Reusable billing settings, invoices and administration UI using Zero components.
- Embedded payment/Elements flows, with explicit payment-method/client-secret boundaries.
- Usage/metered billing, subscription bundles/schedules and application-owned grace policies.
- Tax/discount/credit-note administration and custom invoice authoring workflows.
- Thin/v2 webhook destinations and additional normalized resource families.
- An administration/Doctor surface for queue health, safe recovery and upgrade readiness.

## Agreed Follow On Work

Square now uses the same provider-neutral facade with explicit capabilities,
verified checkout/order ownership, durable receipts and real-time projections.
Its native SDK remains available for advanced merchant workflows beyond the
normalized API. See [Square](./square.md) and [custom-amount charges](./merchant-charges.md).

The follow-on logging work is now a **built-in configurable core system**, not
a separate compliance plugin. It spans basic operational/security logs through
detailed user activity and compliance evidence, with dedicated Fabric databases,
workers, scoped investigation UI and granular capture/retention policies. The
[core logging plan](../../_work/logging-system-plan.md) owns that proposed work;
payment events integrate without copying credentials or raw provider payloads.

The full official provider SDKs are available to trusted setup as an escape
hatch. Adding one of these products there does not automatically implement its
authorization, durable command, reconciliation or UI contract in Zero.
