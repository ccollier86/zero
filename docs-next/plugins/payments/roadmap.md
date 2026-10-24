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

## Agreed Follow On Work

Finish and qualify the Stripe review first, followed by the email/inbox review
and the separate messaging implementation. After those, implement Square behind
the same provider-neutral payments facade. Capability discovery must expose
provider differences rather than silently emulate unsupported Stripe products.
Square is not implemented in this branch.

The next planned optional plugin is compliance logging: an application audit
trail distinct from transient diagnostics. Its design needs explicit actor and
tenant attribution, access controls, sensitive-field policy, durable ingestion,
retention, export, and verifiable integrity guarantees. Define those contracts
and the applicable deployment requirements before implementation; installing a
logging plugin alone does not establish regulatory compliance.

The full official Stripe SDK is already available to trusted setup as an escape
hatch. Adding one of these products there does not automatically implement its
authorization, durable command, reconciliation or UI contract in Zero.
