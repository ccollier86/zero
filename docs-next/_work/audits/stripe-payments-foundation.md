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

## Operational Boundaries

No production application/database, merchant configuration, remote webhook,
Stripe resource, charge, refund or credential is changed by this work. Live
merchant qualification remains a deployment step using an explicitly authorized
Stripe sandbox/account. Square, Connect, a billing UI and metered-billing policy
are roadmap items, not implemented capabilities.
