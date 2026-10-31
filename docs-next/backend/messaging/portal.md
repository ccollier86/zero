---
id: zero.messaging.portal
type: how-to
audience: [developer, agent, maintainer]
owner: messaging
status: draft
visibility: internal
system: messaging
feature: authenticated-portal-messaging
maturity: experimental
applies_to: ["feature/messaging-portal; not included in the published 2.8.0 archive"]
---

# Members Message The Team

[Messaging](./index.md) · [Configuration and API](./configuration.md) · [Native workspace](../../frontend/messaging/workspace.md) · [Anonymous website support](./website-support.md)

This optional mode is for any application whose ordinary members should message
authorized operators rather than discover or contact each other. Customer,
client, student and patient portals are examples, not separate implementations.
It uses existing Guardian accounts and support conversations, not another login
system, a second messaging backend or an email bridge.

This feature is on `feature/messaging-portal`. The released `2.8.0` archive does
not contain the new configuration or API fields. Update client and server from
the same qualified release when this branch is released; source availability
alone does not make an existing `zero-update` installation support it.

## Smallest Configuration

Add this to the existing Zero configuration without replacing its auth settings:

```ts
messaging: { portal: true }
```

This enables the native support inbox. In single tenancy the default operators
are current administrators; in multi tenancy the existing default requires
`tenant.members:manage` in the current organization. Set `support.staff` to a
declared Guardian role, permission or policy-trusted property to admit other
authorized operators instead. It is an explicit requirement, not an implicit
administrator bypass of your custom policy.

Ordinary members can start a private conversation and talk to its assigned
operator. They cannot search the user directory, request/accept contacts, create
peer/group chats, add participants or open internal assistant conversations.
These restrictions apply to native HTTP, the SDK, request-scoped `zero.messaging`,
files, typing and live projections—not just the visible controls.

Operators retain their existing workspace, staff queue, claim/takeover, private
notes and current-owner reply protection. Being an operator does **not** grant
all transcripts: an explicit claim admits the staff member to that conversation.
New operator-to-operator peer chats remain available; portal members cannot be
added as peer-chat recipients as a way around the routed inbox.

`portal` defaults to `false`. Existing everyone/contact deployments do not change
unless they enable it. `messaging: false` still disables messaging. An explicit
`support: false` with `portal: true` is rejected rather than leaving members with
an unprotected or unusable substitute.

## Named Destinations

Use named authenticated inboxes when messages need to reach different teams:

```ts
messaging: {
  portal: true,
  support: {
    defaultInbox: 'team',
    inboxes: {
      team: { title: 'Our team' },
      billing: {
        title: 'Billing',
        staff: { properties: { department: 'billing' } },
      },
    },
  },
}
```

Declare `department` in the existing Guardian `auth.userProperties` configuration
with `editableBy: 'admin'` and `useInPolicies: true`. Inbox `staff` **narrows**
global `support.staff`; it cannot promote an ordinary member. Optional inbox
`access` restricts who may open and continue reading that destination, using the
same Guardian requirements. Omitted `access` admits current eligible users in
the current scope, never anonymous users.

To admit authorized non-administrators, for example, declare a trusted
`supportOperator` property with those same restrictions and select
`support.staff: { properties: { supportOperator: 'yes' } }`. Assign it through
Guardian's administrator user-property tools to each intended operator,
including any administrator who should handle messages. Do not use self-editable
profile fields as authorization. Trusted property changes retain Guardian's
session revocation rules; they do not silently update an old token's authority.

Guardian roles and permissions are preferable for organization-specific
operator rules. Existing trusted user properties are account-level, not an
invented per-organization property store. The current organization still bounds
all inboxes, directories, conversations, files and notifications.

One inbox automatically becomes the default. With multiple inboxes,
`defaultInbox` is optional, but an omitted destination is rejected if no default
was configured. A denied default is never silently replaced by another inbox.
The native chooser lists the currently admitted alternatives.

There are at most 32 combined authenticated inboxes and anonymous public entries.
Their lowercase names must be unique. Anonymous `support.entries` and
authenticated `support.inboxes` have different admission; a member cannot pass
a website entry name, user ID, tenant ID or staff ID as a destination.

## Same Public Facade

```ts
const destinations = await client.messaging.support.inboxes();
// Safe descriptors: id, title, canOpen, canHandle, assistant, default.
// No private policy definitions or operator directory is returned.

const request = { requestId: crypto.randomUUID() }; // retain for reconciliation
const chat = await client.messaging.support.open(
  { inboxId: 'billing', mode: 'human' }, request,
);
await client.messaging.messages.send(chat.id, { text: 'A question for Billing' }, {
  requestId: crypto.randomUUID(), // a different deliberate operation
});

// Staff: scoped metadata first, explicit claim before transcript access.
const waiting = await client.messaging.support.queue({
  inboxId: 'billing', owner: 'triage', limit: 25,
});
```

Request-scoped backend `zero.messaging` exposes the same commands. Use
`watchSupportQueue` for reactive staff discovery and the normal conversation and
message watches for replies. Filtered queue cursors are bound to both inbox and
owner filter; reset pagination when either changes. Queue rows contain safe
inbox IDs, ownership and creation metadata, not customer message text. An
admitted conversation adds optional `inboxId` and `inboxTitle` display fields.

The native `MessagingWorkspace` automatically uses server capabilities. A
portal member gets a labeled **New message** action and approved destinations,
not people/contact/group or staff-only controls. Operators get the existing
queue plus an inbox filter. Use it inside each role's existing AppShell;
different portal/staff pages and navigation remain app-owned. Do not create a
second AppProvider, auth client, Sync connection or custom private-table query.

## Optional Assistants And Existing Services

An inbox can select `assistant: 'help'` from the existing named assistants, or
`assistant: false` for human-only handling. The compatibility support assistant
is used when the inbox omits that setting. Current user admission to that bot
still applies. An inbox bot does not require enabling internal bot discovery
for portal members or configuring a second default assistant.

Enable Zero AI and Torrent only when using AI handling. Jobs use the existing
concurrent work pool; provider I/O never holds a SQLite writer/auth lease. Human
escalation, epoch fencing, manual review and unknown-result recovery are the
same native support contracts. Revoking customer/inbox/bot access during a call
prevents publication; it is not permission to retry the provider automatically.

Messages, ownership and durable request receipts remain in the private messaging
Fabric realm. Private attachments use Storage's native stages and current
download authorization. Typing uses existing ephemeral Sync admission; presence
uses Guardian. Notifications narrow their accepted audience against current
inbox/role access and reuse AppProvider's active-conversation and sound policy.
This flag is not an application-wide replacement for profile, presence or other
services' independent visibility policies.

## Enablement And Retained Data

Portal mode does not delete or convert old conversations, identities, attachments
or accepted receipts. Retained peer/internal-bot membership does not bypass the
new restriction for a portal member. Current staff can still inspect their own
existing admitted history. Disabling portal mode restores the ordinary policy;
it is not a data restore or automatic new membership grant.

The private messaging realm appends migration `010`, adding two bounded named
inbox queue indexes. Published migrations `001`–`009` stay unchanged. The native
Fabric owner applies the migration during normal startup; no app-owned SQL,
ledger rewrite, account recreation or business-table migration is required.
Keep normal backups and qualify retained-state upgrades before deployment.
Do not assume an older package can reopen a newer private realm.

This baseline does not infer app-specific case assignments, clinical care teams
or record relationships. Apps choose trusted Guardian eligibility and named
destinations; those domain rules must be modeled explicitly rather than guessed
from profile text or a model's routing answer.
