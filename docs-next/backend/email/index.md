---
id: zero.email
type: index
audience: [developer, agent, operator]
owner: email
status: draft
visibility: internal
system: email
feature: overview
maturity: supported
applies_to: ["2.6.0 main source with SMTP/IMAP; identify saved packages by commit and hash"]
modes: [managed-server, standalone-server]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "8850d12a24f1744818ab17fa37bb3dbf235229da"
  snapshot: dirty
  date: "2026-10-22"
  evidence_level: source-observed
---

# Email

[Backend index](../index.md) · [Documentation index](../../index.md)

Email is Zero's server-side delivery boundary. Application code supplies a
message; the service applies sender defaults, validates it and delegates to a
built-in or custom provider. Guardian additionally owns durable account-action
delivery. A provider acceptance is not proof that a recipient read a message.

SMTP, IMAP and the optional inbox are merged to `main` and included in its saved
framework package. Use the [normal package update](../../cli/tooling/zero-update.md)
and record the source commit/archive checksum; older archives with the same
2.6.0 version may lack these features. Updating alone does not enable mail,
create an inbox state file or migrate an application's data.

## Feature Guides

| Guide | Use it for |
| --- | --- |
| [Service](./service.md) | Sending messages, normalized results and safe failure handling. |
| [Providers](./providers.md) | SMTP, Resend, synthetic capture, no-op and custom adapters. |
| [SMTP](./smtp.md) | Standard SMTP, Purelymail configuration, TLS and Guardian delivery. |
| [Receiving and live mailboxes](./mailbox.md) | Optional IMAP folders, MIME, attachments, flags, drafts and IDLE updates. |
| [Attachments and readiness](./attachments.md) | Shared Resend/SMTP file limits, exact bytes, explicit provider capability and the public readiness helper. |
| [Managed Email Inbox](./inbox.md) | Optional Guardian-authorized browser API, private draft revisions, durable send receipts and shared live subscriptions. |
| [Configuration](./configuration.md) | Exact app/env precedence, readiness and runtime ownership. |
| [Guardian delivery](./guardian-delivery.md) | Account-action templates, public links and security ceremonies. |
| [Durable auth outbox](./outbox.md) | Transaction-coupled enqueue, leases, retries and shutdown. |
| [Roadmap](./roadmap.md) | Additional delivery channels/providers, not current APIs. |

## Public Boundary And Integration

Use `@zero/framework/email` on the server. Managed application code receives
the owning app's email service; standalone code can create its own runtime.
There is no browser email credential surface or unauthenticated generic send
endpoint. The optional [inbox bridge](./inbox.md) admits a scoped mailbox and
explicit From identities; the app decides who may send and what account policy
applies.

The separation is intentional: provider adapters own HTTP/SMTP mapping,
EmailService owns delivery mechanics, the mailbox owns IMAP/MIME and Guardian owns account
policy and secret-bearing links. Generic sends are not automatically put in
Guardian's outbox. [Runtime services](../runtime/server-services.md) explains
why app-local injection is preferable to ambient compatibility getters.

## Integration Map

| Layer | Zero integration |
| --- | --- |
| Configuration | `email.provider: 'smtp'` and optional `email.imap`; `emailFromEnv()` is shared by the root app and generated starter. |
| Server API | App-local `zero.email.send()` and optional `zero.mailbox`; public classes/types through `@zero/framework/email` and `@zero/framework/server`. |
| Guardian | Existing setup/reset, verification, invitation and MFA delivery uses the selected provider without replacing templates or routes. |
| Durable delivery | Guardian retains its transaction-coupled outbox, retry and shutdown ownership. Generic email is not automatically queued. |
| Real time | IMAP IDLE publishes bounded metadata deltas and explicit resync events, ready for the app's authorized ReactiveDB ingestion and Sync UI. No automatic private-mail persistence. |
| Isolation | Runtime ownership separates apps. Raw receiving is blocked in normal multi-tenant/workflow projections; deliberate privileged access still needs app policy. |
| Operations | Doctor checks connection settings and Guardian readiness without network probes. Managed stop retires mail sockets and subscriptions. |

Both modules are optional and require no new database migration. Enabling
sending does not enable receiving; enabling receiving does not create a public
mail interface or provisioning service. Enabling `email.inbox` additionally
creates its explicitly configured private state file, without changing existing
app/Guardian databases. Protocol/integration tests use
loopback servers and synthetic messages, not production accounts.

- [Guardian](../guardian/index.md) owns identity/authentication policy.
- [Scheduler](../scheduler/index.md) supplies process-local scheduling, not mail persistence.
- [ReactiveDB transactions](../reactive-db/transactions.md) explain durable enqueue boundaries.
