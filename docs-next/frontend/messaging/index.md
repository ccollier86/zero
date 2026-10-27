---
id: zero.frontend.messaging
type: reference
audience: [developer, agent]
owner: messaging
status: draft
visibility: internal
system: messaging
feature: presentation-and-typing
maturity: experimental
applies_to: ["2.6.0 source with the messaging presentation and typing exports"]
---

# Messaging Components, Workspace And Typing

[Frontend index](../index.md) · [Full integration plan](../../backend/messaging/index.md)

The initial messaging family provides composable presentation parts and real
room-authorized typing. The branch-only [backend configuration](../../backend/messaging/configuration.md)
adds durable messaging, groups and internal assistants independently of support.
The branch now adds the [native managed workspace](./workspace.md), connecting
those parts to the canonical facade, private files, history, read policy and
typing. Public support/email and installed release qualification remain explicit
gates. Third-party provider connectors are app-owned. Existing email/inbox
remains separate.

Import from `@zero/framework/messaging` or the identical
`@zero/framework/components/messaging` facade. The documented parts are also
exported by the root and `@zero/framework/react`. Older 2.6.0 archives may lack
these entries; identify the source commit/archive hash, not just the version.
Sources live in `src/components/messaging/`,
`src/messaging/` and the existing typing/ephemeral modules.

Source map: [layout](../../../src/components/messaging/messaging-layout.tsx),
[list/header parts](../../../src/components/messaging/conversation-parts.tsx),
[messages and receipts](../../../src/components/messaging/message-bubble.tsx),
[composer](../../../src/components/messaging/messaging-composer.tsx),
[typing hook](../../../src/components/messaging/use-conversation-typing.ts),
[presence binding](../../../src/components/messaging/use-messaging-presence.ts),
[shared avatar presentation](../../../src/components/messaging/messaging-avatar.tsx),
[activity presentation](../../../src/components/messaging/conversation-activity.tsx),
[presentation records](../../../src/messaging/presentation.ts) and
[component style roles](../../../src/components/messaging/messaging.css).

For an ordinary app, start with `MessagingWorkspace` under the existing common
AppProvider/AppShell. `useMessagingWorkspace` and `MessagingWorkspaceController`
are the headless assembly/lifecycle API; see their [full manual](./workspace.md).

## Parts

| Part | Contract |
| --- | --- |
| `MessagingLayout` | Conversation sidebar plus main area inside the existing AppShell. Sidebar header/footer and transcript/composer/activity slots are independent. Shared ScrollArea owns sidebar and transcript overflow. `mobileView` and `onBack` control narrow list/detail navigation without a second app sidebar. |
| `ConversationList` | Controlled keyed conversation rows, optional unread/channel/activity summaries, arrow/Home/End focus navigation and the canonical magnetic hover/focus highlight. Under the ordinary provider, observes the existing Guardian presence feed once for the list. Selecting a row does not invent membership or mark it read. |
| `ConversationListHeading` | Title/count, explicit action slot and controlled search. The admitted source owns search results; a component never discovers private contacts. |
| `ConversationHeader` | Identity/avatar, current Guardian presence when available and explicit action slots for profile, channel-supported calls, menus or takeover. Unknown presence is omitted, not displayed as online/offline. |
| `ConversationSeparator` | Accessible date/unread section marker using the existing border and typography roles. |
| `MessageBubble` | Escaped plain-text body, participant identity presentation, attachment chips, reactions, edit hint and explicit delivery state. `onAttachment` must call an authorized owner; rendering never downloads bytes or emits a public URL. |
| `MessageDeliveryIndicator` | Distinguishes queued/sending/accepted/delivered/read/failed/unknown. Accepted means saved by the server, not read or delivered by a remote channel. |
| `ConversationTypingIndicator` | One/two/many typers, optional avatar group, inline or bubble treatment, recording/uploading distinctions, reduced motion and a polite atomic live region. Supply `participantFor` from the admitted directory for trusted labels/avatar presentation. |
| `ConversationAssistantActivity` | Separate queued/thinking/searching/responding/awaiting-human presentation. Requires a real run ID from the eventual server executor; no fake typing timer. |
| `MessagingComposer` | Controlled plain-text input, IME-safe Enter, Shift+Enter newline, file selection and staged-file progress. Unfinished/failed uploads block send. Does not clear content, assert acceptance or upload files on its own. |

`MessagingMessage`, `MessagingParticipant`, `MessagingAttachment`,
`MessageDeliveryState` and the other presentation types are browser-safe records.
An attachment references Zero Storage's drive/path/checksum, never raw bytes,
credentials or a permanent download URL. These types do not grant access.
`MessageBubble.formatTime` accepts the application's shared locale/time-zone
formatter. The fallback is UTC HH:mm so server/browser hydration never depends
on their independently configured local clocks or locales.

## Guardian Presence And Avatar Shape

The current feature branch binds `ConversationList` and `ConversationHeader` to
the existing [Guardian presence service](../../backend/guardian/presence.md) by
default when an SDK is supplied by AppProvider/ClientProvider. Enable
`auth.presence.enabled`; the ordinary AppProvider manifest owns tracker enablement.
There is no second messaging heartbeat, polling connection or per-avatar tracker.
An SDK without presence, disabled presence or standalone controlled rendering
still works without inventing a live observation.

Only `MessagingParticipant.kind: 'user'` looks up a Guardian user ID. Assistants,
external visitors and group identities never borrow a human status, even when
their display ID happens to match a user. The presentation record admits
`kind: 'group'` for a group avatar; it does not create a fake Guardian account.
Typing, assistant work, presence, membership and message read receipts remain
independent. Presence cannot grant history/file access or mark a message read.

The default is a **status-colored perimeter**, not a dot. Set the participant's
`avatarShape` to `circle`, `rounded` or `square`: the avatar, fallback and status
perimeter share exactly the same corners. This applies to list/header, message
and typing-avatar presentation, including a supplied Zero Avatar node. Set the
shape on that participant record, rather than independently styling its image.
The optional inherited `--zero-messaging-avatar-radius` role provides an app-wide
default; unset it and the default is circular. Radius values reuse the existing
`--zero-avatar-group-circle-radius`, `--zero-avatar-group-rounded-radius` and
`--zero-avatar-group-square-radius` roles. The shared
`--zero-avatar-presence-ring-width` controls the perimeter. Message/typing avatars
do not infer a presence observation from historical activity.

```tsx
import { ConversationHeader, type MessagingParticipant } from '@zero/framework/messaging';

const teammate: MessagingParticipant = {
  id: 'the-admitted-guardian-user-id',
  kind: 'user',
  label: 'Alex Rivera',
  avatarShape: 'square',
};

// Inside the ordinary Zero provider: no manual mapping or extra tracker.
export function TeammateHeader() {
  return <ConversationHeader participant={teammate} subtitle="Team conversation" />;
}
```

`livePresence={false}` opts a list/header out of automatic binding. Explicit
`presence` presentation still wins; its supplier owns freshness/scope admission.
Explicit `variant: 'dot'` or `'badge'` is respected rather than forced on all
avatars. Hovering a status avatar uses Zero's shared tokenized Tooltip; list
buttons also include the status in accessible text, and the header shows its
label visibly. Unknown/stale feeds remove automatic rings and labels instead of
claiming that a missing observation means Offline. A fresh server-confirmed
Offline observation can render a muted perimeter.

Custom assemblies can call `useMessagingPresence()` under the same provider.
It returns `{ status, presenceFor(participant) }`, with the same user-only,
freshness-aware mapping. `status` is the feed state (disabled/loading/pending/
ready/error), not an individual's availability. It observes the SDK owner and
never activates one. Providerless SSR returns no observation; browser hooks
still require the standard provider. The standalone controlled list/header
components do not require a provider.

The server's existing visibility contract remains current same-application or
same-tenant directory membership. A contacts-only **messaging** configuration
does not silently introduce a contact-only **global presence** privacy policy.
Conversation access is checked separately by the native messaging service.

## Real Typing Integration

Use inside an admitted active conversation under the normal Zero providers:

Browser providers must be auth-enabled. The high-level room helper rejects
auth-disabled browser wiring instead of treating an anonymous legacy topic as
Guardian-authorized messaging.

```tsx
import {
  useConversationTyping,
  ConversationTypingIndicator,
  MessagingComposer,
} from '@zero/framework/messaging';

type ConversationInputProps = {
  roomId: string;
  value: string;
  setValue(value: string): void;
  submitExistingIntent(): void;
};

function ConversationInput({ roomId, value, setValue, submitExistingIntent }: ConversationInputProps) {
  const typing = useConversationTyping(roomId, { publish: true });
  return <>
    <ConversationTypingIndicator participants={typing.participants} />
    <MessagingComposer
      value={value}
      onChange={setValue}
      onTyping={typing.onTextChange}
      onStopTyping={typing.clearTyping}
      onCompositionStart={typing.onCompositionStart}
      onCompositionEnd={typing.onCompositionEnd}
      onSubmit={submitExistingIntent}
    />
  </>;
}
```

This is a controlled room-typing assembly, not a native conversation send example.
For native conversations use `useMessagingTyping(conversationId)`; it derives
the canonical messaging activity topic and visibility rather than requiring a
RoomService ID. The managed workspace wires that hook and retains exact durable
send identities, private upload readiness and explicit unknown-result recovery.

`roomId` is the real admitted RoomService room ID, not an arbitrary chat label.
The hook does not accept alternate topics or caller-selected actors. It reuses
the existing ephemeral client and room policy, deriving actor identity from
Guardian. The matching server must support session-scoped typing keys; do not
assume an older installed server accepts them.

Options are `publish` (true), optional display `label`, and optional `activity`
(`typing`, `recording`, `uploading`). Publish recording/uploading only while the
real corresponding operation is active. Turning `publish` off is a privacy
control for this client's publication, not a grant to observe private peers.

Returns the ordinary typing fields plus `participants`, `onTextChange`, IME
helpers, `error` and `resetError`. A denied/revoked topic masks participants and
blocks publication. Reauthorize before explicitly resetting an error; reset
requests a fresh subscription proof from the server, not a grant or success
acknowledgement. Do not silently loop retries around a forbidden room.
`resetError()` returns true only when the current connection dispatched a new
subscription request; the server still decides admission. Offline/closed/scope-
transition calls return false and keep the error. A retry clears stale cached
activity while it waits for an authorized snapshot.

Each tab has a distinct random session key. Publication is transient and never
enters an offline send queue. Input throttles to 750ms, idle clears at 3500ms,
and server expiry is 5000ms. The server bounds session TTL to 1000–15000ms and
requires payload identity to match the authenticated actor. Duplicate sessions
group into one participant using the server envelope's identity. Draft text is
never sent in the activity payload.

Freshness comes from server-measured age/lifetime and a local monotonic receipt
clock, not a publisher's wall clock. Reconnect snapshots retain their original
age rather than renewing typing. Throttling also uses a monotonic clock, so a
local time correction cannot freeze publication. Older wire messages without
freshness retain the bounded legacy timestamp filter.

Stop on send, blur, document hiding, navigation/unmount and authorization changes.
Retained handlers cannot publish after conversation replacement (including an
A → B → A round trip), after privacy is disabled or after unmount. A cleared
session never deletes its sibling tab's independent key.
The hook also blocks retained publication while the window is unfocused or a
page is leaving; returning to the page never republishes old activity on its own.
Mount only for the active admitted conversation, or disable publication while
its pane is inactive. The server's current membership policy is the actual
authorization boundary; display state and local timestamps are not.

`useConversationTyping` and the underlying ephemeral hooks server-render with
empty observations and no socket/client creation under AppProvider's ordinary
SSR fallback. Browser calls still require the real Client/Sync providers; missing
providers do not silently create an unauthenticated second client. Named props
and the full `UseConversationTypingReturn` are exported from the public facade.

## Adopt After A Package Update

1. Follow the normal [saved-package update flow](../../cli/tooling/zero-update.md)
   and record the selected source commit and archive checksum. Update client and
   server together before adopting session typing.
2. Use the app's existing Zero style entry (`@zero/framework/styles.css`) and
   AppShell/providers. Messaging styles ship with that entry and the component
   facade; do not copy colors or create another theme or connection owner.
3. Use the [managed workspace](./workspace.md), or compose parts with the native
   authorized facade. Retain stable keys, scoped data, accepted-write receipts,
   file authorization and observed read-cursor rules in custom assemblies.
4. Test desktop/narrow navigation, keyboard/IME, reduced motion, revoked room
   access, reconnect and two tabs in the consuming app.

Importing presentation parts does not run a migration, provision a chat service,
enable AI/uploads or rewrite application source. The branch-only
[native backend](../../backend/messaging/configuration.md) exposes `zero.messaging`
and `client.messaging` when configured, with its own admitted private migrations.
Do not assume an older selected 2.6.0 archive has that facade. Presence refinements
add no migration and do not replace Guardian identity/profile authority.
Email/inbox and application-owned third-party connectors remain separate.

The normal [Zero build](../../cli/tooling/build.md) emits JavaScript and imported
component CSS separately, including compiled-executable builds. If the app has
a custom Bun build script, review fixed `--outfile`/entry-naming settings:
JavaScript and CSS must not be assigned the same output filename. A package
update does not rewrite those custom scripts.

## Component And Service Boundaries

Components use Zero semantic surfaces, borders, typography, controls, avatars
and ScrollArea. Authored message text is escaped. Rich message rendering must
use an explicitly reviewed renderer rather than raw sender HTML. Typing dots
are the only continuous animation in this slice and become static under reduced
motion; the conversation highlight reuses the existing menu motion. The typing
duration role is `--zero-messaging-typing-duration` (1200ms),
with staggered dots; it is a component role, not a replacement global theme.

Activity, message acceptance, channel delivery and read receipts remain separate.
No component invents online status, infers delivery from a timeout or activates
an AI provider. File chips expose callbacks rather than bypass Storage authority.
The backend plan records the full remaining cross-service work and tests.

## Verification And Limits

`messaging-parts.test.tsx` verifies escaped presentation, explicit delivery and
presence states, disabled unfinished uploads and stable time rendering. The
local-only `messaging.browser.test.ts` checks bounded desktop/narrow panes,
shared ScrollArea and magnetic material, unchanged existing message DOM, IME,
modified Enter, upload readiness, reduced motion and typing lifecycle fences.
Its synthetic fixture never connects a message server, sends an external message,
uploads a file or calls an AI provider. It is visual/lifecycle evidence only.
The presence-settings browser fixture additionally runs the actual SDK presence
owner and these components against synthetic scoped receipts. It covers live
status changes, retained conversation rows, one tracker, native read-only controls,
intent expiry, tooltips, shape geometry, light/dark/narrow layouts, owner expiry,
disconnect/reconnect, scope replacement and exclusion of bots/visitors/groups.
The native managed messaging test separately enables presence and messaging
together on actual HTTP/WebSockets/Fabric: independent tabs, Busy, typing,
unread retention and no conversation access merely from directory presence.

The real `ephemeral-channel.test.ts` exercises room/actor/tenant policy, TTL,
server freshness and delayed-fanout races; the managed `createApp` integration
test exercises actual authenticated sockets and room revocation. Client/store
tests cover no-queue transport and locally measured receipt times.
`messaging.package.test.ts` installs a fresh framework archive, checks all public
aliases/types/styles, server-renders the real hook under AppProvider and builds
a browser consumer without app config or live services. Durable chat, Storage
binding, AI takeover and channel delivery remain separate completion gates.
Production-build regressions also serve the earlier presentation parts and styles
from both a normal server bundle and the compiled executable. The new native
workspace has its own [evidence and qualification limits](../../_work/messaging-workspace-review.md);
do not transfer those older fixture results to its complete runtime automatically.
