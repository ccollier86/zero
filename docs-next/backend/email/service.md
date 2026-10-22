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
applies_to: ["2.6.0 development source; not package-qualified"]
modes: [managed-server, standalone-server]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "8850d12a24f1744818ab17fa37bb3dbf235229da"
  snapshot: dirty
  date: "2026-10-22"
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
| `cc`, `bcc` | Optional string or string array. Included in accepted/rejected recipient accounting; SMTP omits Bcc from visible MIME headers. |
| `from`, `replyTo` | Optional per-message override, then service defaults by nullish precedence. |
| `subject` | Required nonblank subject. |
| `text` | Required string; either nonblank text or HTML must be supplied. |
| `html` | Optional HTML; the caller owns safe rendering/content. |
| `attachments` | Up to 100 in-memory `{ filename, content: Uint8Array, contentType?, contentId? }` records. SMTP supports explicit MIME type and inline IDs; Resend accepts basic file attachments and rejects unsupported MIME overrides. No paths/URLs. |
| `inReplyTo`, `references` | Optional Message-ID and Message-ID array for reply threading. Header values cannot contain NUL/CR/LF. |
| `tags` | Optional string map; built-in Resend maps it to name/value tags. |
| `metadata` | Internal application metadata, not sent by the built-in Resend mapping. A custom provider receives the message and owns its mapping. |
| `idempotencyKey` | Optional stable provider request key; Resend forwards it. No local generic-send deduplication store is created. |
| `signal` | Optional AbortSignal, forwarded to the provider; custom providers must honor their declared cancellation contract. |

The result contains `provider`, `accepted: string[]`, optional `id` and optional
`rejected`. Accepted means the provider boundary accepted the attempt, not
delivery/read confirmation. Memory/no-op/console results do not mean real mail
was sent. Per-message strings should be valid application-owned values;
blank overrides do not request a fallback to environment configuration.

Headers/attachments are validated and snapshotted before asynchronous work;
mutating a caller's recipient array or attachment bytes cannot change the
message already admitted for sending. Invalid headers/attachments raise
`EMAIL_MESSAGE_INVALID`/400 before dispatch. Validation is not recipient
authorization or an HTML sanitizer.

With an explicitly configured IMAP Sent folder, `sentCopy` is `saved` or
`failed`. A failed copy never converts an accepted send into a failed delivery
or requests a duplicate send. Omitted means no copy was requested.

## Failure And Observability

`EmailError` exposes `code` and `status`. Missing sender is
`EMAIL_FROM_REQUIRED`/500; empty recipients, subject or body use
`EMAIL_RECIPIENT_REQUIRED`, `EMAIL_SUBJECT_REQUIRED`, `EMAIL_BODY_REQUIRED`/400.
Provider failures preserve an existing EmailError; other thrown values become
generic `EMAIL_SEND_FAILED`/502. Validation happens before provider dispatch.

Delivery uses `EMAIL_SEND_REQUESTED`, `EMAIL_SENT`, `EMAIL_SEND_FAILED` and optional
`EMAIL_SENT_COPY_FAILED` through
Zero's observability boundary. Metadata contains provider/count/status/code,
not body, recipients or credentials. Do not log a full message or put secrets
into custom provider errors. Provider idempotency/cancellation is not an
exactly-once local transaction.

SMTP has no provider idempotency guarantee. The auth outbox classifies SMTP
4xx replies as retryable and 5xx rejections as terminal; those reply numbers
must not be interpreted directly as HTTP statuses. Cancellation closes the
actual connection, but cannot recall mail the server already accepted.

## Security, Testing And Next Steps

Authorize application sends on the server before invoking the service. Do not
expose a raw recipient/content relay to anonymous callers. Tenant/user ownership
of a business operation does not itself authorize arbitrary email delivery.
Use MemoryEmailProvider and a fresh runtime for tests, inspecting synthetic
captured messages rather than invoking a real vendor.

- [Configuration](./configuration.md) defines captured defaults and app-local ownership.
- [Providers](./providers.md) explains vendor and test boundaries.
- [Auth outbox](./outbox.md) covers durable Guardian delivery, not arbitrary sends.
