---
id: zero.work.messaging-public-channels
type: roadmap
audience: [developer, agent, maintainer]
owner: messaging
status: draft
visibility: internal
system: messaging
feature: public-channels
maturity: planned
applies_to: ["Implementation design only; not an available API or selected release"]
---

# Public Customer And Messenger Delivery Boundary

[Working index](./index.md) · [Messaging checkpoint](./messaging-backend-implementation.md) · [Messaging architecture](../backend/messaging/index.md)

Finish the qualified blog/logging update and native messaging delivery/recovery
before these adapters. This plan records concrete remaining work, not a claim
that a configured provider, UI label, passing unit or signed HTTP request proves
end-to-end customer delivery. No live Meta app, Page, account or credentials are
used by framework qualification.

## Shared Canonical Core

Guardian user conversations, customer support, a public website and external
channels must use the same private Fabric conversations, membership, message
sequence, intent receipts, attachment ownership, support epoch and durable jobs.
Do not put transcript into SYSTEM, workflow input/output, operational metadata,
notification bodies or generic Sync tables. Each admitted organization retains
its own canonical messaging file; a public connection pins its scope server-side.

Public visitors are not automatically Guardian accounts. A server-issued,
expiring connection/customer/conversation capability admits only its own public
history, send/read position, attachment and transient-activity operations.
It never admits `/sync`, app tables, directory, contacts, private notes, staff
operations or another connection. No body/query tenant or actor is authority.

The existing Guardian-native facade remains unchanged. Public transport may
reuse the closed domain commands and ephemeral manager, but must use a separate
capability adapter instead of fabricating a Guardian user/session. The app owns
whether a connection is public, account-required or disabled. Strict private
audit admission and machine/webhook authority must not be globally relaxed.

## Public Website Session Lifecycle

- Optional managed connection configuration pins allowed origins and one data
  scope. Missing/disabled connections fail closed and do not provision a tenant.
- Random high-entropy session material is issued server-side; persist only its
  hash and canonical session/customer/conversation/expiry/revocation binding in
  private state. A client-generated visitor ID is not identity proof.
- Default same-origin operation can use a narrow Secure/HttpOnly cookie with
  explicit origin/CSRF protection for mutations. Cross-origin embedding needs
  an explicit allowed origin and a documented third-party-cookie/token lifetime
  strategy. Never put credentials in URLs or pretend refresh preserves a
  visitor when the browser discarded the session. No default localStorage.
- Check expiry/revocation/connection policy inside every canonical read/write,
  and after yielding before releasing history or attachment bytes. Exact
  accepted intent replay still requires current capability/membership.
- Fetch-based SSE carries authorized bounded projections. Reconnect is a read,
  not resubmission. Errors retire retained content. The public activity adapter
  uses short-lived actor/tab keys with the existing ephemeral primitives, not
  durable keystrokes or a spoofed Guardian websocket.
- Enforce bounded sessions/conversations, bytes, active streams and publication
  rates. Any rate key derived from a network address is pseudonymous and never
  operational metadata. Cache/rate state does not establish authority.

## Meta Contract Evidence

On 2026-10-27 the direct Messenger/webhook/reference documentation still returned
HTTP 429. Meta's own
[Messenger Postman collection](https://www.postman.com/meta/messenger-platform-api/folder/vilwbh4/send-api)
documents Page-token/task permission prerequisites and the ordinary 24-hour
customer-reply window. Its
[published collection source](https://github.com/fbsamples/messenger-platform-samples/blob/main/postman/messenger-platform-api.postman_collection.json)
provides versioned Page send requests, text/media shapes and sender actions.
Meta's
[business-messaging reference security guide](https://github.com/fbsamples/business-messaging-sample-tech-provider-app/blob/main/CONTRIBUTING.md#webhook-verification)
requires signed webhook verification and server-only secrets. These are primary
sources, not proof of every current Messenger entitlement, payload or limit.

Keep the Graph version explicit and verify its supported lifetime. Do not infer
current Messenger text limits, tags, outside-window automation permission,
idempotent send retries, attachment behavior or metadata echo guarantees from
another provider or an old SDK default. Do not copy samples which log payloads
or place credentials in query strings.

## Messenger Admission And Ingress

One Meta app callback may receive entries for multiple Pages. Group configured
Pages under their owning app/secret/verification handshake, then map each
verified Page to exactly one enabled Zero connection and fixed scope. A
connection cannot be selected by untrusted tenant/contact fields. Reject
ambiguous Page ownership at configuration admission.

GET verification compares the configured secret and returns only the bounded
challenge. POST uses bounded raw bytes with `parse: 'none'`, constant-time
signature verification before parsing and explicit matching app/Page routing.
No headers, raw URLs, secrets, transcript or provider payload is logged.
Unknown signed Pages are not auto-provisioned into an organization.

Persist a permanent connection/event identity and normalized intent digest in
the same canonical transaction as the inbound message and resulting jobs.
Duplicate callbacks cannot reopen the reply window, add another row, invoke AI
again or repeat an attachment fetch. Contradictory reuse is a safe conflict.
Echoes must not become new customer messages. Delivery/read callbacks require
their actual provider identifiers and declared semantics; native persistence,
provider acceptance and customer attention remain different facts.

Provider-scoped customer identity stays private and connection-bound. Do not
merge people across Pages or platforms by display name/email. Reopening an
archived support thread needs an explicit owner/triage policy, not an implicit
assistant takeover of a conversation previously owned by a person.

## Ordered Outbound Effects And Uncertainty

No provider call runs on a database automation queue or within SQL/auth locks.
Short permanent starts feed Torrent activities/work pools. Independent
conversations run concurrently; only the external delivery order within one
conversation is constrained. Hash-order job scanning alone cannot promise
message order.

The source retains accepted outbound intent, current ownership/context binding,
invocation boundary and received provider result before finalization. Check
owner/turn/policy and the provider reply window before each dispatch. A newer
turn or human takeover fences stale assistant output even if cancellation is
ignored. A remote request already accepted cannot be retroactively unsent.

Native notification receiver receipts do not make Meta sends idempotent.
Timeout/crash after admission without a known result requires reconciliation or
manual review, never an automatic resend. A later success cannot rewrite an old
failed/unknown workflow or attempt. A provider echo is usable for reconciliation
only when the verified protocol carries an unambiguous owned identity; never
match by similar text or timestamp.

Long replies need a deliberate validated chunk protocol or an explicit limit.
If chunking is supported, persist each ordered part and its real provider
acceptance; partial acceptance must not become whole-message delivery. Stop
later parts after an uncertain part. Do not silently truncate an AI answer or
claim unsupported edit/delete/reaction operations updated the remote channel.

Media must use private Storage, bounded checksummed streams and current
conversation authorization. External URLs require actual SSRF-safe provider
admission, including redirects/DNS/size limits. Do not fetch arbitrary customer
URLs or invent public drive grants so a provider can download private content.
Unsupported capabilities must be visible and typed, not decorative controls.

## Review And Workspace

Extend the native review boundary deliberately for normal-chat notification and
external-delivery recovery as well as support AI. Do not require private SQL,
grant a global admin every transcript, or overwrite an unknown original job.
Known native receiver acceptance can be reconciled without a new destination
effect. A fresh externally uncertain send requires explicit current-owner review
and preserves the old outcome. Define how unresolved earlier channel work gates
later messages in that conversation.

The self-wired workspace composes the existing AppShell plus conversation rail
and thread. Preserve keyed messages during live updates, page history without
losing scroll anchors, mark read only for actually visible foreground content,
and distinguish queued/saved/provider-accepted/read/partial/unknown states.
Native typing, attachments, current-owner takeover and review controls must use
the real SDK. A fake animation is not evidence an AI/tool/provider is running.

## Acceptance Before Release

1. Guardian/native and public capability isolation across users, organizations,
   connections, expired/revoked sessions, history boundaries and private notes.
2. Whole browser session: first open, retained refresh where configured, send,
   live reply, history/backfill, attachment, typing, takeover and recovery.
3. Signed native HTTP ingress, duplicate/conflicting callback, multiple Pages,
   unknown Page/scope, echo exclusion, window expiry and provider uncertainty.
4. Actual loopback provider transport with source-committed starts, concurrent
   independent conversations, ordered parts, process death/restart and no
   duplicate send after an unknown outcome.
5. Operator review for supported native/channel kinds without transcript or
   authority expansion; preserved earlier failure and exact resolution replay.
6. Source setup → matching installed official Linux bundle/restart, empty child
   environment, source/migration parity, normal updater and complete suite.
7. Safe observability/evidence inspection proves credentials, visitor tokens,
   payloads, contact details, drafts and generated replies stay out of logs.

These are unfinished gates. No public customer or Messenger adapter is marked
supported merely because this plan or its private table placeholders exist.
