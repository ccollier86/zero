---
id: zero.payments.operations
type: operations
audience: [operator, developer, agent]
owner: payments
status: draft
visibility: internal
system: payments
feature: operations and recovery
applies_to: ["Matching 2.6.0 framework and @zero/plugin-payments 0.2.1 archives; identify by commit and hash"]
modes: [Stripe test, Stripe live, Square sandbox, Square production, file system database]
---

# Payments Operations And Recovery

[Payments](./index.md) · [Configuration](./configuration.md) · [Webhooks](./webhooks.md)

Payments are opt-in and use private `_zero_payments_*` tables on the existing
system ReactiveDB. Enabling the plugin installs its versioned private schema;
it does not migrate tenant tables, rewrite Guardian data, register a provider
endpoint remotely or create products/prices on startup.

Plugin 0.2.0 adds private intent, resource-proof and Square-attempt tables using
additive `CREATE TABLE IF NOT EXISTS`. Existing Stripe connection identities and
receipt keys remain unchanged; no core/application migration or data reset is
required. Keep the original database and backups. Old plugin code ignores these
additions, but cannot operate a Square connection or new merchant commands.

## Durable Commands

Every mutation accepts an `operationId` of 8–128 letters, digits, underscores
or hyphens. Generate one per intended business action and retain it across
network failures. The ledger binds the ID to subject, connection and normalized
input. A completed result is replayed; changed input conflicts. Concurrent
attempts are rejected while the original owner runs.

Use `operations.read(operationId)` to inspect this subject's pending, complete,
retryable, rejected or unknown status and retry timing. It returns no raw provider request
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

Square idempotent writes use 45-character hashed provider keys. Its subscription
cancel/swap/action-deletion APIs lack such keys: Zero journals the attempt before
transport admission and reconciles observed canonical results, without blindly
resending unresolved writes. Durable per-subscription locks serialize distinct
commands and are rechecked at the actual send. See [Square recovery](./square.md).

Known pre-execution authentication, permission, rate-limit and concurrent-key
admission failures remain retryable with the original operation ID. They do not
permanently poison a command as a terminal rejection. Read outages never imply
an uncertain charge. A failure to persist a result after provider acceptance
always reports an unknown outcome.

Exact outbound Checkout, portal, subscription-change, resume and refund parameters are saved
before their provider call. Recovery uses those original parameters, not a new
balance/item layout/price lookup that could invalidate the already accepted
operation. The provider still enforces the final balance on a genuinely new refund.
Completed receipts remain replayable when catalog aliases or return URLs change,
or new sales are paused. An unresolved operation still obeys the sales pause.

Version 0.2.1 also captures return URLs for custom-amount Stripe checkout and
both Square checkout paths. An unresolved **0.2.0** merchant/Square checkout may
lack that URL snapshot: retain its original return-URL configuration until it
settles, or reconcile it with the merchant. No upgrade can reconstruct settings
that were never saved. An idempotency-key conflict remains an unknown financial
outcome, not proof of rejection; never issue a replacement operation ID to bypass it.
A subsequent blocked retry also cannot erase an earlier unknown/expired-pending
outcome. Sales pause, revoked authority or a provider error may prevent replay,
but none proves that the original attempt did not execute.

Customer creation uses a separate stable internal command so simultaneous
Checkout/customer requests cannot create unrelated customer bindings. Financial
acceptance is recorded before returning through the final Guardian revalidation.
A revoked caller does not get the response, but the accepted charge/session
receipt is not erased.

Every physical SDK mutation, including an automatic network retry, rechecks the
command lease, replay deadline and live Guardian authority immediately before
transport admission. A worker that lost its durable fence cannot start a new
financial request. A request already accepted by a provider cannot be undone by
revoking the caller; its receipt still needs reconciliation.

## Worker Health And Operator Recovery

The plugin owns its worker and drains admitted requests, webhook persistence and
worker operations before Zero disposes its system services. Network calls have bounded SDK timeouts/retries.
Square webhook resource resolution shares one deadline across its canonical reads,
as reconciliation already does. Idle work checks the
indexed inbox once per second; empty probes are reads and acquire no write
transaction/authority lease. UI renders do not start provider polling loops.
Replicas share durable claims and customer locks, with four-minute leases and
command/job heartbeat renewal.

Size freshness windows and replica capacity against the number of billing
subjects and provider account rate limits. A worker processes a bounded batch of
25 jobs serially; this is not a claim of unlimited provider throughput. Increase
`maxProjectionAgeMs` deliberately for large installations and monitor pending
work/freshness instead of hiding a backlog with stale grants.

Failures retry with bounded exponential backoff (up to five minutes). After
12 attempts a job is quarantined. Trusted operator code can inspect
`getPayments(zero).jobs.list({ status: 'quarantined' })` and
`store.pending()`, fix the actual provider/configuration/binding/callback problem,
then call `jobs.retry(jobId)` to requeue it and wake the worker. Job inspection
is bounded and excludes webhook bodies and provider parameters. Do not expose these operator capabilities to a browser route without
an explicit administration policy. Completed event payloads are compacted, not
replayed as new financial operations.

The normal Zero observability pipeline receives stable diagnostic codes
`payments.job.retry`, `payments.job.quarantined`, `payments.worker.failed` and
`payments.command.unknown`. Metadata contains the connection, job identity/kind,
attempt and safe reason, or a hashed command identity. Raw provider errors,
callback exceptions, keys, bodies and payment URLs are excluded. Diagnostic
delivery failure cannot change a financial receipt.

Use an immutable connection ID when changing merchant/mode, and a new
`policyVersion` when changing grants. Webhook rotation allows both old and new
signing secrets during the transition. API keys, signing secrets, raw webhook
bodies and payment capability URLs must not be logged or added to client config.
Use deployment-level storage encryption, backups and an explicit retention policy
for private command/customer/event receipts.

## Installation And Release Boundary

The plugin is a separate package under `packages/payments/`. The matching core
adds `@zero/framework/payments`, `@zero/framework/payments/client`, scoped server
services and `client.payments`. There is no Stripe or Square SDK dependency in the core.
An older core archive with the same 2.6.0 number can lack these exports; use the
source commit and archive SHA-256, not just the version string.

For a source/local qualification, pack the framework and plugin into separate
archives and explicitly install both in a fresh app. The plugin's optional peer
metadata prevents automatic downloads of an unpublished framework package; it
does not make the updated framework optional at runtime. Do not assume a registry
publication or that `zero update` updates a separately installed plugin.

The original Stripe qualification is recorded in the
[foundation audit](../../_work/audits/stripe-payments-foundation.md). The 0.2.0
Square/custom-charge additions require matching newly built core/plugin archives;
fresh-install tests verify both server imports and provider-free browser bundles.
The [0.2.1 review record](../../_work/audits/payments-review.md) covers follow-up
policy, retry and canonical-response corrections. Update the optional plugin
explicitly; updating the framework alone does not replace an installed 0.2.0 plugin.
Merge, package publication and application deployment remain separate actions.

## Deployment Checklist

1. Install the matching updated framework and optional plugin; keep previous
   application/package artifacts for rollback.
2. Back up the file-backed system database; require SQLite synchronous FULL
   (or EXTRA) and verify the deployment volume's durability.
3. Declare the intended merchant/mode, prices, return origins, Guardian policies
   and policy version. Configure the Stripe portal or Square's optional app-owned billing URL.
4. Register the explicit versioned snapshot webhook endpoint and signing secret.
   Check that your proxy preserves the body and permits HTTPS and SSE.
5. Qualify hosted test-mode Checkout, asynchronous failures, subscription changes,
   cancellation, refunds, signature failures and restart recovery in your own
   authorized provider sandbox before enabling live sales.
6. Inspect pending/quarantined counts and grant freshness during rollout. Set
   `acceptingSales: false` to pause new sales without blocking billing recovery.

Repository tests use synthetic keys and intercepted official-SDK HTTP responses,
plus real loopback Zero servers and disposable databases. They do not authorize
live charges, register real webhooks or establish merchant-account readiness.
