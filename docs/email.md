# Email and attachments

Zero's server-side email service applies configured sender/reply-to defaults,
validates messages, delegates to a provider, and emits sanitized lifecycle
events. Auth/account messages use the same runtime. Existing messages without
attachments keep their existing behavior.

## Sending in-memory files

Use the public `@zero/framework/email` surface (also re-exported from
`@zero/framework/server`). The caller must authorize and load the exact private
file through Zero storage before sending; the email service does not authorize
patient records, render PDFs, read local files, or retrieve remote URLs.

```ts
import {
  getEmailRuntime,
  isEmailAttachmentDeliveryReady,
  type EmailAttachment,
} from '@zero/framework/email';

const runtime = getEmailRuntime();
if (!isEmailAttachmentDeliveryReady(runtime)) {
  throw new Error('Document email is not configured');
}

// authorizedPdfBytes comes from the caller's verified private storage read.
const attachment: EmailAttachment = {
  filename: 'patient-letter.pdf',
  content: authorizedPdfBytes,
  contentType: 'application/pdf',
};

await runtime.service.send({
  to: verifiedRecipient,
  subject: 'Your requested letter',
  text: approvedPlainText,
  html: approvedHtml,
  attachments: [attachment],
  idempotencyKey: durableAttemptKey,
  signal: attemptAbortSignal,
});
```

`EmailAttachment` accepts only `filename`, `content: Uint8Array`, and optional
`contentType`. `Buffer` and nonempty `Uint8Array` subviews are supported. Zero
copies the selected bytes and container before the asynchronous provider
boundary; modifying the caller's file afterward does not modify that attempt.
Shared byte buffers are rejected. No `path`, URL, encoded string, stream,
filesystem locator, or provider-side download option is accepted.

Limits and validation:

- At most **10 files**, totaling at most **25 MiB raw bytes** across the message.
  Base64 expansion and provider message/body limits may still reduce the usable
  size; a readiness check is not a guarantee of provider acceptance.
- Filenames must be 1–255 characters, with no surrounding whitespace, path
  separators, colon, control/format characters, or `.` / `..` path names.
- `contentType`, when supplied, is a media type such as `application/pdf`, not
  a header or a parameterized value such as `text/plain; charset=utf-8`.
- Empty files, malformed inputs, unsafe names/types, unknown attachment
  properties, and excessive size/count fail before any provider call.

Failures use safe `EmailError` codes without including filenames, bytes,
recipient addresses, or message bodies: `EMAIL_ATTACHMENT_INVALID` (400),
`EMAIL_ATTACHMENT_LIMIT_EXCEEDED` (413), and
`EMAIL_ATTACHMENTS_UNSUPPORTED` (400).

## Provider capability and readiness

`EmailProvider.supportsAttachments?: boolean` is an explicit opt-in. Existing
custom providers without it still send ordinary messages, but attached messages
fail closed before their `send` method runs. Providers must never silently drop
requested attachments.

- Resend supports attachments and maps verified bytes to base64 `content`,
  `filename`, and optional `content_type` in its send-email JSON. The provider
  request retains the existing abort signal and `Idempotency-Key`.
- Memory supports attachment capture for tests and copies bytes; it does not
  deliver mail. Console and noop reject nonempty attachment lists, including
  when called directly.
- `isEmailAttachmentDeliveryReady(runtime?)` requires enabled/configured email,
  a sender, and positive attachment support. It always returns false for memory,
  console, and noop, including those passed as custom objects. For a Resend
  instance it checks that instance's captured credential configuration.
- Other custom providers explicitly advertising support own their real
  credential/readiness contract. Implement and test their attachment transport
  before opting in. The helper does not perform a network health check.

Provider acceptance is not delivery, opening, or acknowledgement. Applications
must own durable delivery attempts, ambiguity handling, explicit consent/review,
idempotency keys, and any delivery-status webhooks. Do not automatically resend
an uncertain request or log sensitive email content.

Resend mapping follows its [send-email API](https://resend.com/docs/api-reference/emails/send-email),
[attachment guide](https://resend.com/docs/dashboard/emails/attachments), and
[official SDK API mapper](https://github.com/resend/resend-node/blob/main/src/common/utils/parse-email-to-api-options.ts).
