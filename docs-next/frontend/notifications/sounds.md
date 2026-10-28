---
id: zero.frontend.notifications.sounds
type: reference
audience: [developer, agent, operator]
owner: notifications
status: draft
visibility: internal
system: notifications
feature: sound-and-interruption-policy
maturity: experimental
applies_to: ["2.6.0 messaging development branch; verify the selected archive"]
---

# Sounds And Quiet Active Conversations

[Notification index](./index.md) · [Native messaging effects](../../backend/messaging/notifications.md)

Sounds are **off by default**. AppProvider installs one persistent, current-scope
feedback owner over the same SDK/Sync client. Enable either category or both:

```tsx
import { AppProvider, NotificationProvider } from '@zero/framework/react';
import { MessagingWorkspace } from '@zero/framework/messaging';
import { Toaster } from '@zero/framework/components/ui/sonner';

export function NativeMessages() {
  return <AppProvider url="https://app.example.test" tables={{}} auth
    notificationSounds={{ chat: true, notifications: true, volume: 0.5 }}>
    <NotificationProvider>
      <MessagingWorkspace />
      <Toaster />
    </NotificationProvider>
  </AppProvider>;
}
```

Notification hooks/provider are exported by `@zero/framework/react`; the example
also demonstrates focused native component imports. Keep one
NotificationProvider/Toaster at the application level, not inside each row.
Backend messaging notification generation must separately be enabled; a sound
setting does not create a recipient, turn on a service or grant access.

`notificationSounds={true}` enables both categories. Object options are `chat`,
`notifications`, `muted` (false by default), and `volume` (0–1; default 0.5).
A chat event selects **only** the chat cue, never a general cue as a fallback
when chat audio is disabled. One shared 750ms burst interval prevents overlap;
fast bursts can produce fewer sounds than retained notices. A message cannot
play both files through the native notification pipeline.

## Which Conversation Is Quiet

The managed native MessagingWorkspace registers its actual transcript surface.
A message for that conversation suppresses sound **and** NotificationProvider's
toast while the pane is visible, intersects the viewport, is not inert/hidden,
and the document is visible and focused. Scrolling up inside the open chat does
not turn sound back on. A different conversation can still alert, even if it
has the same participant. A mobile conversation hidden behind its list, or a
background/unfocused document, is not an active surface.

This does not delete a notification, change a badge, mark a message read, prove
attention or mute other conversations. Messaging's existing visible-end/manual
read policy and native notification receipts remain independent. A suppressed
event is not replayed later when the pane closes. The native pipeline does not
request or create browser desktop notifications; custom hosts must apply an
equivalent interruption policy to their own desktop notifications. The public
`useNotificationInterruption()` hook returns `allow(notification)` for this
purpose; it neither requests browser permission nor creates an alert.

Custom native conversation compositions can use
`useNotificationConversation(conversationId, isActuallyActive)`. The predicate
must reflect actual focus/visibility, not just the selected route ID. Do not
register an anonymous widget as a surrounding Guardian user's conversation:
SupportChat's visitor capability is not a native notification recipient.

## Browser Admission, Controls And Scope Retirement

Browsers can block media until a user gesture. Enabled cues load lazily, then
the next trusted pointer/keyboard gesture attempts a silent unlock. The public
`useNotificationSounds()` hook exposes `status`, `muted`, `setMuted(boolean)`
and `unlock()`. Call unlock directly from a visible button's click handler;
the statuses are disabled/loading/locked/ready/blocked/unsupported. If the files
were still loading at the first gesture, a later gesture can finish admission.
An application can persist the user's opt-in preference; Zero does not infer
consent or store it in a global cross-account setting.

Mute, zero volume, disposal and authorization-scope retirement stop media.
Blocked media fails quietly without changing send/delivery outcomes. There is
no audio backlog: unlocking, reconnecting, unmuting or restoring a session never
plays older cues. Sounds do not replace accessible textual progress or errors.

The two user-supplied assets are retained byte-for-byte under
`src/frontend/client/sounds/`: chat-message.mp3 is
`universfield-new-notification-014-363678.mp3`; notification.mp3 is
`universfield-soft-notification-146623.mp3`. The normal ESM browser build emits
hashed same-origin assets beside its chunks; preserve those build outputs.
No third-party CDN, provider key, base64-inlined audio or data URI is needed.
An application CSP must permit the same-origin build/media assets. Attribution
identifies the supplied files; it does not assert an independently verified
third-party distribution license.

## Explicit Limits

The policy is per mounted application/window. It does not use untrusted presence
as proof of viewing, infer human attention, coordinate a device-wide sound lock,
or claim exactly-once alerts across several independent browser tabs/devices.
Native chat identifiers are content-free presentation metadata, not a transcript
capability. Source, browser-media and installed-release evidence are recorded
separately in the [messaging qualification record](../../_work/messaging-workspace-review.md).
