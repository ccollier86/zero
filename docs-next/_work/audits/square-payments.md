---
id: zero.payments.square-qualification
type: operations
audience: [maintainer, agent, operator]
owner: payments
status: in-review
visibility: internal
---

# Square and Merchant Payments Qualification

[Audit index](./index.md) · [Payments](../../plugins/payments/index.md)

Scope: optional `@zero/plugin-payments` **0.2.0** and additive framework payment
contracts, developed on `feature/square-payments` from main
`78f1193b79723348734000db614e7098d5a942fe`. Existing Stripe receipts and normalized
method names remain compatible. The unrelated AI-planning worktree is not part
of this change. No application database, merchant account or live provider was used.

## Implemented contracts

- Square uses the same Guardian-admitted server/browser facade, shared HTTP
  routes, SYSTEM database, fenced command/inbox records and reactive revision feed.
- Both adapters expose trusted `getPayments(zero).charges` for custom-amount hosted
  checkout/direct tokenized charges, reads, partial/full refunds, local receipt
  inspection and separately retrieved Stripe client actions. Products/customers/
  Zero users are not required; arbitrary-amount browser routes are not installed.
- Native Square SDK 46.0.0 and API 2026-09-16 are pinned. Non-idempotent subscription
  writes have an attempt journal plus resource fence; ambiguous sends are reconciled,
  not blindly repeated. Explicit capabilities expose unsupported provider semantics.
- Hosted-checkout ownership follows local intent/order/template evidence, including
  when Square selects a buyer customer already bound to a different Zero account.
  Ordinary customer directory IDs do not import unrelated Square resources.
  Trusted adoption is a separate, explicit migration capability.
- Grants require the exact latest paid invoice, valid policy/freshness and actual
  local calendar expiry. Historical checkout completion is separate from current
  subscription access. Deleted provider customers lose grants without erasing history.
- Recent-history reconciliation remains bounded independently of lifetime purchases;
  the regression includes more than 3,000 historical payments. All current
  subscription invoice evidence is checked even outside the recent preview page.

## Source and managed app checks

```sh
TMPDIR=/Volumes/code-bank/tmp/scratch/zero-platform bun --no-env-file test \
  packages/payments/src/service.test.ts packages/payments/src/authority.test.ts \
  packages/payments/src/store.test.ts packages/payments/src/hardening.test.ts \
  packages/payments/src/review.test.ts packages/payments/src/merchant.test.ts \
  packages/payments/src/app.integration.test.ts packages/payments/src/square
bun --no-env-file x tsc --noEmit -p packages/payments/tsconfig.json
bun --no-env-file x tsc --noEmit
bun --no-env-file test src/payments src/frontend/server/server-request-services.test.ts \
  src/frontend/client/sdk.test.ts src/frontend/server/server-extensions.test.ts \
  src/frontend/server/server-authorization.integration.test.ts
bun --no-env-file docs-next/_work/checks/check.ts
```

The reviewed focused run passes **85 tests**, and the core payment/SDK/request/
server regression set passes **60 tests**. Both TypeScript scopes pass. Diagnostics
are stored under `/Volumes/code-bank/artifacts/zero-platform/diagnostics/`, with
`payments-reviewed-final.log`, `payments-reviewed-types.log`,
`payments-root-types.log` and `payments-core-regression.log` as the source records.

Managed `createApp` checks exercise single and multi tenancy, raw signed webhook
bodies, actual endpoint admission, SSE, file-backed FULL SYSTEM storage, shutdown,
restart receipt replay and merchant-only operation with `auth: false`. Financial
tests use the real official SDKs against synthetic transports; only the Zero test
HTTP servers listen on loopback. They cover lost accepted charge/refund/checkout
responses, stale fences, authority changes, immutable inputs, canonical event
ordering, callback retry and aborting a paused stream without leaking its listener.

## Fresh package qualification

`packages/payments/src/package.test.ts` packs and installs framework/plugin archives
in a fresh consumer without repository aliases or inherited credentials. It
compiles both provider entry points and shared merchant types, checks packaged
source/guide parity and registry identity, mounts a managed Stripe webhook and
executes a synthetic subjectless Square charge through managed Zero services.
The browser client bundle is checked for both SDKs, provider secrets and SQLite.

Successful runs save exact source commit, dirty/clean status, archive paths and
SHA-256 values to
`/Volumes/code-bank/artifacts/zero-platform/diagnostics/payments-multi-provider/installed-archive-evidence.json`.
Set `ZERO_PAYMENTS_CORE_ARCHIVE` and `ZERO_PAYMENTS_PLUGIN_ARCHIVE` to requalify the
exact saved release pair instead of packing the working tree. Use that evidence
and each archive's release metadata to identify the build; framework 2.6.0 alone
is not enough. The optional plugin requires its own explicit package update.

## Deployment boundary

No live charge, refund, remote webhook registration, production migration or
application deployment is performed by these checks. Each deploying app must
qualify its own provider credentials, configured merchant/location, checkout,
payment-token verification and webhook delivery in an authorized sandbox before
enabling live sales. Native SDK availability does not automatically add normalized
ownership/receipts for every provider product. Marketplace onboarding, payouts,
embedded collection UI and advanced accounting remain explicit app/native workflows.
