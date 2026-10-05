---
id: zero.email.service
type: reference
audience: [developer, agent]
owner: email
status: draft
visibility: internal
system: email
feature: send-contract
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

# Sending Email

[Email index](./index.md) · [Documentation index](../../index.md)

`EmailService.send(message): Promise<EmailSendResult>` waits for the selected
provider's send boundary. It does not queue a generic message, retry it
automatically, deliver a browser notification or update a workflow's status.
Use the owning app service in normal server handlers; the following standalone
example is deliberately network-free.

```ts
import { createEmailRuntime, MemoryEmailProvider } from '@zero/framework/email';

const provider = new MemoryEmailProvider();
const runtime = createEmailRuntime({
  provider,
  from: 'Example <no-reply@example.test>',
}, { name: 'Example' });

const receipt = await runtime.service.send({
  to: 'recipient@example.test',
  subject: 'Your report is ready',
  text: 'Open the application to view your report.',
});
// receipt.provider === 'memory'; one synthetic message is captured.
```

## Message And Result

| `EmailMessage` field | Contract |
| --- | --- |
| `to` | Required string or string array. At least one nonblank recipient is required; this is not a comprehensive mailbox validator. |
| `from`, `replyTo` | Optional per-message override, then service defaults by nullish precedence. |
| `subject` | Required nonblank subject. |
| `text` | Required string; either nonblank text or HTML must be supplied. |
| `html` | Optional HTML; the caller owns safe rendering/content. |
| `tags` | Optional string map; built-in Resend maps it to name/value tags. |
| `metadata` | Internal application metadata, not sent by the built-in Resend mapping. A custom provider receives the message and owns its mapping. |
| `idempotencyKey` | Optional stable provider request key; Resend forwards it. No local generic-send deduplication store is created. |
| `signal` | Optional AbortSignal, forwarded to the provider; custom providers must honor their declared cancellation contract. |

The result contains `provider`, `accepted: string[]`, optional `id` and optional
`rejected`. Accepted means the provider boundary accepted the attempt, not
delivery/read confirmation. Memory/no-op/console results do not mean real mail
was sent. Per-message strings should be valid application-owned values;
blank overrides do not request a fallback to environment configuration.

## Failure And Observability

`EmailError` exposes `code` and `status`. Missing sender is
`EMAIL_FROM_REQUIRED`/500; empty recipients, subject or body use
`EMAIL_RECIPIENT_REQUIRED`, `EMAIL_SUBJECT_REQUIRED`, `EMAIL_BODY_REQUIRED`/400.
Provider failures preserve an existing EmailError; other thrown values become
generic `EMAIL_SEND_FAILED`/502. Validation happens before provider dispatch.

Delivery uses `EMAIL_SEND_REQUESTED`, `EMAIL_SENT`, `EMAIL_SEND_FAILED` through
Zero's observability boundary. Metadata contains provider/count/status/code,
not body, recipients or credentials. Do not log a full message or put secrets
into custom provider errors. Provider idempotency/cancellation is not an
exactly-once local transaction.

## Security, Testing And Next Steps

Authorize application sends on the server before invoking the service. Do not
expose a raw recipient/content relay to anonymous callers. Tenant/user ownership
of a business operation does not itself authorize arbitrary email delivery.
Use MemoryEmailProvider and a fresh runtime for tests, inspecting synthetic
captured messages rather than invoking a real vendor.

- [Configuration](./configuration.md) defines captured defaults and app-local ownership.
- [Providers](./providers.md) explains vendor and test boundaries.
- [Auth outbox](./outbox.md) covers durable Guardian delivery, not arbitrary sends.
