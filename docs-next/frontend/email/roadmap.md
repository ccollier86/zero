---
id: zero.frontend.email.roadmap
type: roadmap
audience: [developer, agent, maintainer]
owner: email
status: draft
visibility: internal
system: email
feature: future-work
maturity: planned
---

# Email Inbox Roadmap

[Email UI index](./index.md) · [Documentation index](../../index.md)

The implemented baseline is folder/message email with rich composition,
attachments, revisioned drafts, SMTP acceptance recovery, safe HTML and IDLE
updates. The items below are separate additions, not hidden settings.

- Conversation view built from Message-ID, References and In-Reply-To. Current replies set those headers, but the reader does not group subjects into pretend threads.
- Provider account provisioning, credential administration, quotas and explicit mailbox grants. Current multi-account integration is a trusted server resolver, not a browser account-creation screen.
- Replica-to-replica draft notifications and a selectable ReactiveDB/Fabric state adapter. Current private SQLite revisions work across connections; live fanout belongs to one app runtime. Do not deploy isolated per-replica receipt databases and assume global idempotency.
- Provider Drafts synchronization. Current workspace Drafts are private to the Guardian principal; an existing IMAP Drafts folder is separately labeled as server mail.
- Bounded provider text previews/attachment indicators where metadata does not already supply them. The managed IMAP list currently uses envelope metadata, so it shows real recipients instead of inventing preview content or downloading every message body.
- Further browser-engine qualification, privacy-preserving image proxy and larger mail-client rendering corpus.
- Folder creation/rename, permanent deletion, server-side rules, scheduled sends, signatures, AI drafting and advanced contact lookup.

## Separate Messaging System

After the email review, build a separate conversation system using the supplied
double-sidebar reference and Zero's shared tokens, motion and primitives.
Email folders, SMTP acceptance and MIME rendering remain email-specific rather
than becoming a pretend chat transport.

The first messaging use case is an AI customer assistant reachable through a web
portal or Facebook Messenger, with explicit human takeover and handback. The
same components should support user-to-user conversations: an all-members
directory or contact requests in single tenancy, and organization-defined
directory, department and contact visibility in multi tenancy. Guardian owns
access decisions; external channel contacts do not automatically become app
users. Define channel delivery receipts, duplicate handling, routing, AI/human
ownership and realtime participant state before connecting real customers.

Following messaging qualification, add Square behind the payments facade, then
design the optional compliance-logging plugin with explicit audit guarantees.
These are follow-on implementations, not enabled email capabilities.

## Related guides and next steps

- [Configuration](./configuration.md) describes what can be enabled now.
- [Backend roadmap](../../backend/email/roadmap.md) owns transport and wider delivery work.
