---
id: zero.payments.qualification
type: operations
audience: [maintainer, agent]
owner: payments
status: in-review
visibility: internal
---

# Stripe Payments Foundation Qualification

[Audit index](./index.md) · [Payments operations](../../plugins/payments/operations.md)

Scope: optional `@zero/plugin-payments` 0.1.0 and the provider-free framework
payments bridge, on `feature/stripe-payments-foundation`, based on main commit
`8850d12a24f1744818ab17fa37bb3dbf235229da` (2.6.0). Inbox work remains in its
separate worktree and is not part of this change.

## Source Checks

Run from the payments worktree with `--no-env-file` and an external scratch root:

```sh
TMPDIR=/Volumes/code-bank/tmp/scratch/zero-platform bun --no-env-file test packages/payments/src src/payments
bun --no-env-file x tsc -p packages/payments/tsconfig.json --noEmit
bun --no-env-file test src/frontend/server/server-request-services.test.ts src/frontend/client/sdk.test.ts src/frontend/server/server-extensions.test.ts src/frontend/server/server-authorization.integration.test.ts
bun --no-env-file docs-next/_work/checks/check.ts
```

Coverage includes official-SDK request encoding, canonical catalog prices,
Checkout/customer idempotency, one-to-one binding, command/inbox/resource fences,
mode/merchant/ownership denial, separately authorized refunds, explicit
subscription policies, stale/policy/period entitlement invalidation, durable
callbacks, raw-body signature verification, duplicate and out-of-order events,
browser authority changes, managed createApp, SSE, shutdown and restart receipts.

The pre-existing SDK/request/server regression set passes 51 tests. The payment
checks use disposable SQLite databases and synthetic provider responses, never
real Stripe secrets or charges. The worker's file-backed persistence and managed
HTTP path are exercised, not inferred from an isolated route test.

## Review Hardening

The follow-up review starts from foundation commit `b726e69`. Its regression
coverage includes:

- Lease and replay-window checks at every physical SDK mutation, including
  automatic retries, with current Guardian admission checked again.
- Immutable caller input and persisted provider parameters; completed receipts
  survive catalog/URL changes and a new-sales pause.
- Retryable provider admission failures, safe read-error classification and
  explicit unknown outcomes if an accepted receipt cannot be persisted.
- Complete nested subscription-item pagination and per-source entitlement
  expiry, without exposing the private grant evidence.
- Pull-based SSE backpressure, boundary cancellation, split CRLF parsing and
  time-dependent snapshot versions.
- Redacted operator job inspection/retry, stable Zero diagnostics and background
  callbacks isolated from a completed command's execution context.
- Strict configuration validation and shutdown draining for admitted operations.

The focused source run passes 55 payments/client tests plus 24 observability
tests. The 51 existing SDK/request/server regressions, root TypeScript check,
payments-package TypeScript check and 793-page documentation check also pass.
Fresh installed-archive qualification is recorded separately below.

The reviewed archive run also passes its installed-consumer test, including
source parity for the new execution, entitlement and job modules, public import
typechecking, browser isolation and a managed raw webhook request. It adds one
archive test to the 55 focused payments/client tests.

## Installed Archives

`packages/payments/src/package.test.ts` packs both packages, installs them into a
fresh consumer without repository aliases, compiles public imports and examples,
verifies registry identity/disabled schema, inspects packaged guides and builds a
browser client without Stripe or SQLite. Installation disables lifecycle scripts
and inherited service credentials. No registry publication occurs.

The first qualification attempt caught an example calling nullable `getClient()`
without a guard; the example now uses the actual nullable contract. The final
successful run writes its exact core/plugin SHA-256 and verified flags to
`/Volumes/code-bank/artifacts/zero-platform/diagnostics/stripe-payments-foundation/installed-archive-evidence.json`.
That record labels its source snapshot honestly; it does not claim a main merge
or release merely because the version remains 2.6.0.

## Main Integration

The reviewed payments commits `b726e69` and `e47266f` and email/inbox commits
`7aa638f` and `c6c5417` are combined on main. The package export conflict is
resolved by retaining both public entry points. The managed payments test now
also enables the authenticated inbox in single and multi tenancy and checks
both HTTP namespaces.

Combined integration evidence is under
`/Volumes/code-bank/artifacts/zero-platform/diagnostics/payments-email-main-merge/`.
The first broad run hit loopback timeouts while the host was severely overloaded;
it is not a passing qualification. Sequential reruns and TypeScript results
must be read from their individual records. The earlier isolated feature-branch
qualifications above remain separate evidence.

## Deployment Boundaries

No production application/database, merchant configuration, remote webhook,
Stripe resource, charge, refund or credential is changed by this work. Live
merchant qualification remains a deployment step using an explicitly authorized
Stripe sandbox/account. Square, Connect, a billing UI and metered-billing policy
are roadmap items, not implemented capabilities.
