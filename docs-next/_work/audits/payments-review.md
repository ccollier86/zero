---
id: zero.payments.follow-up-review
type: operations
audience: [maintainer, agent, operator]
owner: payments
status: in-review
visibility: internal
---

# Payments Follow Up Review

[Audit index](./index.md) · [Payments operations](../../plugins/payments/operations.md)

Scope: review and hardening of Stripe/Square payments after main
`aaa1e5a41de4111b95ecace4ec517ab20d489f14`. The follow-up plugin version is **0.2.1**.
The normalized facade and database schema remain compatible. Running applications,
merchant configuration, live payments and the unrelated AI-planning worktree are
outside this change.

## Confirmed gaps and corrections

| Finding | Correction |
| --- | --- |
| Square plan changes ignored `acceptingSales: false`; checkout rejected too late, after unnecessary customer setup | Block new checkout/plan changes before their business work. Completed receipts, reads, cancellation and refunds remain available. |
| Merchant Stripe and Square checkout replay could use changed return URLs | Capture URLs with the original request. Preserve original request bytes and operation key across configuration changes. |
| Square's global recursion guard could hide a valid concurrent payment lookup for the same buyer | Keep recursion state per asynchronous call chain, preserving parallel requests and each resource's real owner. |
| Canonical reads could accept a different returned resource ID | Validate exact requested IDs across reads and event projections. A mismatched object cannot overwrite a local binding or release another payment's client secret. |
| Stripe merchant acknowledgments did not consistently validate totals and echoed intent metadata | Compare amount/currency and local intent correlation before recording success; inconsistent accepted responses remain unknown outcomes. |
| Merchant full refunds used authorized rather than captured Stripe funds | Refund captured balance minus prior refunds. Square rejects uncaptured APPROVED payments before a refund send. |
| Square idempotency and temporary errors could become terminal rejections | Preserve an unknown, retryable outcome with the original key; never imply that a prior charge did not execute. |
| An ambiguous Square 4xx response cleared a non-idempotent physical-send fence | Retain the fence for uncertain codes and unreadable error responses; recovery can inspect canonical state but cannot blindly resend the write. |
| A later blocked retry could erase the uncertainty of an earlier request | Preserve unresolved/expired-pending status even when a subsequent policy or provider check prevents replay. |
| Some Square STATIC checkout subscriptions expose only a legacy top-level order template | Validate that canonical template against the same local intent; retain ownership without adopting the buyer customer. |
| Square catalog reads failed for offers whose minimum quantity exceeded one | Default omitted quantity to the declared minimum, matching Stripe. |
| Square event lineage resolution lacked an aggregate request deadline | Bound merchant verification and canonical resource lookup together; failures remain durable retry work. |
| One-time Square invoice events could lose their checkout offer correlation | Retain the proven order's intent reference through invoice persistence and callbacks. |
| Archive evidence hardcoded versions without checking package manifests | Compare installed manifests with source and record actual installed versions. |

The Square SDK fixture now enforces unchanged request bodies for an existing
idempotency key, matching the provider contract. The initial new regression run
reproduced **15 failing cases** before the fixes. Additional targeted cases cover
captured funds, default quantities, invoice correlation, uncaptured payments,
temporary errors and background deadlines. Two further reproduced failures
verified that ambiguous 4xx responses could allow a second non-idempotent send;
regressions now require a single physical send and an unresolved receipt.

## Verification

Source checks use `--no-env-file`, synthetic SDK transports, disposable databases
and real loopback managed Zero apps. No credentials or live provider calls are used.

The final source run passed **114 payments tests** (537 assertions) and **60 core
payments/client/server integration tests** (331 assertions). Framework and plugin
TypeScript checks passed. The documentation graph check reports 814 reachable
pages with no problems. Archive qualification is a separate release check below,
not inferred from these source results.

```sh
TMPDIR=/Volumes/code-bank/tmp/scratch/zero-platform bun --no-env-file test \
  packages/payments/src/service.test.ts packages/payments/src/authority.test.ts \
  packages/payments/src/store.test.ts packages/payments/src/hardening.test.ts \
  packages/payments/src/review.test.ts packages/payments/src/merchant.test.ts \
  packages/payments/src/merchant-review.test.ts packages/payments/src/app.integration.test.ts \
  packages/payments/src/square
bun --no-env-file x tsc --noEmit -p packages/payments/tsconfig.json
bun --no-env-file x tsc --noEmit
bun --no-env-file test src/payments src/frontend/server/server-request-services.test.ts \
  src/frontend/client/sdk.test.ts src/frontend/server/server-extensions.test.ts \
  src/frontend/server/server-authorization.integration.test.ts
bun --no-env-file docs-next/_work/checks/check.ts
```

Diagnostics are saved under `/Volumes/code-bank/artifacts/zero-platform/diagnostics/`
with the `payments-review-` prefix. `packages/payments/src/package.test.ts` also
qualifies fresh framework/plugin archives, public types, managed runtime setup,
browser isolation, source/guide parity and the exact package manifests.
For release qualification, provide `ZERO_PAYMENTS_CORE_ARCHIVE` and
`ZERO_PAYMENTS_PLUGIN_ARCHIVE` so the test installs the saved pair, not an editable
working-tree pack. Its evidence identifies source commit and archive SHA-256.

## Upgrade and deployment

Install the matching framework archive and explicitly update the separate payments
plugin to 0.2.1. There is no new schema migration, database move, credential change,
ledger deletion or reset. Existing receipts and connection identities are preserved.

Unresolved 0.2.0 custom Stripe/Square checkouts may lack saved return URLs. Keep
their original return-URL configuration until they settle, or reconcile them with
the merchant. Do not substitute a new operation ID to bypass a provider conflict.
Completed receipts continue to replay normally.

Saved archives and a Git push are not an application deployment or live-provider
qualification. Before live sales, verify each actual merchant's credentials,
checkout/tokenization, webhook delivery and recovery in an authorized sandbox.
