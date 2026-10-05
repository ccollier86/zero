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

# Email

[Backend index](../index.md) · [Documentation index](../../index.md)

Email is Zero's server-side delivery boundary. Application code supplies a
message; the service applies sender defaults, validates it and delegates to a
built-in or custom provider. Guardian additionally owns durable account-action
delivery. A provider acceptance is not proof that a recipient read a message.

## Feature Guides

| Guide | Use it for |
| --- | --- |
| [Service](./service.md) | Sending messages, normalized results and safe failure handling. |
| [Providers](./providers.md) | Resend, synthetic capture, no-op and custom adapters. |
| [Configuration](./configuration.md) | Exact app/env precedence, readiness and runtime ownership. |
| [Guardian delivery](./guardian-delivery.md) | Account-action templates, public links and security ceremonies. |
| [Durable auth outbox](./outbox.md) | Transaction-coupled enqueue, leases, retries and shutdown. |
| [Roadmap](./roadmap.md) | Additional delivery channels/providers, not current APIs. |

## Public Boundary And Integration

Use `@zero/framework/email` on the server. Managed application code receives
the owning app's email service; standalone code can create its own runtime.
There is no browser email credential surface or generic public send endpoint.
The app decides who may send, to whom and with what content.

The separation observed in source is intentional: provider adapters own vendor
HTTP mapping, EmailService owns delivery mechanics, and Guardian owns account
policy and secret-bearing links. Generic sends are not automatically put in
Guardian's outbox. [Runtime services](../runtime/server-services.md) explains
why app-local injection is preferable to ambient compatibility getters.

## Applicability And Verification

This draft includes the unreleased captured-credential readiness correction:
an explicit empty Resend key does not fall back only during readiness, and
later ambient environment changes cannot alter the adapter's captured key.
The inspected focused tests used synthetic messages and made no provider calls.
Released package support remains a separate qualification gate.

- [Guardian](../guardian/index.md) owns identity/authentication policy.
- [Scheduler](../scheduler/index.md) supplies process-local scheduling, not mail persistence.
- [ReactiveDB transactions](../reactive-db/transactions.md) explain durable enqueue boundaries.
