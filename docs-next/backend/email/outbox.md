---
id: zero.email.auth-outbox
type: architecture
audience: [developer, agent, operator]
owner: guardian
status: draft
visibility: internal
system: email
feature: durable-auth-outbox
maturity: supported
applies_to: ["2.1.1 development source; not package-qualified"]
modes: [managed-guardian]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Durable Guardian Email Outbox

[Email index](./index.md) · [Documentation index](../../index.md)

Guardian persists supported action-delivery jobs in the system database and
dispatches them through the owning app's email service. The outbox is an
internal account-lifecycle mechanism, not a public arbitrary-mail enqueue API.
Use normal Guardian account/onboarding operations to participate.

## Jobs And Commit Boundary

Supported kinds are `password_reset`, `email_verification`,
`tenant_invitation` and `domain_mailbox_proof`. They retain enough canonical
binding to re-evaluate eligibility at delivery time. Invitation raw secrets
are encrypted in an authenticated envelope with issuance-specific associated
data; configure the wrapping-key policy through Guardian invitation delivery.
They are not stored as plaintext action URLs for a browser to list.

Enqueue occurs within the caller's ReactiveDB transaction. Durable-enqueued
events and worker wake happen only after the outermost commit. Rollback leaves
neither committed delivery work nor a success signal. Duplicate/capacity
suppression describes the attempted request and does not wake the worker.

## Worker And Recovery

The worker claims due work with a bounded lease, extends the exact lease while
delivery is owned and uses an AbortController for ownership loss/deadline/
shutdown. Provider idempotency keys reduce repeated vendor acceptance after
uncertain delivery, but external delivery is not a transaction with SQLite.
Eligibility is checked against canonical account/invitation/domain state;
obsolete jobs are suppressed rather than mailed under stale authority.

Retryable failures receive bounded backoff while attempts remain. Terminal
states are `delivered`, `suppressed` and `dead`; active states are `pending`
and `processing`. Retention and expired-lease recovery are bounded maintenance,
not infinite retention. Shutdown stops admission/dispatch and awaits owned
work before system services disappear.

## Internal Worker Defaults

These values explain managed behavior; they are **not** an `email.outbox` or
`auth.emailOutbox` configuration subtree exposed by AppConfig.

| Setting | Default |
| --- | --- |
| Request deduplication window | 300,000 ms. |
| Active/stored jobs | 5,000 / 50,000. |
| Maximum attempts / concurrency | 10 / 4. |
| Lease / poll | 60,000 / 1,000 ms. |
| Base / maximum backoff | 1,000 / 300,000 ms. |
| Terminal retention / delivery timeout | 86,400,000 / 20,000 ms. |

The internal resolver clamps bounded worker options, including finite integer
limits. It is not an invitation to import private constructors in an app.

## Observability And Verification

The worker emits stable Guardian delivery/queued/suppressed/failure events via
the app's observability runtime. Tokens, recipients, rendered body and provider
payloads are not safe metadata. Audit and operational events remain distinct.

Focused tests should cover rollback/no wake, duplicate/capacity suppression,
expired lease, obsolete recipient binding, deterministic rejection, retry,
max attempts, provider abort and restart/shutdown recovery. Test counts from a
past source check are not release guarantees for an installed package.

- [Invitations](../guardian/invitations.md) owns encrypted invitation delivery policy.
- [Guardian delivery](./guardian-delivery.md) identifies non-outbox ceremonies.
- [ReactiveDB transactions](../reactive-db/transactions.md) owns outer commit behavior.
- [Runtime shutdown](../runtime/shutdown.md) owns ordered service disposal.
