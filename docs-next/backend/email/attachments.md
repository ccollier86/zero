---
id: zero.email.attachments
type: reference
audience: [developer, agent, operator]
owner: email
status: in-review
visibility: internal
system: email
feature: attachment-admission-and-readiness
maturity: supported
applies_to: ["2.6.0 builds containing the attachment capability compatibility fix"]
modes: [managed-server, standalone-server, Resend, SMTP]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "d378ed19c420556481795c4d5d070ee8e603f2cb"
  snapshot: dirty
  date: "2026-10-25"
  evidence_level: source-observed
---

# Email Attachments and Delivery Readiness

[Email index](./index.md) · [Documentation index](../../index.md)

Both Resend and SMTP support files through the same `EmailService.send()`
facade. Use `EmailAttachment` and `isEmailAttachmentDeliveryReady` from
`@zero/framework/email`; no application patch or direct vendor SDK is required.
This compatibility fix restores the capability/helper used by older custom
Zero attachment builds while retaining v2 Cc/Bcc, threading and inline files.
Identify the installed package by source commit and archive checksum, not the
`2.6.0` version number alone.

## File Contract

| Field or limit | Behavior |
| --- | --- |
| `filename` | Required, 1–255 characters. No leading/trailing whitespace, path separators, colon, `.`/`..`, control or Unicode format characters. Ordinary Unicode names remain valid. |
| `content` | Required `Uint8Array`, including a byte subview or zero-byte file. No string, URL, path, shared buffer or detached view. Only the supplied view's bytes are copied. |
| `contentType` | Optional concrete `type/subtype`, up to 127 characters. No wildcard, parameters, whitespace or header controls. |
| `contentId` | Optional inline ID, 1–998 visible ASCII characters. Resend further limits it to 127 characters before sending; SMTP maps it to MIME Content-ID. |
| Count | At most 100 files, preserving the v2 count contract. An empty array is equivalent to no attached files for capability admission. |
| Raw bytes | At most 25 MiB total per message, before base64/MIME encoding. This fixed framework limit is not a promise that every provider accepts the resulting message. Provider limits may be lower. |

Unknown attachment fields are rejected. Do not pass provider-specific `path`,
`href`, `url`, encodings or arbitrary MIME headers. Neither built-in transport
fetches an attachment URL or reads a local path. Byte arrays, attachment records
and their list are snapshotted before asynchronous work; later caller mutation
cannot change the admitted files.

## Check Capability Without Sending

This example is network-free and uses only a synthetic capture provider:

```ts
import {
  createEmailRuntime,
  isEmailAttachmentDeliveryReady,
  MemoryEmailProvider,
  type EmailAttachment,
} from '@zero/framework/email';

const provider = new MemoryEmailProvider();
const runtime = createEmailRuntime({
  provider,
  from: 'sender@example.test',
}, {});
const file: EmailAttachment = {
  filename: 'synthetic.pdf',
  content: new TextEncoder().encode('Synthetic test bytes'),
  contentType: 'application/pdf',
};

isEmailAttachmentDeliveryReady(runtime); // false: capture is not delivery.
await runtime.service.send({
  to: 'recipient@example.test',
  subject: 'Synthetic attachment',
  text: 'For a local test only.',
  attachments: [file],
});
```

Pass the owning runtime explicitly in managed apps. The no-argument helper is
a compatibility convenience and follows the existing unambiguous runtime
registry; it is not a way to select another app's provider.

Readiness requires an enabled runtime, configured sender and an explicit
`provider.supportsAttachments === true`. Known Resend and SMTP instances must
also report valid captured configuration. SMTP reports false after `close()`;
checking readiness never connects, authenticates or sends. Memory, console and
noop providers never report production attachment readiness, including when
passed as custom objects. Readiness is not provider acceptance or recipient
delivery confirmation.

## Custom Providers and Failures

A custom `EmailProvider` must explicitly declare `supportsAttachments: true`
only after implementing its file mapping and limits. Omission/false still
permits plain messages, but `EmailService` rejects attached sends before the
custom provider is called. Memory captures own file bytes for tests; console
and noop reject files rather than silently discarding them.

| Code | Status and handling |
| --- | --- |
| `EMAIL_ATTACHMENTS_UNSUPPORTED` | 400; the selected provider did not declare support. Correct configuration or choose another provider. |
| `EMAIL_ATTACHMENT_INVALID` | 400; unsafe filename, invalid bytes/type/ID or unsupported file fields. Do not log the supplied value. |
| `EMAIL_ATTACHMENT_LIMIT_EXCEEDED` | 413; too many files or too many aggregate raw bytes. Reduce the message. |
| `EMAIL_PROVIDER_REQUEST_REJECTED` | Provider-specific terminal refusal, including Resend's narrower inline-ID limit. |

Validation errors contain no filenames, recipient addresses, file bytes or raw
accessor errors. Do not retry deterministic admission failures. A transport
timeout can still mean acceptance is unknown: preserve the operation identity
and reconcile before another send. SMTP does not acquire Resend-style
idempotency merely because it uses the same Zero facade.

## Related Guides and Next Steps

- [Sending email](./service.md) defines the complete message and receipt contract.
- [Providers](./providers.md) covers real and development adapters.
- [SMTP](./smtp.md) covers TLS, credentials, cancellation and shutdown.
- [Upgrade](../../guides/upgrade.md) separates dependency installation from data migration.
