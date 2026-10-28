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
applies_to: ["Public visitor continuation; authenticated support is implemented on the feature branch"]
---

# Website And Customer-Portal Support Chat

[Working index](./index.md) · [Scope correction](./messaging-configuration-correction.md) · [Configuration](../backend/messaging/configuration.md) · [Implementation checkpoint](./messaging-backend-implementation.md)

## Corrected Ownership

Zero owns configurable conversations, contacts/directory modes, groups, internal
assistants, support ownership, files, typing and reactive UI. Facebook Messenger
was an application example, not an approved framework integration. Its prior
provider research must not become a Zero implementation or release gate.
Applications own third-party connectors; do not add provider credentials, SDKs,
webhook verification or delivery-window logic to Zero for that example.

The confirmed product is website/customer-portal chat: AI answers, AI hands the
same conversation to an authorized person, or the conversation starts directly
with human support. Email-to-conversation bridging was an incorrect inference,
not a messaging requirement or release gate. Email/inbox remains independent;
applications may compose it later without changing the core messaging contract.

Reuse Guardian, Fabric, the configured Zero AI gateway, Torrent, Storage,
notifications, logging and presence. Do not create a separate account system,
avatar status tracker or UI system. Third-party connectors remain app-owned.

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

## Direct Human Support And Escalation

Authenticated portal users use the same canonical support facade as the staff
workspace. A caller may select human-first support even if an assistant is
configured. A customer request for a human moves assistant ownership to triage
atomically and fences the old AI job; it never selects a staff ID, grants staff
membership, displaces an already assigned human or fabricates an accepted reply.

Authorized staff discover content-free queue entries and explicitly claim a
conversation before reading its private transcript. Queue updates are committed
projections; private-note activity is not broadcast to unjoined staff. Keep
unknown commands and their original request IDs available for reconciliation.

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
send reconciliation, customer escalation, direct-human admission, and full desktop/narrow
browser flows. Installed Linux/bundled-actor and normal archive/full-suite
qualification remain mandatory. Unit tests or visual fixtures are not a complete
product or provider-delivery proof.
