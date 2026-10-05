---
id: zero.sync.authentication
type: reference
audience: [developer, agent, operator]
owner: sync
status: draft
visibility: internal
system: sync
feature: authentication
maturity: supported
applies_to: ["2.1.1 source baseline; package qualification pending"]
modes: [single, multi, default-plane, system-plane, tenant-database]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Authenticate A Sync Connection

[Sync index](./index.md) · [Documentation index](../../index.md)

The normal protocol sends credentials in a sync.auth message, then waits for
sync.auth.ready before proceeding with authenticated subscriptions. Avoid bearer
tokens in URLs: query authentication is rejected unless a trusted server
explicitly enables allowLegacyQueryToken as a migration escape hatch.

## Admission

Without auth configuration, standalone Sync is anonymous. With optional auth,
a missing token may remain anonymous, but an invalid provided token is rejected.
Required auth rejects missing credentials and expires an unfinished handshake
after 10 seconds. Use the managed SDK rather than manually copying a browser's
token into an unrelated raw connection.

Managed Guardian resolves current account/session/membership authority, not just
JWT claims. The captured identity is detached from verifier-owned objects.
A required multi-tenant identity must have a durable live authority fence;
legacy verifier compatibility is deliberately single-tenant only.

## Revocation And Transitions

Periodic revalidation and shared authority revisions detect current-account
changes. Policy and authority are checked again at read delivery and mutation
commit boundaries. Cached token validity does not overrule suspended accounts,
revoked sessions or changed role authority.

An authentication/tenant transition purges old scoped data and holds writes
until the replacement connection establishes its baseline. A delayed verification
result cannot reactivate a closed/disposed connection.

## Error Handling

Authentication failures use close code 4001; unavailable/failing authority
resolution uses 1011. Clients can use refreshAuth and onAuthFailure rather than
retrying the same invalid credential forever. Do not log tokens, MFA secrets or
session payloads while diagnosing a handshake.

See [Guardian sessions](../guardian/index.md), [client restoration](../../frontend/sdk/index.md),
[configuration](./configuration.md) and [lifecycle](./lifecycle.md).
