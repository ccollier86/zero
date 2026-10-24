---
id: zero.frontend.email.source
type: reference
audience: [developer, agent]
owner: email
status: draft
visibility: internal
system: email
feature: source-contract
maturity: preview
applies_to: ["2.6.0 email inbox development source"]
modes: [browser, managed-server, custom-source]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "7aa638f3d1ad7a66f1856ab0ae2b666b8c45f080"
  snapshot: dirty
  date: "2026-10-23"
  evidence_level: source-observed
---

# Email Inbox Adapter Contract

[Email UI index](./index.md) · [Documentation index](../../index.md)

The managed source is `client.emailInbox`, using the existing authenticated
client fetch and Guardian boundary. `createEmailInboxSource(authenticatedFetch)`
provides the same adapter for an explicitly owned compatible client. It adds
`clear()` to abort its requests/streams and retire stale responses; it does not
create an auth client or expose SMTP/IMAP secrets.

## Source methods

All methods accept optional `{ signal }` as their last argument. Account IDs
are opaque server-admitted bindings. Folder paths and immutable message refs
are distinct: a ref is `{ folder, uidValidity, uid }`, never a list position.

| Method | Result |
| --- | --- |
| `accounts(options?)` | Admitted account labels, addresses, From identities and capabilities. |
| `folders(account, options?)` | Folder metadata, special-use flags and optional count hints. |
| `list(account, query, options?)` | `{ folder, uidValidity, messages, total, cursor? }`; the cursor is opaque to the UI. Query has `folder`, `search?`, `filter?`, `cursor?`, `limit?`. |
| `read(account, ref, options?)` | Authorized headers/body and attachment metadata, not embedded file bytes. |
| `attachment(account, ref, id, options?)` | Authorized Blob, used for explicit downloads or validated CID bytes. |
| `setFlags(account, ref, flags, options?)` | Accepted seen/starred command. |
| `move(account, ref, destination, options?)` | New immutable destination ref after acceptance. |
| `getDraft(account, id, options?)` | Owned draft, revision, updatedAt, value and any pending-send recovery fence. |
| `saveDraft(account, {id,revision,value}, options?)` | New revision; revision zero creates exactly one new draft. A stale revision must reject. |
| `deleteDraft(account, {id,revision}, options?)` | Accepted revision-checked deletion, prohibited for an uncertain send. |
| `send(account, {operationId,value,draft?}, options?)` | Durable accepted/partial receipt. Same operation/content returns the prior receipt, never sends again. |
| `watch(account, folder, options?)` | AsyncIterable of `connected`, provider `resync`, `arrival`, `flags` and `removed` metadata. End/disconnect triggers a fresh authorized subscription. |

`EmailComposeValue` contains a From identity ID, plain address arrays for
To/Cc/Bcc, subject, text, optional HTML/reply headers and bounded base64
attachments. The managed backend admits the From ID rather than trusting a
browser-provided sender address. Optional `recipientDrafts` preserves unfinished
To/Cc/Bcc input (up to 32,000 characters each) when saving; nonempty pending
recipient text cannot be sent until committed to validated address arrays.
`emailMessageKey(ref)` is the managed row-key
helper; `emptyEmailCompose(from?)` creates a new empty value. Both are exported
from the inbox entry point.

## Adapter obligations

Custom adapters enforce server-side authorization, final authority checks,
owner isolation, immutable UID epochs, true paging/search/count semantics,
bounded MIME/downloads and cancellation. A source must not mark seen during
list, preload or incidental render work. A capability is actual support, not
a request for the UI to synthesize a successful result.

Persist send intent before external execution. Return the original accepted
receipt on replay, lock ambiguous attempts, and return `pendingSend` with the
original operation ID when such a draft reopens. Surface
`EMAIL_SEND_OUTCOME_UNKNOWN` rather than treating a network failure as safe to
retry. Do not automatically send through a second provider, enqueue the same
message under another ID, or use Guardian's account-action outbox as a generic
mail queue.

The UI recognizes `EMAIL_DRAFT_CONFLICT` and `EMAIL_SEND_OUTCOME_UNKNOWN`.
`EmailInboxRequestError` exposes `code` and `outcome` (`none` or `unknown`).
Other failures are presented without claiming acceptance. Avoid putting raw
provider transcripts, messages or credentials in error strings or logs.
For send operations, generic/untyped failures and post-commit authorization
errors are conservatively uncertain: the controller retains the operation ID
and pauses edits. Only a known pre-execution rejection permits a new intent.
Live adapters must release their producer when aborted even if the consumer
has stopped requesting events. The managed SDK also cancels its response reader
when a custom transport ignores the abort signal.

## Related guides and next steps

- [Managed backend](../../backend/email/inbox.md) is the reference implementation of these semantics.
- [Workspace](./workspace.md) covers source replacement, lifecycle and recovery UI.
- [HTML reader](./html-reader.md) owns rendering after an adapter has authorized the message.
