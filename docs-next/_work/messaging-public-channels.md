---
id: zero.work.messaging-public-channels
type: roadmap
audience: [developer, agent, maintainer]
owner: messaging
status: draft
visibility: internal
system: messaging
feature: public-support
maturity: planned
applies_to: ["Planning only; not an implemented public visitor or email adapter"]
---

# Public Support And Native Email Continuation

[Working index](./index.md) · [Scope correction](./messaging-configuration-correction.md) · [Configuration](../backend/messaging/configuration.md) · [Implementation checkpoint](./messaging-backend-implementation.md)

## Corrected Ownership

Zero owns configurable conversations, contacts/directory modes, groups, internal
assistants, support ownership, files, typing and reactive UI. Facebook Messenger
was an application example, not an approved framework integration. Its prior
provider research must not become a Zero implementation or release gate.
Applications own third-party connectors; do not add provider credentials, SDKs,
webhook verification or delivery-window logic to Zero for that example.

Public support and optional native email-backed conversations remain framework
work. Reuse Guardian, Fabric, the configured Zero AI gateway, Torrent, existing
SMTP/Resend/IMAP services, Storage, notifications, logging and presence. Do not
create a separate messaging auth, email stack, avatar status tracker or UI system.

## Public Visitor Admission

A visitor is not automatically a Guardian user. A configured support entry pins
one application/tenant scope and allowed site/origin server-side. Issue a random,
expiring session capability bound to that entry, visitor and conversation; retain
only its hash in private storage. A browser-supplied ID, tenant or staff flag is
not authority. Missing/disabled entries never provision an organization.

The adapter may admit only its own public history, send/read positions, files
and transient activity. It must not grant the internal directory, contacts,
private notes, staff controls, unrelated conversations, general app Sync or
another entry. Recheck expiry/revocation/current policy after every asynchronous
history/file release boundary and on live reconnect.

Prefer a narrow same-origin Secure/HttpOnly cookie with explicit origin/CSRF
checks. Cross-origin embedding needs a deliberate allowed-origin and browser
credential strategy; no bearer material in URLs or default durable localStorage.
Define bounded sessions, streams, message/file sizes and publication rates.
Ordinary private strict audit admission must not be globally relaxed to admit a
visitor. Sign-in/health/recovery remain reachable through their normal policies.

## Authorized Human Destinations

Support entry configuration selects a permitted inbox/team or Guardian
role/permission/trusted-property requirement. It must not grant every employee
all transcripts. Claim/assignment/transfer/handback changes canonical membership
and ownership epochs. Staff notes and attachments never enter the visitor's
history, search, unread counts, notification text or default assistant context.

AI and humans share the existing fenced workflow boundary. A new turn,
ownership change or policy withdrawal prevents stale publication even if a
remote call ignores cancellation. Uncertain effects retain their identity and
require reconciliation/review, not an automatic resend or overwritten outcome.

## Native Email Association

Optional email-backed support must use Zero's actual configured email/inbox
services. Link admitted mailbox/conversation and received-message identities
server-side, preserve native email receipt/dedup semantics, and do not infer
thread identity from subject text or a client-selected sender address.
Provider acceptance, mailbox receipt and human attention remain different facts.

Attachments use the existing private Storage pipeline and declared limits.
Untrusted HTML is rendered through the existing isolated email viewer, not
inserted into the messaging document. Private notes never become reply bodies.
Unknown sends must use native email reconciliation or explicit review; an
accepted chat row alone is not evidence an email was delivered.

## Managed Workspace And Acceptance

Compose the existing AppShell, messaging list/header/transcript/composer,
ScrollArea, magnetic highlights, avatars/status decoration, menus and modal
manager. The shared facade controls real history, files, typing, unread/read
visibility and ownership. Bind Guardian presence with the existing fresh-status
hooks, not a second activity service.

Preserve accepted keyed messages, scope replacement, optimistic-intent identity,
backfill scroll anchors and the reader's position when new messages arrive.
Real server/job state supplies AI activity. Do not clear unread counts because a
sidebar mounted or display unsupported delivered/read acknowledgments.

Required gates: capability/origin/CSRF isolation, expired/revoked/reconnected
visitors, no tenant/identity spoofing, contacts/group/assistant scope isolation,
private-note/file non-disclosure, current authorized human routing, duplicate
ingress/send reconciliation, real native email loopback, and full desktop/narrow
browser flows. Installed Linux/bundled-actor and normal archive/full-suite
qualification remain mandatory. Unit tests or visual fixtures are not a complete
product or provider-delivery proof.
