---
id: zero.messaging.notifications
type: reference
audience: [developer, agent, maintainer]
owner: messaging
status: draft
visibility: internal
system: messaging
feature: native-notifications
maturity: experimental
applies_to: ["2.6.0 native messaging notifications; verify the selected commit/archive hash"]
---

# Native Messaging Notifications

[Messaging](./index.md) · [Durable review](./review.md) · [Implementation and qualification](../../_work/messaging-backend-implementation.md)

This development branch connects accepted messages to Zero's native notification
service. It is not external email, a Messenger delivery receipt, or a claim that
the complete messaging product has shipped. Older same-version archives do not
contain this capability.

## Enable The Native Effect

Guardian and Torrent must be enabled. Notifications are opt-in:

```ts
const config = {
  auth: { bootstrap: 'public' },
  workflows: {},
  messaging: {
    notifications: { path: '/app/messages' },
  },
};
```

`notifications: true` uses `/messages`; `false` leaves new notifications off.
The path must be local, start with one `/`, have no query, fragment, backslash
or control characters, and be at most 400 characters. The effect appends
`?conversation=<encoded-id>`. Mount an authorized conversation UI at that path;
this setting does not itself create a managed workspace or public portal.
Disabling generation does not discard retained jobs or receipts.

Only accepted public messages queue these effects. Staff notes never create a
public-message notification. The sender is excluded, external contacts are not
invented as native user accounts, and global staff authority does not broadcast
a conversation to all staff. Native unread/seen/read receipts remain distinct
from messaging's conversation read cursor.

## What Commits Where

| Boundary | Recorded fact |
| --- | --- |
| Private messaging Fabric commit | Accepted message, durable job, fixed candidate audience and notification path. |
| Current eligibility checks | Active canonical membership, history boundary, unread position, current user/organization and staff role/property policy narrow that audience. |
| SYSTEM transaction | One generic native notice and its permanent effect receipt, or a remembered empty audience. |
| Private job completion | The native receipt was reconciled; not a human read or external-provider delivery. |

The notice contains `New message` and an opaque conversation link, not message
text, file names, a preview, provider output or arbitrary metadata. New notices
carry only versioned, opaque conversation/message IDs for the shared
[sound and active-conversation policy](../../frontend/notifications/sounds.md).
This is not an authorization capability. Opening the
conversation always reauthorizes against canonical private membership.

The two files are **not** one distributed transaction. The final current-account
policy runs in the destination SYSTEM transaction, but a concurrent membership
change in the private conversation file can still race a generic notice. The
notice cannot confer transcript or attachment access. Do not describe this as
atomic cross-database membership revocation.

## Recovery And Idempotency

The source audience/path is fixed when its message is accepted. Recovery cannot
replace it with today's membership, expand it to newly added people, or change
the destination path after a configuration update. The first native publication
can only narrow candidates. Receipt replay does not reevaluate that policy into
a new notice. Deleting or expiring the visible notice does not delete its
permanent effect receipt or grant permission to resend it.

The typed presentation tuple is part of new permanent effect fingerprints.
Legacy receipts without a tuple can reconcile against their exact original
payload; this returns the original receipt without rewriting the notice,
changing its audience, resurrecting a deleted row or adding a second alert.
Unknown metadata, accessors and content-bearing cue fields remain rejected.

Only this native destination has the receiver guarantee that permits automatic
reconciliation after an interrupted call. A failed native Torrent generation can
be redispatched under the original effect identity, for at most three automatic
dispatch generations. Previous attempts/workflows remain separate facts. An
empty eligible audience is accepted as a native effect without broadcasting an
empty notice.

Known receipt schema/input conflicts go directly to review. Cancelled or missing
workflows, legacy jobs without a fixed audience, uncertain AI calls and external
channel sends do not inherit this native replay permission. A saved AI result
and a provider call with unknown outcome are different recovery cases.

## Schema And Deployment Boundary

Private migration `005` adds the fixed audience; earlier private migrations are
unchanged. SYSTEM migration `051` owns immutable native effect receipts. Startup
and receiver admission inspect that schema read-only, including immutable
receipt controls; missing or drifted controls reject admission instead of
silently repairing a ledger. Do not insert/delete receipts manually or backfill
old experimental jobs using current membership.

The native notification provider is prepared before messaging and Torrent
recovery, using the same idempotent initializer used by normal Elysia startup.
Failure/stop retires its exact runtime registration and owned cleanup schedule;
it must not unregister another callback installed under the same schedule name.

## Qualification And Remaining Work

Synthetic native tests cover actual HTTP/SDK sends, current recipients, private
content absence, independent read receipts, membership removal, notice deletion,
exact command replay and restart. A deliberate error after a real destination
commit proves one notice survives reconciliation while the failed workflow is
retained. Separate source/receiver tests exercise scope separation, empty
audiences, conflicting effects, rollback and missing immutable schema controls.

Ordinary peer conversations also have sender-only review/discovery through the
same [review facade](./review.md) and native workspace. Only the current original
sender can inspect/dismiss their native-notification alert, within current
membership/history. Even a group owner cannot inspect someone else's work.
Dismissal never resends a notice or changes its earlier outcome. Support and
internal assistants retain their separate staff/current-owner review admission.

The [qualification record](../../_work/messaging-workspace-review.md) records real
browser, fresh package and Linux/amd64 source-to-bundle/worker recovery evidence
separately. Native [website support](./website-support.md) is implemented;
Messenger ingress/outbox/media and email bridging are not requirements or
framework connectors. A source test does not select an updater archive.
