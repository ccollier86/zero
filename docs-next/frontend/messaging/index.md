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
applies_to: ["feature/messaging-foundation based on main 1637605"]
---

# Messaging Components And Typing

[Frontend index](../index.md) · [Full integration plan](../../backend/messaging/index.md)

The initial messaging family provides composable presentation parts and real
room-authorized typing. It is not yet a durable chat backend or a Facebook/AI
connector. The complete service, Storage binding and controller are explicit
release gates in the integration plan. Existing email/inbox remains separate.

Import from `@zero/framework/messaging` on this feature branch; older main
archives do not have this entry point. Sources live in `src/components/messaging/`,
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

Each tab has a distinct random session key. Publication is transient and never
enters an offline send queue. Input throttles to 750ms, idle clears at 3500ms,
and server expiry is 5000ms. The server bounds session TTL to 1000–15000ms and
requires payload identity to match the authenticated actor. Duplicate sessions
group into one participant using the server envelope's identity. Draft text is
never sent in the activity payload.

Stop on send, blur, document hiding, navigation/unmount and authorization changes.
Retained handlers cannot publish after conversation replacement (including an
A → B → A round trip), after privacy is disabled or after unmount. A cleared
session never deletes its sibling tab's independent key.
Mount only for the active admitted conversation, or disable publication while
its pane is inactive. The server's current membership policy is the actual
authorization boundary; display state and local timestamps are not.

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

The real `ephemeral-channel.test.ts` exercises the room/actor/tenant policy and
session TTL; `ephemeral-client.test.ts` exercises no-queue transient transport.
Clock-skew filtering uses client timestamps as a UI heuristic and hides
malformed/far-future claims; server expiry and membership remain authoritative.
Server-relative freshness for arbitrary client clock skew is a remaining full
messaging transport gate, alongside durable storage, uploads and delivery.
