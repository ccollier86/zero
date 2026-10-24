---
id: zero.frontend.email.configuration
type: how-to
audience: [developer, agent, operator]
owner: email
status: draft
visibility: internal
system: email
feature: configuration
maturity: preview
applies_to: ["2.6.0 main source with the optional email inbox; identify saved packages by commit and hash"]
modes: [browser, managed-server, Guardian-single, Guardian-multi-custom-adapter]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "7aa638f3d1ad7a66f1856ab0ae2b666b8c45f080"
  snapshot: dirty
  date: "2026-10-23"
  evidence_level: source-observed
---

# Configure the Email Inbox

[Email UI index](./index.md) · [Documentation index](../../index.md)

Enable the server bridge explicitly, then render the workspace under the app's
existing AppProvider. SMTP/IMAP configuration alone does not mount browser inbox
routes. Use HTTPS in production; loopback development is also a secure browser
context for the editor's operation identifiers.

## Server setup

This configuration fragment uses environment-backed standard transports:

```ts
import type { EmailConfig } from '@zero/framework/email';

export const email = {
  provider: 'smtp',
  from: 'Support <support@example.com>',
  smtp: {}, // SMTP_* environment variables; TLS required by default
  imap: { sentFolder: 'Sent' }, // Confirm the real provider folder path.
  inbox: {
    statePath: './.zero/private/email.sqlite',
    label: 'Support mailbox',
    // access defaults to platform admin, not every signed-in user.
  },
} satisfies EmailConfig;

// Supply email alongside the app's existing tables, auth and other createApp settings.
```

The state file is a dedicated private SQLite database for drafts and send
receipts. Keep it outside public assets, app sources and served storage. No
existing application or Guardian schema migration is required. It must persist
across restarts: losing send receipts can lose duplicate-send protection.
The full settings, multi-tenant resolver and deployment rules live in the
[backend inbox guide](../../backend/email/inbox.md).

## Page setup

Under the app's existing AppProvider/AppShell layout:

```tsx
import { EmailInbox } from '@zero/framework/email-inbox';

export default function InboxPage() {
  return <EmailInbox />;
}
```

Use AppShell's workspace content mode and a bounded flex region with
`min-height: 0`. A containing flex column can place other controls above the
inbox; the inbox fills the remaining space. Do not give its children a second
page-level scroll owner. Include Zero's normal application stylesheet; the
family CSS is also included by its component import for a custom build.

`mailboxSwitcher={false}` hides the switcher when the host provides account
navigation elsewhere. `resizable={false}` keeps the responsive pane layout but
disables desktop resizing. `markSeenOnOpen={false}` makes reading manual-only;
list reads and prefetch never mark mail seen.

## Custom backend

```tsx
import { EmailInbox, type EmailInboxSource } from '@zero/framework/email-inbox';

export function CustomInbox({ source, scopeKey }: {
  source: EmailInboxSource;
  scopeKey: string;
}) {
  return <EmailInbox source={source} scopeKey={scopeKey} />;
}
```

The app supplies an authorized, stable source object and changes `scopeKey`
before replacing its user/organization/account authority. Outside AppProvider
the key is required. Inside AppProvider it is additive to Guardian's automatic
boundary, not a way to bypass session readiness or retirement. The source never consists of raw IMAP credentials or
browser-selected hostnames. Read the [adapter contract](./source.md) before
building one; it includes cancellation and uncertain-send recovery obligations.

## Related guides and next steps

- [SMTP setup](../../backend/email/smtp.md) covers provider credentials and TLS.
- [Receiving](../../backend/email/mailbox.md) covers IMAP capabilities and special-use folder discovery.
- [Workspace behavior](./workspace.md) documents default actions and draft recovery.
