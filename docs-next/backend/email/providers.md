---
id: zero.email.providers
type: reference
audience: [developer, agent]
owner: email
status: draft
visibility: internal
system: email
feature: provider-adapters
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

# Email Provider Adapters

[Email index](./index.md) · [Documentation index](../../index.md)

`EmailConfig.provider` accepts `'resend' | 'smtp' | 'console' | 'memory' | 'noop'`
or an `EmailProvider` object. Built-in classes and the interface are public
through `@zero/framework/email`.

## Built-In Providers

| Provider | Behavior |
| --- | --- |
| Resend | Posts the message to `<baseUrl>/emails`, using the captured API key and caller's signal/idempotency key. |
| SMTP | Uses the built-in TLS/STARTTLS SMTP transport. Captures settings, supports MIME/attachments and closes owned sockets on abort/stop. [Configuration](./smtp.md). |
| Memory | Captures `{ id, message, sentAt }` in the instance's public `messages` array, and exposes `clear()`. No network or durability. |
| Console | Emits `EMAIL_CONSOLE_PREVIEW` containing presence/count fields only. It does not print the body, secret action URL or recipient. |
| Noop | Returns accepted recipients without delivering or retaining a message. Disabled runtimes use this adapter. |

Choose a concrete MemoryEmailProvider instance when a test needs to inspect
captures; `provider: 'memory'` otherwise creates the instance during runtime
construction. Captured message content is intentionally available to trusted
tests/local callers. Do not treat it as a redacted audit store or expose it
through an unprotected endpoint.

Resend captures `apiKey` with nullish precedence and `baseUrl` when constructed.
`isConfigured()` checks that captured key is nonblank. A non-2xx response
becomes a generic EmailError: deterministic rejections are classified
`EMAIL_PROVIDER_REQUEST_REJECTED`, while other failures use `EMAIL_SEND_FAILED`.
The response body is not reflected to callers or logs. A successful HTTP response
without a valid vendor receipt is an uncertain send failure, not fabricated
acceptance.

The expanded send contract supports Cc/Bcc, reply threading and in-memory file
attachments through both production providers. Resend maps explicit attachment
`contentType` and inline `contentId` to its documented `content_type` and
`content_id` fields. Its content IDs must contain 1–127 characters. SMTP maps
these fields to MIME headers. Neither adapter reads arbitrary local file paths
or attachment URLs. [Resend send API](https://resend.com/docs/api-reference/emails/send-email)

Receiving is a separate [IMAP module](./mailbox.md), usable with either send
provider or a receive-only noop runtime. SMTP sending does not poll an inbox.

## Custom Provider Contract

```ts
import { createEmailRuntime, type EmailProvider } from '@zero/framework/email';

const localProvider: EmailProvider = {
  name: 'local-example',
  async send(message) {
    // Replace this synthetic result with your reviewed transport adapter.
    return {
      provider: 'local-example',
      accepted: Array.isArray(message.to) ? message.to : [message.to],
    };
  },
};

const runtime = createEmailRuntime({
  provider: localProvider,
  from: 'no-reply@example.test',
}, { name: 'Example' });
```

An adapter receives the complete resolved EmailMessage. It owns vendor mapping,
timeouts/cancellation, metadata policy and external credentials. Minimum
runtime readiness treats a custom object with a sender as ready; there is no
generic custom-provider credential probe. Report safe actionable failures,
not vendor payloads containing addresses or tokens.

## Verification And Related Guides

Test message mapping, accepted/rejected normalization, safe failure and abort
behavior with a synthetic transport. A local adapter test is not certification
of the vendor's delivery behavior.

- [Send contract](./service.md) applies validation and safe operational reporting.
- [Configuration](./configuration.md) details credential/default precedence.
- [Roadmap](./roadmap.md) separates prospective SMS/push from the implemented mail modules.
