---
id: zero.platform-tokens.action
type: reference
audience: [developer, agent, operator]
owner: platform-tokens
status: draft
visibility: internal
system: platform-tokens
feature: consume-once-actions
maturity: supported
applies_to: ["2.1.1 development source; not package-qualified"]
modes: [managed-server, standalone-server]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Consume-Once Action Tokens

[Platform tokens index](./index.md) · [Documentation index](../../index.md)

Create an action token for one specific action. Inspect it while presenting
the action screen, then consume it at the final state-changing transaction.
Do not use inspection as a reservation or call an external side effect before
claiming the token.

## Creation And Lookup

`createActionToken(options)` requires a nonblank purpose. Optional fields:
subject `{ type, id }`, scope string/null, ttl, cooldown string/false,
createdBy string/null and metadata object. Required identifiers are trimmed;
omitted/blank optional scope becomes null.

Returns `{ rawToken, record }`. The record contains tokenId/purpose/
subject/scope/expiresAt/consumedAt/createdAt/createdBy/metadata, but no raw token
or hash. Default TTL15m and active-token cooldown5m are described in
[configuration](./configuration.md).

`inspectActionToken(rawToken, { purposes?, scope? })` checks expiry,
consumption, optional purpose allowlist and optional exact scope, without
consuming. An empty purpose allowlist admits no purpose. Omitting filters
does **not** infer the right action for the current route; supply them.

`consumeActionToken(rawToken, lookup?)` performs the same checks and
conditional consume inside the store's transaction. Reuse fails TOKEN_CONSUMED.
It returns the accepted record with consumedAt.

## Revocation And Cleanup

`revokeActionToken(rawToken)` uses the consumed marker and returns whether
the live row changed. `discardUndeliveredActionToken(rawToken)` deletes
the issuing attempt's record; use only when the secret was never delivered.
`cleanupExpiredActionTokens()` deletes expired/already-consumed rows and
returns the count. It is not durable security-audit retention.

Exact expiry is now rejected at `now >= expiresAt`; expiry cleanup includes
that deadline. Zero-second TTL creates an immediately expired credential,
not an unbounded lifetime. Malformed/unsafe duration or expiry arithmetic
fails TOKEN_INPUT_INVALID/400 before storing a new token.

## Transaction And Verification

The token and business change must share the same transaction domain to be
atomic. A successful consume's event is deferred to outer commit. Inspection
alone cannot prevent two separate applications from performing the effect.

Test wrong purpose/scope, exact expiry, sequential/concurrent claims under the
actual transaction owner, surrounding rollback and undelivered cleanup. Keep
raw tokens out of URL analytics, logs and persisted metadata.

- [Integration](./integration.md) owns authorization/transaction responsibilities.
- [Resume tokens](./resume-tokens.md) differs by reusable lifetime.
- [Guardian recovery](../guardian/password-recovery.md) owns account-action semantics.
