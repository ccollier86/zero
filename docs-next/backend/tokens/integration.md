---
id: zero.platform-tokens.integration
type: architecture
audience: [developer, agent, operator]
owner: platform-tokens
status: draft
visibility: internal
system: platform-tokens
feature: security-and-transaction-domain
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

# Token Security And Integration

[Platform tokens index](./index.md) · [Documentation index](../../index.md)

Platform tokens mint bearer secrets; they are privileged server capabilities.
The service does not authenticate a caller or derive permission from subject,
scope or resource values supplied by that caller.

## Ownership And Transactions

Managed storage is _zero_action_tokens/_zero_resume_tokens in systemDB, not
a copy in every Fabric database. PlatformTokenStore owns prepared SQL and
transaction coupling; it does not use publicly writable reactive tables.

getTransactionDomain returns an opaque identity for the exact ReactiveDB
transaction owner. Guardian's adapter requires equality with its canonical
account store, so action consumption and account mutation can commit/rollback
together. A boolean claim that two unrelated DB files share a transaction is
not sufficient. Cross-database business effects need a real durable coordination
design, not a nested call across two independent SQLite transactions.

Raw store records include token hashes and are privileged. Normal service
creation/lookup records omit the hash/raw token. Do not return store internals
through a public API. There is no frontend hook/UI automatically governing
generic tokens.

## Errors And Operational Events

PlatformTokenError exposes code/status. TOKEN_INVALID, TOKEN_EXPIRED,
TOKEN_CONSUMED, TOKEN_REVOKED and TOKEN_INPUT_INVALID are400;
TOKEN_COOLDOWN is429. Map them to an app-owned safe response without raw SQL,
secret values or sensitive resource metadata.

Events use stable TOKENS_* codes and an app-bound emitter in managed
composition. Metadata may identify purpose/flow/resource/token ID; it must not
contain the raw credential. Application-chosen names and IDs should be safe
operational identifiers. Event retention is not security audit retention.

## Verification And Related Guides

The corrected generic/runtime/Guardian-action suite passed26tests/115assertions
in synthetic in-memory fixtures, including exact expiry, overflow rejection
and platform/direct action composition. Source review and artifact qualification
are separate. No distributed token store or multi-server claim was established.

- [Guardian recovery](../guardian/password-recovery.md) owns account ceremonies.
- [Torrent interactions](../torrent/index.md) owns workflow wait/resume authority.
- [ReactiveDB transactions](../reactive-db/transactions.md) owns root commit behavior.
- [Configuration](./configuration.md) owns supported composition/defaults.
