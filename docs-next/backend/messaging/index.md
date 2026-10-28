---
id: zero.messaging
type: index
audience: [developer, agent, maintainer]
owner: messaging
status: draft
visibility: internal
system: messaging
feature: native-messaging
maturity: experimental
applies_to: ["2.6.0 native messaging candidate; identify installed support by commit/archive hash"]
---

# Messaging

[Backend index](../index.md) · [Messaging components and typing](../../frontend/messaging/index.md)

One optional messaging subsystem with a coherent Zero API. Contacts-based
apps, everyone-in-directory apps, tenant-local messaging, ordinary and
property-managed groups, internal assistants and support inboxes may coexist.
The supplied visual reference uses the existing AppShell sidebar, a conversation
sidebar and a main conversation area.

Facebook Messenger was an application-specific example, not a Zero feature.
Third-party provider connectors are application-owned and do not gate the
framework. [Native website/portal support](./website-support.md) has its own restricted admission.
Email-to-conversation bridging is not a messaging requirement or release gate.

[Configuration and facade](./configuration.md) · [Website support](./website-support.md) · [Review](./review.md) ·
[Notifications](./notifications.md) · [Guardian presence](../guardian/presence.md)

## Start Here

1. Read [configuration and facade](./configuration.md), choose `everyone` or
   `contacts`, and enable `messaging` in the existing Zero configuration. Disabled
   messaging opens no private messaging database or worker.
2. Put [MessagingWorkspace](../../frontend/messaging/workspace.md) inside the
   existing AppShell and common auth-enabled AppProvider. Do not create a second
   auth/Sync client, expose private tables or fabricate row-change events.
3. Use [Guardian presence](../guardian/presence.md) for human availability. It is
   separate from conversation permission, typing, read positions and AI activity.
4. Add [named assistants](./configuration.md#internal-assistants-without-support)
   only if wanted; they require Zero AI and Torrent. Add
   [website support](./website-support.md) only for a deliberately public entry.
5. Read [review/recovery](./review.md) and [notifications](./notifications.md)
   before connecting app-specific effects. An unknown outcome is not failure or
   permission to issue a fresh request ID.

The package version alone is insufficient: older archives also say `2.6.0`.
Record the selected updater commit and archive hash, and update client/server
together. The [qualification record](../../_work/messaging-workspace-review.md)
separates source, browser, installed-package and native process evidence.

## Implemented Boundaries

The native implementation supplies canonical Fabric persistence,
Guardian-bound native HTTP/SDK, committed live projections, private Storage
attachments, contacts/groups, read cursors, support ownership, concurrent
assistant jobs and duplicate-safe native notifications. Deployment qualification
and release selection are recorded separately; source availability is not proof
an older installed archive has this backend.

The branch now also supplies the [native managed workspace](../../frontend/messaging/workspace.md)
with real AppProvider/SDK browser checks, not just a styled mock. Its
[focused review](../../_work/messaging-workspace-review.md) distinguishes source
browser, package-import and remaining installed deployment evidence.

The [scope correction](../../_work/messaging-configuration-correction.md) removes
the support-only AI assumption. Named internal assistants now have independent
identities, Guardian policies and conversations; support need not be enabled.
Configured groups use current Guardian role/permission/trusted-property rules
and canonical membership. A delayed reconciliation cannot preserve revoked
history/file/typing access. Ordinary groups retain manual ownership/membership
and can transfer ownership before the old owner leaves.

| Layer | Native implementation | Boundary/limit |
| --- | --- | --- |
| Contacts/directory/tenant scope | Default everyone; optional contact requests/acceptance/blocks | Current Guardian scope; no cross-tenant directory or admin transcript bypass |
| Ordinary groups | Native mutations plus managed create/name/archive/member/owner controls | Revision-fenced; a private direct chat cannot be expanded silently |
| Configured groups | Declarative Guardian rules, reconciliation, remove/rejoin history | At most 32 groups, 100 members/group and 10,000 reconciliation candidates; excess fails visibly |
| Internal assistants | Named discovery/open, pinned jobs, native owner-review UI and canonical run activity; support independent | Group-bot participation, general tools/RAG and token streaming are outside this baseline |
| Typing/presence | Canonical transient typing and existing Guardian availability bound through AppProvider/workspace | No draft text, offline typing replay, invented online status or human-attention claim |
| Messages/files/notifications | Canonical receipts/history/private bytes, native live workspace and notice recovery | Private files; exact request identity and current access remain mandatory |
| Public website/portal support | Native widget, entry-routed staff admission, expiring visitor sessions, private files/typing, human/AI handoff, resolve/reopen | Exact same-origin entry; no cross-origin embed, email or third-party connector |

The [implementation checkpoint](../../_work/messaging-backend-implementation.md)
separates native source evidence from unfinished work. A feature-branch example
is not available in an older archive merely because both say `2.6.0`.

## Zero Service Integration

| Zero service | Messaging responsibility | Boundary that must remain intact |
| --- | --- | --- |
| Guardian | Actor, tenant, team and conversation admission; invitations, staff roles, takeover permissions | Browser participant IDs never confer authority; external contacts are not automatically Guardian users |
| ReactiveDB | Canonical conversations, membership, messages, edits, reactions, attachment references, read cursors and outbox | Tracked committed changes; stable sequence/keyset pagination; no direct browser writes bypassing the service |
| Fabric | Route each operation and subscription to its declared canonical realm; recover owner changes | No local SQL fallback to another realm; per-database serialized commits remain compatible with concurrent independent databases |
| Rooms and ephemeral Sync | Authorized participant activity, typing and connection cleanup | Presence is not membership, a message receipt, a durable audit or proof of a user's attention |
| Storage | Private staged bytes, quota/checksum/MIME admission, conversation attachments and authorized downloads | No binary blobs in chat rows, publicly guessed URLs, drive-wide tenant grants or client-selected ownership |
| AI | Trusted configured providers/models, Guardian restrictions, streams and cancellation; separately qualified BYOK when supported by the AI foundation | No provider SDK or key in the browser; routing judgments cannot replace authorization |
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
typing primitive; native messaging adds its canonical conversation policy.

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
handler. Use the additive [commit-acknowledged enqueue](../torrent/enqueue.md)
for both starts and resumes; an eager `torrent.start`/`deliverEvent` can itself
wait on initial activity execution. Await the enqueue receipt, then let the
source delivery finish. Native messaging uses this short handoff and bounded
concurrent work rather than holding the database queue through a model call.

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

Use the existing Zero AI provider/model selection, Guardian policy and cancellation
facades. The current implementation uses the configured platform gateway; do not
claim user/organization BYOK until that AI-foundation boundary is supported and qualified. Optional System One routing may suggest a queue or priority; code checks
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
email/external delivery, customer unread counts or default assistant context. Any
explicit staff-authorized AI use of notes requires a deliberate policy.
Shared sequence gaps or aggregate counts must not disclose hidden note activity.

The dashboard distinguishes accepted incoming messages, queued/running AI work,
committed replies, provider acceptance and actual supported delivery/read
receipts. Private-note acceptance, human takeover and stale-run suppression
have distinct durable outcomes. A component never invents a delivery/read receipt
that the native backend or an application-owned provider cannot establish.

## Support And Delivery

Authenticated support uses the managed Guardian facade. Public visitor
admission uses the [native website entry](./website-support.md). A visitor
receives a scoped expiring capability, not access to Guardian's internal
directory or app Sync. Current staff destination policy, canonical membership
and ownership epochs govern triage/claim/transfer/handback.

The entry can be AI-first, AI-to-human escalation or human-first. Accepted chat
state and human attention are distinct. Unknown sends retain their identity for
reconciliation/review. Reuse private Storage; never put private notes or upload
grants into a public conversation. Email/inbox is a separate subsystem, not a
required transport or threading bridge for these conversations.

External provider adapters belong to the application and must use supported
public facades rather than private SQL. No Facebook-specific SDK, webhook,
permission, reply-window or media behavior is part of Zero's completion target.

## API And UI Assembly

The request-scoped server/browser facade is `zero.messaging` /
`client.messaging`, with conversations, named assistants, messages, files,
contacts, review and support commands. See [configuration](./configuration.md).
Commands require stable operation IDs; reads and projections reauthorize after
async boundaries. Disabled messaging installs no runtime/worker. Stable archives
without the backend do not gain these APIs from documentation alone.

The organism composes independently documented parts: conversation sidebar,
directory/search, header/presence, transcript, date/unread separators, message
bubbles, reactions, attachments, activity, composer and takeover controls.
The existing AppShell remains the primary sidebar. Shared menus and modal
manager handle commands and confirmations; shared ScrollArea owns overflow.
Magnetic hover highlights belong in the conversation/contact/menu lists.

## Acceptance And Deployment

Use matching retained source/dependencies for explicitly configured source
actors when deploying the official bundled server. Actors use an empty child
environment plus explicit approved values; they must never boot the main app or
implicitly load dotenv/provider secrets. Source-to-bundle migration fingerprints
remain checked. Preserve retained database/Storage identities and receipts.

After an ungraceful main-process death, Torrent's normal 30-second ownership
lease can defer replacement startup. Supervision needs bounded backoff; do not
clear the lease, steal a live generation or weaken admission. Graceful stop
releases only its exact owned generation. An interrupted dispatched AI call goes
to review/triage, not an automatic duplicate provider request.

Required tests include same actor in multiple tabs, spoofed typing identity,
cross-tenant IDs, removed membership while subscribed, unauthorized contact
discovery, accepted-send replay, concurrent insertion/order, reconnect/backfill
scroll anchors, orphan blob recovery, attachment revocation, worker death,
stale AI reply after takeover, property revocation/rejoin, unknown delivery,
slow-reader backpressure, reduced motion, IME input, keyboard and narrow layouts.
Qualify actual file/hot/Fabric modes and fresh installed packages explicitly;
no synthetic fixture or visual screenshot proves a production channel is wired.

## Presentation Qualification And Deliberate Limits

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

The older presentation-only slice had no messaging migration or new private
database. Native messaging has additive private migrations and dedicated Fabric
files, with no production data changes performed by qualification. Enabling it
is deliberate; updating the package alone does not enable messaging. The payment,
SMTP/IMAP and email-inbox features retain their own opt-in configuration and
release/installation contracts.

The managed conversation search filters the current list page, not every
transcript. Group assistants, attachment-reading/RAG, general AI tools and
token-by-token output are outside this baseline. The only optional built-in
assistant tool is the bounded support human-handoff request. Presence/typing and
the visible-end read policy are not legal evidence of human comprehension.
Maximum-scale throughput, every browser/device lifecycle and production
application acceptance are separate qualifications, never inferred from a
synthetic screenshot or a passing unit test.
