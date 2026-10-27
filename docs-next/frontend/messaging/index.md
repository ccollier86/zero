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

# Messaging Components And Typing

[Frontend index](../index.md) · [Full integration plan](../../backend/messaging/index.md)

The initial messaging family provides composable presentation parts and real
room-authorized typing. The branch-only [backend configuration](../../backend/messaging/configuration.md)
adds durable messaging, groups and internal assistants independently of support.
These parts are not yet the fully wired managed controller; public support/email
and installed-browser qualification remain explicit gates. Third-party provider
connectors are app-owned. Existing email/inbox remains separate.

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
[activity presentation](../../../src/components/messaging/conversation-activity.tsx),
[presentation records](../../../src/messaging/presentation.ts) and
[component style roles](../../../src/components/messaging/messaging.css).

## Parts

| Part | Contract |
| --- | --- |
| `MessagingLayout` | Conversation sidebar plus main area inside the existing AppShell. Sidebar header/footer and transcript/composer/activity slots are independent. Shared ScrollArea owns sidebar and transcript overflow. `mobileView` and `onBack` control narrow list/detail navigation without a second app sidebar. |
| `ConversationList` | Controlled keyed conversation rows, optional unread/channel/activity summaries, arrow/Home/End focus navigation and the canonical magnetic hover/focus highlight. Selecting a row does not invent membership or mark it read. |
| `ConversationListHeading` | Title/count, explicit action slot and controlled search. The admitted source owns search results; a component never discovers private contacts. |
| `ConversationHeader` | Identity/avatar, optional current presence and explicit action slots for profile, channel-supported calls, menus or takeover. Unknown presence is omitted, not displayed as online/offline. |
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

This is presentation assembly, not a shipped `client.messaging.send` example.
The host's submit callback must retain the same durable operation ID until its
accepted/unknown result is resolved. The future managed controller owns that
contract, including upload finalization and delivery errors.

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
3. Compose the parts with an existing authorized conversation/message source, or
   use them as local presentation while building that source. Retain stable keys,
   scoped data, accepted-write receipts, file authorization and read-cursor rules.
4. Test desktop/narrow navigation, keyboard/IME, reduced motion, revoked room
   access, reconnect and two tabs in the consuming app.

There is no new messaging database migration or automatic app-source rewrite.
Importing parts does not provision a chat service or enable AI, file uploads or
Messenger. Do not call `zero.messaging` or `client.messaging`: those planned
facades do not exist in this release. Email/inbox is separate and the optional
Stripe plugin remains a separately installed package.

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

The real `ephemeral-channel.test.ts` exercises room/actor/tenant policy, TTL,
server freshness and delayed-fanout races; the managed `createApp` integration
test exercises actual authenticated sockets and room revocation. Client/store
tests cover no-queue transport and locally measured receipt times.
`messaging.package.test.ts` installs a fresh framework archive, checks all public
aliases/types/styles, server-renders the real hook under AppProvider and builds
a browser consumer without app config or live services. Durable chat, Storage
binding, AI takeover and channel delivery remain separate completion gates.
Production-build regressions also serve the actual components and styles from
both a normal server bundle and the compiled executable.
