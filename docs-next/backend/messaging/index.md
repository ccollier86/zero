---
id: zero.messaging
type: architecture
audience: [developer, agent, maintainer]
owner: messaging
status: draft
visibility: internal
system: messaging
feature: integration-plan
maturity: planned
applies_to: ["2.6.0 presentation and room typing; complete messaging backend is planned"]
---

# Messaging Foundation And Integration Plan

[Backend index](../index.md) · [Messaging components and typing](../../frontend/messaging/index.md)

Build an optional Zero messaging subsystem with one coherent API, not a detached
chat widget. The supplied reference establishes an existing AppShell sidebar,
conversation sidebar and main conversation area. The first product is an AI
customer assistant reachable through a web portal and Facebook Messenger, with
explicit staff takeover. The same foundations must support user-to-user and
organization conversations without weakening their different admission rules.

## Implementation Status

The packaged foundation implements session-scoped room typing over the
existing authenticated ephemeral Sync transport, participant aggregation, activity
presentation, magnetic conversation list/header, message/composer/layout parts
and browser-safe presentation records.
It does not yet install messaging tables, expose `zero.messaging`, send messages,
upload attachments or connect an AI/Messenger provider. Storage references and
delivery labels in a presentation record are not evidence those operations ran.

The remaining backend is a complete-messaging release gate, not an application integration exercise
left to every consumer. Do not present the frontend parts as a complete messaging
product or build a production app against an invented SDK method.

| Layer | Current status | Required completion |
| --- | --- | --- |
| Typing | Implemented with real room authorization, transient Sync, server-relative freshness and browser lifecycle tests | Complete conversation-membership integration |
| UI parts | Implemented, tokenized, source-controlled with desktop/narrow browser tests | Managed controller, realtime history, delivery and attachment binding |
| Durable messages | Not implemented | Canonical ReactiveDB schema, scoped facade, accepted receipts and paging |
| Storage | Reference-only presentation contract | Managed staging, upload, attach, authorized download and safe cleanup |
| Contacts and teams | Not implemented | Guardian directory policies and accepted relationship commands |
| AI takeover | Display contract only | Durable ownership epoch, sealed workflow execution and stale-run fencing |
| External channels | Not implemented | Verified Messenger connection, ingress, outbox and real delivery receipts |

## Zero Service Integration

| Zero service | Messaging responsibility | Boundary that must remain intact |
| --- | --- | --- |
| Guardian | Actor, tenant, team and conversation admission; invitations, staff roles, takeover permissions | Browser participant IDs never confer authority; external contacts are not automatically Guardian users |
| ReactiveDB | Canonical conversations, membership, messages, edits, reactions, attachment references, read cursors and outbox | Tracked committed changes; stable sequence/keyset pagination; no direct browser writes bypassing the service |
| Fabric | Route each operation and subscription to its declared canonical realm; recover owner changes | No local SQL fallback to another realm; per-database serialized commits remain compatible with concurrent independent databases |
| Rooms and ephemeral Sync | Authorized participant activity, typing and connection cleanup | Presence is not membership, a message receipt, a durable audit or proof of a user's attention |
| Storage | Private staged bytes, quota/checksum/MIME admission, conversation attachments and authorized downloads | No binary blobs in chat rows, publicly guessed URLs, drive-wide tenant grants or client-selected ownership |
| AI | Existing configured providers/models, BYOK, Guardian restrictions, streams and cancellation | No provider SDK or key in the browser; routing judgments cannot replace authorization |
| Torrent and database automations | Durable AI/channel/notification jobs, retries, idempotency and recovery | No untracked fire-and-forget callbacks; no network calls inside SQLite commits |
| Notifications | Scoped unread alerts, mentions, assignments and customer/staff escalation | Explicit recipients and preferences; no disclosure to every tenant member by default |
| KV/cache | Optional bounded rate limits, capability caches and coalescing | Never the sole durable source of membership, ownership, accepted sends or read receipts |
| Functions and webhooks | Admitted public widget sessions and verified channel ingress | Signature verification over raw bounded bytes, connection-scoped tenant mapping and no arbitrary API proxy |
| Observability | Stable safe lifecycle/error codes and operational health | No message text, attachment content, prompts, raw tokens or customer details logged by default |
| Components and tokens | Shared AppShell, avatars, ScrollArea, magnetic highlights, menus, modals and file presentation | No cloned second design system, new auth client or alternate public/private theme switch |

## Canonical State And Realms

Choose the canonical data plane before installing tables. Conversation membership,
message sequencing, ownership epochs and accepted command receipts must commit
within one declared realm. Co-locate room authorization with that canonical
membership or implement a fail-closed, versioned authorization bridge. A delayed
room projection must not let a removed conversation member continue receiving
activity or content. Existing room membership is sufficient for the current
typing primitive; it is not a substitute for this future chat policy.

Do not assume system, application and Fabric databases participate in one SQLite
transaction. Use a committed outbox for cross-service projections and external
effects, with deterministic job identities and replayable receipts. The accepted
message and its outbound jobs belong to the same canonical transaction; blob
publication uses Storage's existing staged/publication recovery boundary.

Represent conversations, participants, messages, reactions, receipts, attachment
references, contact requests and channel deliveries explicitly. A participant
identity distinguishes Guardian user, external customer and assistant. A tenant
is always server-derived. Conversation identity alone is never permission.

Messages need stable IDs and monotonic conversation sequences. An operation ID
binds exact sender, conversation and normalized intent; replay returns the
original result. Concurrent inserts cannot erase history or renumber older
messages. Edits and deletions retain deliberate version/tombstone semantics.
History is paged by stable sequence, with an explicit policy for a late member's
access to earlier messages.

The frontend retains accepted rows during reactivity and only animates new rows.
When the reader is following the latest message, append and follow it. When
reading older history, preserve the scroll anchor and expose a new-message
affordance. Backfill prepends must preserve the visible message's position.
Unread counts and read cursors must not clear merely because a list mounted.

## Single And Multi Tenant Admission

Support explicit modes, rather than guessing from UI shape:

- Single-tenant all-members directory: any admitted app user can discover the
  configured directory and start an allowed conversation, subject to block/rate
  rules. This never implies public website access.
- Single-tenant contact requests: invitations, acceptance, rejection and blocking
  are durable commands. A display name or email match does not create a contact.
- Organization directory: visibility and initiation are controlled by current
  organization membership, department/team policy and explicit contacts.
  Platform admin does not silently become a member of every private conversation.
- Customer support: a scoped external customer can message the admitted inbox.
  Staff can triage, assign, transfer and take over according to declared roles.
  Internal notes must never be delivered to the customer channel.

Public widgets need an expiring server-issued customer/session capability bound
to an allowed site/connection, tenant and conversation. A public request cannot
choose staff roles, another tenant, a channel account or an existing customer
identity simply by submitting identifiers.

## Detailed Typing And Activity

The implemented `useConversationTyping(roomId)` uses the existing managed
`typing:<roomId>` topic. Guardian membership is checked server-side. Every tab
publishes a distinct `user:<verified-actor>:session:<random-session>` key;
normal input is throttled to 750ms, idle clears after 3500ms, and server TTL is
5000ms. Session TTLs are bounded to 1000–15000ms by the topic policy. Older
single-key room callers remain supported.

Publication and deletion use transient transport: nothing queues for replay
when offline. Reconnect requires current authority and new input. Unmount,
scope/conversation replacement, document hiding, window blur and page departure
retire activity. Multiple sessions aggregate into one displayed participant;
clearing one session cannot accidentally clear its sibling session's key.

Read identity from the server-attributed Sync envelope, not a client payload's
`userId`. Display names are presentation; use the admitted Guardian/contact
directory to supply authoritative labels and avatars. Ignore malformed, idle,
non-finite and far-future timestamps, hide the current user by default and
deduplicate sessions. Current typing envelopes carry server-measured age and
lifetime; receivers use local monotonic time to age them without comparing two
machines' wall clocks. Reconnect does not renew old activity. Legacy envelopes
retain their timestamp filter. Neither freshness nor local clocks are
authorization or evidence of message delivery.

`ConversationTypingIndicator` supports one/two/many participants, avatars, compact
or bubble presentation and distinct typing/recording/uploading labels. Dots use
reduced-motion-aware CSS and an atomic polite live region. The composer guards
IME composition and stops typing on submit or blur. The hook exposes stable
ephemeral errors instead of pretending publication was accepted.

Future recording/uploading publishers must be tied to real recorder/upload
lifecycles. Assistant queued/thinking/searching/responding/awaiting-human uses a
separate server run identity and ownership epoch. Do not animate a fake assistant
response or claim a recording exists because a timer fired. No draft text,
keystrokes, file names or customer message content belongs in typing payloads.

## Storage And Attachments

Create uploads through a conversation-scoped service command. It derives a
private drive/path, uploader, conversation and limits from current authority,
then uses Zero Storage's existing upload/publication mechanisms. The UI shows
actual progress, supports cancellation and presents staged/ready/failed states;
an unfinished upload cannot be sent as an accepted attachment.

Final attachment admission must verify the exact stored object identity,
checksum/version, ownership, quota, size/MIME policy and required scan status.
Attach only ready objects in the message commit. Do not accept arbitrary Storage
paths or public URLs from a message body. Use normal Storage metadata and binary
content handling, not base64 in message rows or browser durable state.

Every download/preview rechecks current conversation membership and Storage
authority. A revoked member loses access even if the message remains in a local
view. Short-lived capabilities must be narrow to the exact object/version and
not appear in durable message projections or logs. File controls should reuse
Zero previews and attachment presentation where appropriate.

Orphan staging cleanup is durable, bounded and reference-aware. A timeout alone
cannot delete a file already attached by a different successful retry. Preserve
accepted publication receipts across process death and distinguish a failed
preview/thumbnail from loss of the accepted message.

## AI And Human Ownership

### Durable Job Handoff

The source automation worker handles one delivery at a time per physical
database. Long AI work belongs in a Torrent activity, not inline in the source
handler. Use the branch-preview [commit-acknowledged enqueue](../torrent/enqueue.md)
for both starts and resumes; an eager `torrent.start`/`deliverEvent` can itself
wait on initial activity execution. Await the enqueue receipt, then let the
source delivery finish. This implementation does not make the planned messaging
backend available; it supplies the underlying short handoff contract.

Track the exact conversation/message, source sequence, workflow instance and
ownership epoch in the durable domain command. A retry keeps its original
identity. Re-read current conversation authority and eligibility before acting;
a captured event snapshot is context, not permanent permission to send later.

### Takeover And Publication Races

Conversation ownership is durable state, for example AI, human or triage, with
an increasing ownership epoch. Taking over must commit the new epoch and cancel
old work. An AI worker checks that epoch before generation, before emitting
customer-visible tokens and before committing or delivering its reply. Merely
aborting a browser stream does not fence a remote worker.

Use the existing Zero AI provider/model selection, BYOK, RBAC and cancellation
facades. Optional System One routing may suggest a queue or priority; code checks
the permitted action. Do not add a semantic model call when an explicit rule or
current database value answers the question. Provider failures, insufficient
context and routing uncertainty must remain distinct from an accepted answer.

Human takeover, assignment, transfer, internal notes, handback and escalation
need accepted command receipts. Staff and AI cannot both publish because they
read the same old boolean. A stale run may record its cancellation/outcome but
cannot reopen an AI-owned lane or overwrite a human response.

The final reply commit and its outbound job must compare the expected owner
epoch in the canonical conversation transaction. If takeover won that commit
race, the stale AI result cannot create a new accepted reply or send job. Sending
workers recheck current ownership before external dispatch. Cancellation cannot
unsend a provider request already accepted or retract tokens already delivered;
record and reconcile in-flight/unknown outcomes rather than relabeling them as
never sent. Human handback creates a new epoch, not permission to revive old work.

### Unread Counts And Private Notes

Store a monotonic per-participant read position with an idempotent accepted
command; multiple tabs/devices cannot move it backwards. Advance only through
authorized messages actually presented under the configured read policy, not
because a conversation list mounted, a background tab exists or an enqueue
receipt arrived. Derive counts server-side from eligible message visibility and
the admitted read position. Reconnect must reconcile authoritative counts and
cursor state; optimistic UI cannot permanently clear unread work.

Private staff notes are a separate visibility class, not a cosmetic bubble
style. Server queries, realtime payloads, counts, search, attachments, exports
and notifications all enforce that visibility. Notes never enter customer or
Messenger delivery, customer unread counts or default assistant context. Any
explicit staff-authorized AI use of notes requires a deliberate policy.
Shared sequence gaps or aggregate counts must not disclose hidden note activity.

The dashboard distinguishes accepted incoming messages, queued/running AI work,
committed replies, provider acceptance and actual supported delivery/read
receipts. Private-note acceptance, human takeover and stale-run suppression
need their own durable outcomes. These remain messaging backend acceptance
requirements, not guarantees supplied by today's presentation/typing components.

## Channels And Delivery

The web portal uses the managed authenticated/capability-scoped transport.
Messenger requires a server-owned verified connection and the provider's current
API/signature requirements before implementation. Map ingress IDs within that
connection and tenant; verify raw bounded webhook bytes before parsing or
admitting a durable inbox receipt. Provider-supplied user IDs are external
identities, not Guardian credentials.

Outbound delivery uses an idempotent durable outbox and the current ownership
epoch. Record provider acceptance separately from delivered/read acknowledgements.
Supported channel capabilities govern typing, files, edits and receipts; do not
simulate unsupported provider acknowledgements. Unknown network outcomes retain
their operation/provider correlation IDs rather than creating duplicate sends.
Resolve credentials on the server and never project them into UI configuration.

## API And UI Assembly

The intended server/browser facade is `zero.messaging` / `client.messaging`,
with conversations, participants, messages, attachments, contacts, receipts and
handoff commands. Those endpoints are not implemented in this slice. Define
closed typed operations, accepted receipts and live subscriptions before exposing
an SDK property. The optional subsystem should install nothing when disabled.

The organism should compose independently documented parts: conversation sidebar,
directory/search, header/presence, transcript, date/unread separators, message
bubbles, reactions, attachments, activity, composer and takeover controls.
The existing AppShell remains the primary sidebar. Shared menus and modal
manager handle commands and confirmations; shared ScrollArea owns overflow.
Magnetic hover highlights belong in the conversation/contact/menu lists.

## Implementation Order And Release Gates

1. Typing protocol, identity-safe aggregation, presentation records and reusable
   parts. This is the implemented first slice, not the full service.
2. Canonical realm/schema, Guardian conversation authority, directory/contact
   admission, durable message commands, paging and accepted receipts.
3. Managed HTTP/SDK and committed live projection; explicit scope replacement,
   reconnect, scroll continuity and read/unread semantics.
4. Zero Storage upload/attach/download/cleanup vertical slice, including crash
   recovery and revocation during upload/download.
5. AI execution and human takeover with ownership fences, durable workflow jobs,
   notifications and safe observability.
6. Verified Messenger ingress/outbox and channel capability differences.
7. Full organism/browser/accessibility polish and installed-archive qualification,
   then reviewed merge. Square and the planned
   [configurable core logging system](../../_work/logging-system-plan.md) follow
   this work; logging is no longer planned as a separate compliance plugin.

Required tests include same actor in multiple tabs, spoofed typing identity,
cross-tenant IDs, removed membership while subscribed, unauthorized contact
discovery, accepted-send replay, concurrent insertion/order, reconnect/backfill
scroll anchors, orphan blob recovery, attachment revocation, worker death,
stale AI reply after takeover, webhook duplicate/reordering, unknown delivery,
slow-reader backpressure, reduced motion, IME input, keyboard and narrow layouts.
Qualify actual file/hot/Fabric modes and fresh installed packages explicitly;
no synthetic fixture or visual screenshot proves a production channel is wired.

## First Slice Qualification

The component/browser fixtures contain synthetic, non-sensitive data and block
external network requests. Browser qualification covers one shared desktop/mobile
tree, both themes, independent ScrollAreas, magnetic hover/focus, retaining keyed
message nodes, composition input, upload gating, reduced motion, per-tab keys,
750ms throttling/3500ms idle cleanup, offline publication, privacy and stale
callback rejection. Policy tests use the actual ephemeral channel and managed
room/tenant authorization, not a browser mock as an authorization proof.

The review adds SSR-safe hooks, forced current-connection admission retry,
server-relative freshness, monotonic throttling, stale fanout rejection and
public props/facade checks. The installed-archive qualification checks exact
packaged sources, types/styles, public import aliases, browser isolation and
the real hook under AppProvider's SSR fallback. None of those checks claim a
durable messaging backend or external channel is running.

This slice deliberately has no messaging migration, new private database or
production data changes. Updating the package exposes the documented parts
without provisioning an unfinished messaging subsystem. The merged payment,
SMTP/IMAP and email-inbox features retain their own opt-in configuration and
release/installation contracts.
