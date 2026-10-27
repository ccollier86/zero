---
id: zero.messaging.configuration
type: reference
audience: [developer, agent, operator]
owner: messaging
status: draft
visibility: internal
system: messaging
feature: configurable-messaging
maturity: experimental
applies_to: ["feature/messaging-backend correction; not a selected stable archive"]
---

# Configurable Messaging

[Messaging index](./index.md) · [Review](./review.md) · [Notifications](./notifications.md) · [Presence](../guardian/presence.md) · [UI parts](../../frontend/messaging/index.md)

One optional subsystem supports peer conversations, configured organizational
groups, internal assistants and support conversations. These can coexist; AI is
not synonymous with customer support. Facebook Messenger and other external
provider connectors are app-owned, not Zero configuration or release gates.

This is a feature-branch API reference. The source tests below do not make these
APIs available in an older archive with the same `2.6.0` version string. Public
visitor admission, email-backed support and final installed release qualification
are still separate gates. The branch's [self-wired workspace](../../frontend/messaging/workspace.md)
now uses this native facade.

## Directory And Tenancy

```ts
// Everyone in the admitted application/organization directory can initiate
// conversations. No artificial accepted-contact rows are created.
const messaging = { directory: 'everyone' as const };

// Alternatively, accepted contact requests are required for ordinary new chats.
const contactsMessaging = { directory: 'contacts' as const };
```

`everyone` is the default. `contacts.request/respond/block/unblock` and direct or
group conversations use the same canonical service. Blocks do not become browser
filters. In multi tenancy, the current Guardian organization selects the private
messaging database and directory. No query/header/body tenant selector is trusted,
and a platform administrator does not automatically gain private membership.

The admitted directory excludes unfinished provisioning, suspended/disabled and
other Guardian token-ineligible accounts. Exact display resolution is bounded
and uses current eligible scope membership; it exposes names and optional
published avatar URLs, never contact fields or a private avatar delivery grant.
`conversations.people(id)` returns the current admitted participant display page;
direct conversation pages may also contain optional `name`/`avatarUrl` on their
canonical participant entries. These are presentation, not authority.
`messages.get(conversationId, messageId)` supplies an authorized indexed point
read, including for exact accepted-receipt reconciliation. Leaving/rejoining
history policy and revocation still apply.

Native `messages.list`/live pages include the current authorized
`history: { from, revision, visibility }` boundary. The revision orders delayed
snapshots; changing the lower bound or staff/public timeline invalidates the
workspace's old cached view even if a remove/rejoin was coalesced. This is
metadata over existing canonical membership, not a new migration or grant.

The browser facade adds `watchContacts(listener, options)` alongside conversation
and message watches. It uses the same native, current-scope no-store projection,
bounded keyset page and owned cancellation; apps need not invent contact row
events or poll private tables. `MessagingLiveError` distinguishes retryable
transport failure from terminal permission/protocol invalidation. GET reconnect
never retries a mutation.

Single tenancy owns one private messaging Fabric database. Multi tenancy owns
one per admitted organization. SYSTEM retains ownership receipts, Storage owns
private bytes, and the existing logging subsystem owns its separate audit files
and workers. Disabling messaging does not delete retained files or outcomes.

## Ordinary And Configured Groups

Users create ordinary groups with `client.messaging.conversations.create` and
`kind: 'group'`. Their owner can add/remove participants, rename/archive, and
call `transferOwnership(id, expectedRevision, userId, mutationOptions)`. The old
owner becomes a member and can then leave with `removeParticipant`; the last
owner cannot be removed accidentally. Each mutation needs the current revision
and stable request identity.

A direct conversation remains private to its two participants. Use a new group
conversation to include additional people; `addParticipant` rejects expansion of
a direct conversation instead of silently exposing its prior private history.

Configured groups are optional and independent of contact requests:

```ts
const messaging = {
  directory: 'everyone' as const,
  groups: {
    team: { name: 'Everyone' },
    clinical: {
      name: 'Clinical team',
      members: { properties: { department: 'clinical' } },
      history: 'since-join' as const,
    },
  },
};
```

Declare `department` in Guardian with `editableBy: 'admin'` and
`useInPolicies: true`. The same Guardian requirements support roles, permissions
and trusted properties; this is not a second policy language. Omitted `members`
means all active eligible directory users in that scope. Ordinary groups remain
manually managed; configured groups are governed by configuration/Guardian and
reject manual membership/name edits.
Trusted user properties retain Guardian's existing account-level semantics.
Organization-specific rules can use current scope roles and permissions; this
feature does not invent a separate per-organization user-property store.

Configured groups appear in `conversations.list`, with `managedGroupId` set.
Membership, message sequences and read positions are canonical private Fabric
records. A current Guardian policy check is also required on every read/write,
typing admission, file operation and live projection: a delayed maintenance pass
cannot retain a withdrawn grant. Notifications narrow their fixed candidate
audience against current group eligibility.

Maintenance uses Guardian's durable authority revision, not invented row-change
events for its private composite-key property tables. It is cached, coalesces
committed wake hints, pages directory IDs in batches of 50, and yields between
pages outside SQL/auth leases. Unrelated ordinary direct messages do not wait
for a group reconciliation. There are at most 32 configured groups, each bounded
by `maxParticipants` (default/max 100); the current directory reconciliation
budget is 10,000 candidates. Exceeding a bound reports capacity, never silently
omits members. Large-directory optimization/qualification is not claimed.
An unchanged membership/configuration fingerprint does not create another
private write, receipt, audit transaction or live invalidation just because a
login/session advanced the shared Guardian authority clock.

`history: 'all'` allows eligible history; `since-join` excludes earlier messages
on first join and each rejoin. A revoked user cannot read while removed, and a
past read cursor/receipt is not renewed permission. Joining never records human
attention or advances the read cursor to the latest message.

## Internal Assistants Without Support

```ts
const messaging = {
  support: false as const,
  assistants: {
    knowledge: {
      name: 'Knowledge assistant',
      description: 'Internal questions for the clinical team',
      access: { properties: { department: 'clinical' } },
      model: 'smart',
      instructions: 'Answer from the available conversation. State uncertainty.',
    },
    writing: { name: 'Writing assistant', model: 'fast' },
  },
  jobs: { concurrency: 'max' as const },
};
```

The configured Zero AI service and Torrent must be enabled. Omitted access still
requires a currently admitted authenticated user in the current scope; it never
enables public access. At most 32 lowercase assistant IDs are supported. The
public directory exposes only ID/name/description, not model instructions,
credentials, policy internals or other users' conversations.

```ts
const bots = await client.messaging.assistants.list();
const openRequest = { requestId: crypto.randomUUID() };
const conversation = await client.messaging.assistants.open('writing', {}, openRequest);
const sendRequest = { requestId: crypto.randomUUID() };
await client.messaging.messages.send(conversation.id, { text: 'Help rewrite this heading.' }, sendRequest);
```

Retain the original request IDs while reconciling interrupted operations; do not
generate a new ID just because the connection failed. Request-scoped backend
`zero.messaging` exposes the same commands. A bot has its own participant identity,
such as `assistant:writing`, and is not a fabricated Guardian account. Its human
participant is an owner, not a customer. Multiple assistants have independent
identities, models and Guardian policies. Bot participation in ordinary group
conversations is not implemented by this slice.

Assistant identity/policy, public context revision, latest human turn and owner
epoch fence the durable job. Current user/organization/bot admission is checked
before generation and publication. Removing access during an actual provider
call prevents its reply from being published. Provider calls execute in the
existing concurrent Torrent work pool (default/max 100), not on SQLite/source
automation queues. No SQL/auth lease spans provider or audit network I/O.

The current assistant context is the bounded recent public text window (20
messages, at most 128 KiB). It excludes private staff notes and does not read
attachment contents, execute tools or perform RAG. Those require deliberate AI
capability integration; uploading a file is not evidence a model read it.

## Support Compatibility And Review

The existing `assistant: { model, instructions, ... }` configuration is retained
as the named `default` assistant. It no longer requires support. When support is
enabled, it remains the compatibility support assistant. Alternatively choose a
named bot explicitly with `support: { staff: requirement, assistant: 'help' }`.
`assistant: false` inside support disables support automation without disabling
the independent internal bot registry.

Support claim/handback/private-note/ownership protections remain intact. An
uncertain support generation goes to triage. An internal bot's failed/unknown
job is inspectable/resolvable only by that conversation's currently admitted
human owner, without requiring support staff authority. A new explicit human
turn can proceed; an uncertain old call is never automatically retried. Explicit
retry requires its current epoch/context and possible-duplicate acknowledgment;
old job/attempt outcomes are retained. See [review](./review.md).

## Presence And Presentation

Use the existing [Guardian availability service](../guardian/presence.md):
`auth.presence.enabled`, `client.presence`, `useGuardianPresence`,
`useAvatarPresence`, and `UserPresenceSettings`. It already supports automatic
Available/Idle/Away/Offline, manual Busy, optional On call/custom statuses and
tokenized avatar rings/dots/badges. One SDK tracker owns activity; each avatar
must not start another lease. Unknown/stale status must not look online.

The branch's conversation lists/headers now observe this existing feed by default
under the normal SDK provider. Rings follow circular/rounded/square avatar shape;
explicit dots/badges remain optional. Only Guardian user participants are mapped,
never assistant/visitor/group display IDs. Use `useMessagingPresence()` for custom
assemblies, or `livePresence={false}` for controlled-only presentation. See the
[frontend contract](../../frontend/messaging/index.md#guardian-presence-and-avatar-shape).
This does not add a second presence tracker or make same-scope directory presence
proof of contact/conversation access. Stale/retired feeds are omitted.

The branch's [managed workspace/controller](../../frontend/messaging/workspace.md)
wires canonical typing, private uploads/downloads, per-visibility drafts,
read-visibility policy and retained live/backfilled history. See its
[evidence and limits](../../_work/messaging-workspace-review.md). Source browser
integration is not a substitute for final installed Linux/worker/deployment
qualification or public visitor/email implementation.

## Migration And Qualification

Private migrations 006/007 add assistant identity and configured-group metadata;
001–005 and prior outcomes remain unchanged. Use the reviewed managed migration
boundary for retained development files, never reset/replace a private database
to bypass fingerprint or owner checks.

Native source integration covers distinct assistants without support, concurrent
real loopback calls and property revocation; automatic groups without contacts,
remove/rejoin history, and manual owner transfer. These join existing actual
Guardian/Fabric/Storage/Logging/Torrent/Sync tests. They do not replace the pending
multi-profile, browser, installed Linux/archive and full release qualification.
