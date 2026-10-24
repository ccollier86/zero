---
id: zero.email.smtp
type: tutorial
audience: [developer, agent, operator]
owner: email
status: draft
visibility: internal
system: email
feature: smtp-delivery
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

# SMTP Email Delivery

[Email index](./index.md) · [Configuration](./configuration.md)

Select `provider: 'smtp'` to send through a standard SMTP account instead of
Resend. The same `zero.email.send()` API, Guardian templates, account-action
outbox and observability apply. Zero includes the transport; applications do
not need to install Nodemailer or implement a custom provider.

## Enable SMTP

The generated starter and root app use the public `emailFromEnv()` helper.
For an existing app, use it in the normal app configuration:

```ts
import { emailFromEnv } from '@zero/framework/email';

// Inside createApp(...) or zero.config.ts:
email: emailFromEnv(),
```

Configure deployment secrets, not browser environment variables:

```dotenv
EMAIL_PROVIDER=smtp
EMAIL_FROM="Example <join@example.test>"
EMAIL_REPLY_TO=support@example.test
SMTP_HOST=smtp.purelymail.com
SMTP_PORT=465
SMTP_USER=join@example.test
SMTP_PASSWORD=replace-with-mailbox-app-password
```

Purelymail documents implicit TLS on port 465, or STARTTLS on port 587. Use
the complete mailbox address as the username; accounts with two-factor
authentication need an app password. The same settings work with Zero's SMTP
provider. [Purelymail technical setup](https://purelymail.com/docs/setup/technical)

`EMAIL_PROVIDER=smtp` explicitly selects SMTP even when a Resend key is also
present. Without an explicit selection, `emailFromEnv()` keeps Resend first
when its key exists, then selects SMTP when `SMTP_HOST` exists. `email: true`
still means Resend; it does not auto-detect SMTP. Set `email: false` or
`EMAIL_PROVIDER=false` to disable both sending and receiving.

## Explicit Configuration

Environment helpers are optional. The equivalent trusted server configuration
is:

```ts
email: {
  provider: 'smtp',
  from: 'Example <join@example.test>',
  replyTo: 'support@example.test',
  smtp: {
    host: 'smtp.purelymail.com',
    port: 465,
    auth: { user: Bun.env.SMTP_USER, pass: Bun.env.SMTP_PASSWORD },
    timeoutMs: 30_000,
  },
},
```

| Setting | Default and behavior |
| --- | --- |
| `host` | Required; omitted uses `SMTP_HOST`. Supply a hostname/IP, not a URL. |
| `port` | `SMTP_PORT`, otherwise 587; explicit implicit TLS without a port selects 465. |
| `secure` | `SMTP_SECURE`, otherwise inferred true for port 465. True means TLS from the first byte. |
| `requireTLS` | `SMTP_REQUIRE_TLS`, otherwise true. On a non-implicit connection, STARTTLS must succeed before authentication or sending. |
| `auth.user`, `auth.pass` | `SMTP_USER`, `SMTP_PASSWORD`. Configure both, or explicitly set `auth: false` for a trusted anonymous relay. |
| `tls.servername` | Optional certificate hostname for connections made through an IP/private endpoint. |
| `tls.ca` | Optional PEM string or nonempty PEM array for a private CA. Certificate validation stays enabled. |
| `timeoutMs` | Whole-operation deadline, default 30000; valid range 100–600000 ms. |

Explicit fields use nullish precedence over the matching environment variable.
An explicit empty password does not silently use an ambient password. Values
are captured when the app starts; restart through the normal lifecycle after
changing credentials. Disabling TLS is an explicit development-only opt-in,
reported by Doctor. There is no `rejectUnauthorized: false` option.

## Use the Email API

In an authorized server handler, send through its owning app's service:

```ts
const receipt = await zero.email.send({
  to: 'recipient@example.test',
  cc: 'copy@example.test',
  subject: 'Your report is ready',
  text: 'Your requested report is attached.',
  attachments: [{
    filename: 'report.csv',
    content: new TextEncoder().encode('name,total\nExample,42\n'),
    contentType: 'text/csv',
  }],
  signal: request.signal,
});
```

SMTP supports text/HTML, Unicode, To/Cc/Bcc, reply-to, in-memory attachments,
inline `contentId`, `inReplyTo`, and `references`. Bcc is part of the envelope,
not the visible message headers. Arbitrary paths and remote attachment URLs
are not accepted. Internal `metadata`, tags and idempotency correlation keys
are not inserted into the SMTP message. [Send contract](./service.md)

`accepted` and `rejected` reflect the actual SMTP envelope result, including
Cc/Bcc. Partial acceptance can succeed with rejected recipients. A successful
`id` is the MIME Message-ID, not a delivery/read receipt.

## Guardian Integration and Failure Policy

No Guardian-specific SMTP adapter or route change is required. Set the sender
and `app.publicUrl`, then use the existing verification, setup/reset, invitation
and MFA configuration. Keep the public URL aligned with the user-facing app;
SMTP credentials belong only on the server. Independent setup/reset lifetimes
remain `auth.accountEmails.accountSetupTokenTTL` and `passwordResetTokenTTL`.

SMTP reply numbers are not HTTP status codes. Temporary 4xx replies become
retryable `EMAIL_SEND_FAILED`/503; permanent 5xx replies become
`EMAIL_PROVIDER_REQUEST_REJECTED`/422. Network/TLS failures use a safe 502;
whole-operation timeouts use `EMAIL_DELIVERY_TIMEOUT`/504. Cancellation and
app shutdown close the real socket and reject owned work with
`EMAIL_DELIVERY_ABORTED`/503. Raw server replies and credentials are not logged.
An instance admits at most 16 concurrent operations; additional requests fail
with retryable `EMAIL_PROVIDER_BUSY`/503 rather than opening unbounded sockets.

Standard SMTP has no Resend-style idempotency key. An interrupted final
acknowledgment can be ambiguous: the server may already have accepted the
message. Guardian's durable outbox remains at-least-once delivery, not a promise
of exactly-once mail. Generic sends are not automatically queued or retried.
[Outbox delivery](./outbox.md)

## Optional Sent Copies and Receiving

Add the separate [IMAP module](./mailbox.md) for folders, incoming messages,
attachments, flags, drafts, moves and live updates. Setting
`email.imap.sentFolder` or `IMAP_SENT_FOLDER` also requests a best-effort copy
after a successful send. It is off by default: some mail servers already save
sent messages, so enabling it there can produce duplicate copies.

An accepted send stays successful if appending its copy fails. The receipt
reports `sentCopy: 'failed'` and Zero emits `EMAIL_SENT_COPY_FAILED`; do not
retry the outgoing email just to repair its Sent folder.

## Verify a Deployment

Run `zero doctor` to check required fields, secure configuration and Guardian
readiness without connecting or sending a probe. Configuration readiness is
not a network or sender-authorization check. A standalone `SmtpEmailProvider`
also exposes `verify({ signal? })` for an explicit connection/TLS/login check;
it does not test recipient delivery. Close a standalone provider/runtime when
its owner stops; managed apps do this automatically.

Deployment hosts must permit outbound TCP to the configured SMTP port. No
public inbound SMTP listener is created by Zero. Confirm sender/domain policy,
SPF/DKIM/DMARC and an authorized test recipient with your mail provider before
production delivery.

Implementation: `src/email/smtp-email-provider.ts`. Loopback protocol tests
cover TLS, STARTTLS refusal, authentication, MIME, partial rejection,
timeouts/cancellation and managed Guardian delivery. No live Purelymail account
or external recipient is used by those tests.
