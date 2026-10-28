---
id: zero.frontend.messaging.workspace
type: reference
audience: [developer, agent, maintainer]
owner: messaging
status: draft
visibility: internal
system: messaging
feature: managed-workspace
maturity: experimental
applies_to: ["feature/messaging-backend; not a selected stable update"]
---

# Native Messaging Workspace

[Messaging components](./index.md) · [Backend configuration](../../backend/messaging/configuration.md) · [Integration status](../../backend/messaging/index.md)

`MessagingWorkspace` assembles the existing conversation sidebar, transcript,
composer, identity/presence, typing, menus and shared confirmations over
`client.messaging`. It belongs **inside the existing AppShell**. It does not
create a second application sidebar, authenticate a second client, copy the
theme, expose private tables or require fabricated row-change events.

This is a feature-branch contract. Check the selected archive's commit/hash
before using it; an older package labeled `2.6.0` may not contain these exports.

## Ordinary Integration

Enable the [native backend](../../backend/messaging/configuration.md) in the
application configuration. A simple peer/team deployment can select
`messaging: { directory: 'everyone', support: false }`. Select `contacts` instead
when ordinary new conversations require accepted contact requests. Preserve the
existing Guardian, private Fabric and Storage configuration. Named assistants
additionally require the configured AI service and Torrent executor.

Use the application's **one common auth-enabled AppProvider**, ordinary Zero
styles and router. Enable `auth.presence.enabled` when availability rings are
wanted. The provider supplies the existing ephemeral client as well as Sync;
applications must not construct another typing connection. An SDK deliberately
configured with `autoConnect: false` still requires its owner to connect it.

```tsx
import { MessagingWorkspace } from '@zero/framework/messaging';

// Inside the existing AppProvider/AppShell. Its parent must have a bounded
// height and min-height: 0 so the transcript, not the document, scrolls.
export function MessagesPage() {
  return <div className="h-full min-h-0">
    <MessagingWorkspace avatarShape="square" />
  </div>;
}
```

The identical component family is available from
`@zero/framework/components/messaging`, the root and `/react` facades. Import
native transport types from `@zero/framework/messaging/client`; server composition
belongs to `@zero/framework/messaging/server`, not a browser bundle.

Single tenancy selects the app's private messaging Fabric database. Multi
tenancy selects the current Guardian organization's private database. Do not
pass a tenant ID from a URL, selector, participant record or search field.

## Default Behavior

- Conversations are live, authorized keyset pages of 25. Previous/Next replace
  the page rather than accumulate stale list snapshots. Archived conversations
  have a separate selector. The search input filters the **current page**; it
  is not advertised as global transcript search.
- New conversation opens the current admitted directory, paged in batches of
  50 with bounded search. One selected user starts a direct conversation;
  several start a group. Named assistants are listed separately. Contact
  requests and incoming accept/decline controls use the native facade and live
  contact projection. The server, not a partly loaded contact page, decides
  whether initiation is permitted.
- Conversation options expose applicable rename/archive/restore, membership,
  ownership transfer and leave controls. Configured groups explain their
  Guardian-managed membership instead of offering misleading manual controls.
  Direct conversations cannot be silently expanded into groups. Staff support
  participants receive take-ownership/return-to-triage/assistant actions; these
  controls do not themselves grant staff membership.
- Messages retain stable keys and unchanged object identity as live snapshots
  arrive. An edit/reaction does not blank or restart the transcript. Older
  history prepends without moving the reader's anchor. A reader following the
  end follows new messages; an older reader gets a jump-to-latest affordance.
  Only newly appended rows receive a short opacity/translate entry using the
  shared `--zero-theme-duration-fast` and `--zero-theme-ease-enter` roles. Initial
  history and older backfill do not replay that entry; reduced motion disables it.
- Message options use the shared Popover for reactions and author-only editing;
  removal uses the shared modal manager and preserves the server's tombstone.
  Revision checks remain authoritative. Authored content is escaped plain text,
  not untrusted HTML. Provider/channel edits remain subject to backend capability
  checks; a web edit is not advertised as recalling a remote delivery.
- Real private uploads perform checksum → allocation → binary upload → ready
  acknowledgment → message attachment. Failed/unfinished files block send.
  Downloads resolve through the native conversation facade, never a public
  Storage URL or drive-wide grant. No synthetic percentage implies bytes were
  accepted.
- Human typing/uploading uses the existing canonical ephemeral channel, actual
  operation state, TTL and lifecycle fences. It never transmits draft text or
  queues activity offline. AI work is not inferred from a typing timer.
- Lists/headers bind fresh Guardian presence once through the provider. Human
  avatars use a shape-matched perimeter by default, including square/rounded
  avatars. A group, assistant or visitor is not assigned a fake human status.

Configured support adds “Talk to a person” and, when admitted, “Ask the support
assistant” to new conversations. A customer in an assistant-owned support chat
can request a human from its header. The same conversation/history is retained;
the waiting/assigned label reflects canonical ownership, not invented staff
presence or proof anyone read the request.

Admitted staff receive an “Open support queue” sidebar action. Its bounded live
pages filter waiting/AI/assigned requests and expose only content-free metadata.
An explicit claim joins the conversation; taking an already human-owned request
uses the shared confirmation manager. Unknown claims/handoffs retain the same
pending-command reconciliation UI as other management changes. The queue opens
one scoped stream while displayed and releases it on departure; it does not
subscribe once per request or expose private notes. The separate
[native website widget](../../backend/messaging/website-support.md) serves
visitors; neither surface is a priority/SLA queue. Requests are indexed oldest-first.

The current assigned human can resolve/reopen a support request from conversation
options. Retained messages remain and both transitions fence older AI work.
Eligible owners/staff get a live Review control with retained attempt details,
explicit dismiss/retry confirmations and original-key unknown-result recovery.
Customers do not receive the review count/drafts. Actual current job state drives
queued/thinking/responding assistant activity; no timer invents model progress.

New-chat, member and message menus reuse Zero Popover, magnetic directory
highlight, ScrollArea/PopoverViewport, buttons, inputs, avatars and modal
confirmations. Overflow is bounded on narrow screens; a short member list does
not reserve an empty fixed-height panel. Color/surface/border/text roles inherit
the selected theme. This workspace introduces no parallel light/dark theme.

## Read Position Is Not Selection Or Presence

The default `readPolicy="visible-end"` acknowledges the latest **displayed**
sequence after the end sentinel is fully in the scroll pane and browser
viewport, the document is visible and focused, and a 750ms dwell completes.
Focus, visibility, scrolling, resizing, selection changes and unmount interrupt
or recheck that observation. Opening a list, fetching history, seeing presence
or receiving a server message never by itself advances the cursor.

This is a defined presentation policy, **not proof a person comprehended a
message**. It does not assert the other participant read it. Own messages display
“Saved by server” after acceptance, never invented delivered/read ticks. Failed
read confirmation preserves native unread counts and offers explicit retry.

`readPolicy="manual"` disables automatic read acknowledgments. A custom view can
call `controller.markPresented(sequence, conversationId)` only when its own
presentation policy was actually satisfied. It is not an instruction to call
that method when a query resolves.

## Interrupted Operations And Private Drafts

The workspace pins the exact request ID, text, attachment IDs, visibility and
ownership epoch before sending. Unknown results retain that identity and lock
editing. “Check send result” reads the caller's receipt and authorized point
message. “Retry same message” is explicit and uses the **same** identity/intent;
there is no automatic mutation replay or new-key retry after a network failure.
Management commands have the same pending/check/same-key retry treatment and
remain visible even after their originating popover closes.

Public replies and private team notes have **separate draft banks**. Switching
mode or leaving/reentering a support conversation cannot reinterpret private
text as a public reply. File stages and typing lanes are visibility-bound too.
The backend still rechecks membership, staff role, ownership epoch and history
after asynchronous boundaries; UI state never replaces those checks.

Drafts and uncertain-operation identities are scoped **in-memory**, not stored
in localStorage/sessionStorage, a URL or a plaintext browser persistence layer.
They survive conversation selection, not a hard reload or workspace unmount.
Native `beforeunload` and, by default, Zero router leave admission warn about
unfinished work. The shared confirmation explicitly states that leaving does
not cancel an already accepted/unknown operation. `guardNavigation={false}` lets
a custom host own its leave policy; native browser departure warnings remain.
Scope retirement immediately masks retained state and aborts view subscriptions;
late callbacks cannot restore the previous user's data.

## Options And Headless Assembly

| Option | Meaning |
| --- | --- |
| `avatarShape` | `circle` (default), `rounded` or `square`; perimeter follows the same shape. |
| `readPolicy` | `visible-end` (default) or `manual`, as defined above. |
| `publishTyping` | Default true for the active pane; privacy control, not observation authority. |
| `layout` | `workspace` (default) or `conversation`; the latter omits the conversation sidebar. |
| `conversationId` | Select this conversation through ordinary canonical admission; it never confers access. |
| `conversationOptions` | Default true; false hides native management/review controls, not server authorization. |
| `nativeTyping`, `externalTyping` | Advanced activity adapter. Public `SupportChat` supplies its restricted visitor publisher instead of using any surrounding signed-in Guardian identity. |
| `maxMessages` | Default 500; integer 50–1000. Bounded retained transcript, not a server retention setting. |
| `participantFor(id)` | Optional admitted identity presentation override; cannot create membership or permission. |
| `sidebarAction` | Optional replacement for the default new-conversation control. |
| `headerActions(conversation, controller)` | Additional app-owned header controls. Native options remain supplied. |
| `className` | Layout integration without copying the component. |
| `guardNavigation` | Default true for Zero router leave admission; standalone hosts safely no-op. |
| `source`, `scopeKey`, `userId` | Advanced external facade. Supply all three; replace `scopeKey` on authority changes. The normal provider path needs none of them. |

`useMessagingWorkspace(options)` returns `{ controller, state }` for custom
assemblies. `MessagingWorkspaceController` is also exported for headless owners;
subscribe with `getSnapshot`/`subscribe`, call `start`, and **dispose** on owner or
scope retirement. Supply `isCurrent` for an external authority boundary. The
React hook owns this lifecycle correctly under StrictMode and SSR, including a
fresh controller after development cleanup. Do not reuse a disposed controller.

The controller exposes selection, older/latest history, page navigation,
per-lane edit/send/reconcile, private upload actions, presented-read confirmation,
new conversations, configured assistants, current membership/ownership actions
and message changes. Existing `client.messaging` remains the canonical command
facade; custom UI need not depend on internal workspace helper files.

## Bounded Resources And Failure Semantics

Latest history uses a moving 50-message authorized projection. Loaded older
ranges use **one** additional projection for the active historical viewport;
off-screen rows are retained cache and refresh when brought into that viewport.
Scrolling coalesces range changes over 120ms and reuses a covering window. A
large transcript does not open one SSE connection per retained page and starve
ordinary HTTP uploads/commands. There are at most two transcript projections
(latest plus active history), independently of the retained-message cap.

The default maximum retains 500 messages. Loading earlier at the cap slides that
window toward older history with overlap for the scroll anchor and exposes a
jump back to latest. The memory cap does not make earlier server history
permanently unreachable. A reconnect gap is explicit, not falsely continuous.

Native history pages also carry `history: { from, revision, visibility }`, derived
from canonical membership and the conversation revision, not a client timestamp.
A changed lower bound or staff/public view discards previous cached history.
Older delayed grants cannot restore it. This covers removal/readmission that
coalesces between live snapshots without an intermediate denial. Update client
and server together for this guarantee; an older/custom source omitting the
metadata does not establish the same history-grant behavior.

There are at most 32 retained nonempty/pending drafts and 32 staged files, ten
files per conversation/visibility draft, at most 256 MiB retained file bytes and
the server's configured per-file limit. Validation/capacity errors are visible;
text is not silently truncated and old drafts are not silently evicted.

GET projections coalesce committed changes and reconnect on temporary transport
failure. Native permission invalidation, malformed frames and observer defects
are terminal for that view; they do not become retry storms. Terminal denial
removes retained transcript/people/upload presentation and requires an explicit
access recheck. The SSE reader bounds individual frames even when one network
chunk contains multiple snapshots, handles fragmented UTF-8/CRLF and reports
only safe typed errors (`MessagingLiveError`), never an error response body.

## Evidence And Remaining Boundaries

The source browser harness runs the ordinary AppProvider, SDK, Guardian,
WebSockets/ephemeral transport, private Fabric and Storage against isolated
synthetic identities and files. It is distinct from the older presentation-only
fixture. The focused controller tests exercise uncertain results, exact retries,
retired callbacks, visibility-separated drafts, historical live updates and
bounded memory. The package consumer separately checks public aliases, SSR and
browser import cleanliness. See [current implementation evidence](../../_work/messaging-workspace-review.md).

The separate `SupportChat` widget supplies restricted public visitor admission
and reuses this same single-conversation transcript/composer. See
[website support](../../backend/messaging/website-support.md) for fixed entry
configuration, visitor sessions, typed browser API and lifecycle/resource bounds.
For embedded authenticated threads, use `layout="conversation"` and
`conversationId`; the ordinary default still provides the conversation sidebar.

Group-bot participation, global conversation search, general AI tools/RAG and
token streaming remain outside this baseline. Third-party messaging
connectors remain application-owned. A source browser pass is not installed
Linux/worker/deployment or stable-update qualification.
