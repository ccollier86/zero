---
id: zero.messaging.website-support
type: reference
audience: [developer, agent, operator]
owner: messaging
status: in-review
visibility: internal
system: messaging
feature: public-support
maturity: experimental
applies_to: ["feature/messaging-backend; verify the selected commit/archive before use"]
---

# Native Website Support

[Messaging](./index.md) · [Configuration](./configuration.md) · [Workspace](../../frontend/messaging/workspace.md) · [Review](./review.md)

Visitors use the same canonical conversation, staff workspace, private Storage,
live projections and concurrent AI jobs as signed-in support users. They are not
fabricated Guardian users. No email bridge, third-party connector, second
presence database or general Sync grant is created.

## Configure A Fixed Entry

```ts
messaging: {
  support: {
    staff: 'admin',
    entries: {
      website: {
        origin: 'https://example.com', title: 'Customer support',
        assistant: 'help', // false for direct-human support
        sessionTtlSeconds: 86400, maxVisitors: 10000,
      },
    },
  },
  assistants: {
    help: { name: 'Support assistant', model: 'smart', humanHandoff: true },
  },
  jobs: { concurrency: 'max' },
},
```

Enable Zero AI and Torrent for assistants. Human-first chat needs neither AI nor
a model call. An assistant-owned new chat is rejected if its executor is disabled.

`origin` is one exact same origin without a trailing slash, path, credentials,
query or fragment. HTTPS is required; HTTP is allowed only on loopback. Preserve
the correct request origin through the admitted reverse proxy. Zero does not
trust browser-supplied forwarded-host/origin overrides. Cross-origin iframe or
third-party-cookie embedding is not supported by this entry.

In multi tenancy an entry's `tenantId` must identify an existing active
organization. It is required in multi mode and forbidden in single mode. The
browser cannot select or provision an organization. Each organization keeps its
own private messaging Fabric file.

Optional entry `staff` adds a narrower Guardian requirement on top of the global
support requirement. Use roles, permissions or policy-trusted properties for
department/team routing. Discovery, claims, history, files, typing and notices
recheck current entry admission. A global support role alone does not grant
every entry's transcript. Staff explicitly claim before reading a conversation.

An entry can select a named assistant independently of the support default.
Define a dedicated public bot without an internal Guardian `access` restriction;
do not accidentally expose an internal one. Handback/review retry preserve that
conversation's named assistant and current policy.

## Use The Native Widget

```tsx
import { SupportChat } from '@zero/framework/messaging';

<SupportChat entry="website" />
// Optional human-first override even when the entry has a bot:
<SupportChat entry="website" mode="human" />
```

This reuses Zero tokens, keyed transcript/composer, ScrollArea, private uploads,
exact-send recovery and modal manager. An existing modal host is reused; a
standalone widget provides one. It does not need a second AppProvider or auth
client. A surrounding staff SDK is never used to impersonate visitor typing.

Default height is `min(44rem, calc(100dvh - 2rem))`; use `className` to integrate
the container and `title`/`description` for its start screen. `resume` defaults to
true: mount checks an existing cookie only, not creating a visitor or calling AI.
The explicit start action creates a session; refresh restores the same valid
cookie, visitor and conversation.

Typing/uploading shares the existing app-local ephemeral pool. Activity contains
no text, expires after five seconds, clears on idle/blur/hide, and never queues
offline. The composer publishes real typing/upload activity, not an audio
recorder or invented staff presence. Recording labels are available to custom
actual recorder integrations. Staff use their normal authorized native Sync
connection; visitors receive only a narrow authorized activity projection.

Custom assemblies can import `createSupportChatClient` from
`@zero/framework/messaging/client`. It returns bounded message/file/read/human
request/typing APIs, opaque `scopeKey`, identity and conversation ID. Retain stable
mutation request IDs. `clear()` retires memory/subscriptions; explicit
`end({ requestId })` revokes the session. The widget owns these lifecycles.

## Admission And Recovery

The random capability stays in a path-scoped `HttpOnly; SameSite=Strict` cookie
(`Secure` over HTTPS); only its hash is retained privately. It is never returned
to JavaScript, included in URLs, or stored in localStorage. Requests use a
memory-only CSRF proof and non-authoritative session fence. Exact Origin, a
non-simple header, entry/scope, expiry/revocation and canonical membership are
checked. No directory, contacts, staff notes, review drafts or other chat leaks.

A changed policy/scope invalidates the old session, not rebinds it to another
organization/person. Explicit recovery can forget an expired/revoked cookie.
Ending an active session needs its own CSRF proof. End does not delete retained
conversation/audit evidence. Cross-tab notifications contain only an opaque
session ID; server revocation remains authoritative. An interrupted initial
start can leave an empty retained chat, not a sent message/provider invocation.
Accepted message intents have independent durable duplicate-safe receipts.

| Bound | Current contract |
| --- | --- |
| Entries | At most 32 |
| Session | Default 24h; configurable 60 seconds–7 days |
| Retained visitors | Default 10,000/entry; configurable 1–100,000; source-transaction budget |
| Starts | 30/minute/entry/process, in addition to the durable budget |
| Durable visitor writes | 120 new intents/minute/session; 1,000 accepted messages/session; accepted replay consumes no new quota |
| Transient activity | 180 requests/minute/visitor and existing shared ephemeral pool bounds |
| Live projections | Four/session, 256 public/process; one buffered packet and one in-flight read/stream |
| Messages/files/history | Existing configured messaging limits, private stage reservations and history grants |

Capacity errors are explicit, not silent history loss. The retained-visitor
budget does not reset on cookie expiry or automatically erase evidence. Review
capacity deliberately. Internet-facing proxy abuse controls remain useful; this
does not claim distributed IP reputation or CAPTCHA protection.

## Humans And AI

Human-first starts enter triage without AI. Customer “Talk to a person” and an
explicitly enabled `humanHandoff` bot tool move the same chat to triage. The model
gets only an empty-argument `requestHuman` tool, no staff/tenant/member/arbitrary
execution selectors. Job policy/nonce, current turn and owner epoch fence that
transition. A held model call cannot displace a human or publish after visitor
revocation/expiry.

The current assigned human can resolve/reopen with the ordinary archive facade.
Both transitions advance owner epoch and revision; reopen cannot resurrect a
pre-resolution result. History remains retained. Only the current human owner
can hand back an assigned chat. The content-free queue is indexed oldest-first
with filter-bound keyset cursors, not a priority/SLA scheduler.

Assistants still receive only recent public text (20 messages/128 KiB), not staff
notes or file contents. There is no automatic RAG, general tool execution,
group-bot participation or token streaming in this contract. See the
[qualification record](../../_work/messaging-workspace-review.md) for distinct
source, browser, package and deployment evidence.
