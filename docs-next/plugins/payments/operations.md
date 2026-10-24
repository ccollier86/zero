---
id: zero.payments.operations
type: operations
audience: [operator, developer, agent]
owner: payments
status: draft
visibility: internal
system: payments
feature: operations and recovery
applies_to: ["feature/stripe-payments-foundation with @zero/plugin-payments 0.1.0"]
modes: [Stripe test, Stripe live, file system database]
---

# Payments Operations And Recovery

[Payments](./index.md) · [Configuration](./configuration.md) · [Webhooks](./webhooks.md)

Payments are opt-in and use private `_zero_payments_*` tables on the existing
system ReactiveDB. Enabling the plugin installs its versioned private schema;
it does not migrate tenant tables, rewrite Guardian data, register a Stripe
endpoint remotely or create products/prices on startup.

## Durable Commands

Every mutation accepts an `operationId` of 8–128 letters, digits, underscores
or hyphens. Generate one per intended business action and retain it across
network failures. The ledger binds the ID to subject, connection and normalized
input. A completed result is replayed; changed input conflicts. Concurrent
attempts are rejected while the original owner runs.

Use `operations.read(operationId)` to inspect this subject's pending, complete,
rejected or unknown status and retry timing. It returns no raw provider request
or payment capability URL. Repeating the original authorized operation retrieves
its completed receipt without creating a new intent.

Provider keys are non-PII hashes of that durable identity. Connection IDs must
identify one actual deployment/ledger namespace, not a shared label reused by
independent databases on the same merchant account. Back up the ledger together
with configuration; losing it is not permission to issue replacement charges.

Timeouts, transport failures and provider 5xx responses retain an unknown result.
Reuse the **same** operation ID. The local safe automatic replay window is
23 hours from the original attempt; older unresolved commands require explicit
merchant reconciliation and are not automatically reissued. Stripe may retain
even error results for a key. A new key is not a generic recovery strategy.
[Stripe idempotency semantics](https://docs.stripe.com/api/idempotent_requests)
describe the provider's minimum retention and parameter checks.

Exact outbound Checkout, subscription-change and refund parameters are saved
before their provider call. Recovery uses those original parameters, not a new
balance/item layout/price lookup that could invalidate the already accepted
operation. Stripe still enforces the final balance on a genuinely new refund.

Customer creation uses a separate stable internal command so simultaneous
Checkout/customer requests cannot create unrelated customer bindings. Financial
acceptance is recorded before returning through the final Guardian revalidation.
A revoked caller does not get the response, but the accepted charge/session
receipt is not erased.

## Worker Health And Operator Recovery

The plugin owns its worker and stops/drains it before Zero disposes its system
services. Network calls have bounded SDK timeouts/retries. Idle work checks the
indexed inbox once per second; empty probes are reads and acquire no write
transaction/authority lease. UI renders do not start Stripe polling loops.
Replicas share durable claims and customer locks, with four-minute leases and
command/job heartbeat renewal.

Size freshness windows and replica capacity against the number of billing
subjects and Stripe account rate limits. A worker processes a bounded batch of
25 jobs serially; this is not a claim of unlimited provider throughput. Increase
`maxProjectionAgeMs` deliberately for large installations and monitor pending
work/freshness instead of hiding a backlog with stale grants.

Failures retry with bounded exponential backoff (up to five minutes). After
12 attempts a job is quarantined. Trusted operator code can inspect
`getStripePayments(zero).store.pending()`, fix the actual provider/configuration/
binding/callback problem, call `store.replay(eventId)` and allow the worker to
resume. Do not expose these raw operator capabilities to a browser route without
an explicit administration policy. Completed event payloads are compacted, not
replayed as new financial operations.

Use an immutable connection ID when changing merchant/mode, and a new
`policyVersion` when changing grants. Webhook rotation allows both old and new
signing secrets during the transition. API keys, signing secrets, raw webhook
bodies and payment capability URLs must not be logged or added to client config.
Use deployment-level storage encryption, backups and an explicit retention policy
for private command/customer/event receipts.

## Installation And Release Boundary

The plugin is a separate package under `packages/payments/`. The matching core
adds `@zero/framework/payments`, `@zero/framework/payments/client`, scoped server
services and `client.payments`. There is no Stripe dependency in the core.
An older core archive with the same 2.6.0 number can lack these exports; use the
source commit and archive SHA-256, not just the version string.

For a source/local qualification, pack the framework and plugin into separate
archives and explicitly install both in a fresh app. The plugin's optional peer
metadata prevents automatic downloads of an unpublished framework package; it
does not make the updated framework optional at runtime. Do not assume a registry
publication or that `zero update` updates a separately installed plugin.

The current implementation lives on `feature/stripe-payments-foundation`. Read
the [qualification record](../../_work/audits/stripe-payments-foundation.md) for
the actual source/archive checks. Merge/publication/deployment are separate actions.

## Deployment Checklist

1. Install the matching updated framework and optional plugin; keep previous
   application/package artifacts for rollback.
2. Back up the file-backed system database; require SQLite synchronous FULL
   (or EXTRA) and verify the deployment volume's durability.
3. Declare the intended merchant/mode, prices, return origins, Guardian policies
   and policy version. Configure the Stripe billing portal in the merchant account.
4. Register the explicit versioned snapshot webhook endpoint and signing secret.
   Check that your proxy preserves the body and permits HTTPS and SSE.
5. Qualify hosted test-mode Checkout, asynchronous failures, subscription changes,
   cancellation, refunds, signature failures and restart recovery in your own
   authorized Stripe sandbox before enabling live sales.
6. Inspect pending/quarantined counts and grant freshness during rollout. Set
   `acceptingSales: false` to pause new sales without blocking billing recovery.

Repository tests use synthetic keys and intercepted official-SDK HTTP responses,
plus real loopback Zero servers and disposable databases. They do not authorize
live charges, register real webhooks or establish merchant-account readiness.
