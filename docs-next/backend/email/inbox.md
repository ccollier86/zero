---
id: zero.email.inbox
type: reference
audience: [developer, agent, operator]
owner: email
status: draft
visibility: internal
system: email
feature: managed-inbox
maturity: preview
applies_to: ["2.6.0 email inbox development source; not a published release"]
modes: [managed-server, Guardian-single, Guardian-multi-custom-resolver]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "7aa638f3d1ad7a66f1856ab0ae2b666b8c45f080"
  snapshot: dirty
  date: "2026-10-23"
  evidence_level: source-observed
---

# Managed Email Inbox Service

[Email index](./index.md) · [Documentation index](../../index.md)

`email.inbox` opts a managed app into an authenticated browser bridge over
the existing mail providers. It adds private drafts and send receipts, not a
new mail server, generic unauthenticated send route or automatic copy of mail
into application tables. The [Email UI](../../frontend/email/index.md) consumes
this bridge through the existing authenticated SDK.

## Exact configuration

Import `EmailInboxConfig` and `EmailInboxServerAccount` from
`@zero/framework/email` or `@zero/framework/server` for server configuration.

| Setting | Default and behavior |
| --- | --- |
| `email.inbox` | Omitted/false mounts no inbox routes and creates no inbox state file. An object enables the feature. Guardian must be enabled. No automatic environment flag enables it. |
| `statePath` | Required dedicated private SQLite file, resolved relative to projectRoot. Cannot be app sources, output assets or served storage, including symlink aliases. Existing unrelated DBs and group/world-readable state files are rejected. `:memory:` is for tests only. |
| `access` | Guardian AccessRequirement; default `admin`. Authentication remains required even with a permissive declaration. Choose a narrower permission/role policy deliberately for shared staff mail. |
| `label` | Optional default mailbox label, otherwise app name or Mailbox. |
| `accounts(context)` | Optional server resolver of admitted `EmailInboxServerAccount[]`; required in multi tenancy. Read the current Guardian scope from context, never a browser tenant parameter. Maximum 50 distinct accounts. |

Settings are captured when the app starts. The resolver runs per request and
again after provider reads before private data is returned. It must return
stable app-owned mailbox objects; manufacturing a new IMAP client per request
breaks live ownership and final binding checks. Provision and close custom
mailbox/sender instances with the app's own lifecycle; the service only owns
its inbox state and subscriptions, not arbitrary resolver dependencies.

An admitted account supplies `id`, `label`, `address`, `mailbox` and optional
`sender`, `sendAs`, `readOnly`, `live`. Mailbox implements the typed
folders/browse/read/setFlags/move/watch facade. `sendAs` is a list of explicit
`{id,address,name?}` identities. Omit sender/identities for receive-only mail;
`readOnly` also disables flag/move/draft writes. `live:false` disables IDLE for
that binding. A browser cannot submit arbitrary hosts, credentials, From
addresses or account owners.

Without a resolver, single-tenant mode uses the app's configured IMAP mailbox,
ready email service and configured From identity under account ID `default`.
It is admin-only unless `access` explicitly changes. This is a shared mailbox,
not automatic personal mail for every Guardian user. Multi mode has no fallback
to that global mailbox.

## Routes and authenticated client

The prefix is `/api/_zero/email-inbox`. All endpoints require an admitted
Guardian session. JSON responses are private/no-store. Each body includes an
admitted `account` except GET accounts. The public browser contract is
`client.emailInbox`; application pages should not manually recreate these
requests or authenticate IMAP directly.

| Method and suffix | Input |
| --- | --- |
| GET `/accounts` | Current principal's admitted catalog. |
| GET `/folders` | Query `account`. Returns provider counts and private Drafts. |
| POST `/messages` | `{account,query:{folder,cursor?,search?,filter?,limit?}}`. |
| POST `/message` | `{account,ref}`. Read does not mark seen. |
| POST `/attachment` | `{account,ref,id}`. Binary download, not JSON bytes. |
| POST `/flags` | `{account,ref,flags:{seen?,flagged?}}`. |
| POST `/move` | `{account,ref,destination}`. Returns new ref. |
| POST `/draft/read` | `{account,id}`. |
| POST `/draft/save` | `{account,id,revision,value}`. |
| POST `/draft/delete` | `{account,id,revision}`. |
| POST `/send` | `{account,operationId,value,draft?:{id,revision}}`. |
| GET `/live` | Query `account,folder`. SSE metadata, not message bodies. |

Message refs contain folder, UIDVALIDITY and UID. IMAP UID epochs must never be
discarded or confused with sequence numbers. The browser treats cursors as
opaque. List limit is 1–100, default 40; search is at most 1,000 characters.
The browse API searches the whole selected mailbox and returns exact matching
counts, with a 250,000-result cap requiring a narrower query. Existing mailbox
`list()` remains the distinct bounded UID-window ingestion API; `browse()`
is the user-facing paged search. The list does not fetch full MIME for every row.

Attachment IDs are indexes within an authorized immutable message. Every
download revalidates the account and reads the bounded message. It uses
octet-stream, attachment disposition, nosniff, no-store and restrictive CSP.
The renderer separately validates any inline image bytes.

## Draft ownership and send safety

Private Drafts use virtual folder `@drafts`, partitioned by server-derived
scope, tenant, user and account. Provider Drafts remains a distinct folder.
Revisions are compare-and-swap: stale edits/deletes return
`EMAIL_DRAFT_CONFLICT`. Draft queries use bounded keyset pages and true counts,
not a hard-coded 200-row result masquerading as the whole folder.

Each send reserves `{owner,account,operationId,digest}` in an immediate SQLite
transaction before external execution. Reusing an ID with changed content
returns `EMAIL_SEND_ID_CONFLICT`; replaying an accepted operation returns its
stored receipt even if its draft was already deleted. Sending/unknown attempts
lock their draft against another send, save or deletion. Reopening such a draft
returns `pendingSend` with the original operation ID. A crash after external
execution but before receipt persistence remains unknown, never automatically
retried. SQLite idempotency cannot turn SMTP into exactly-once delivery.
Provider idempotency keys hash the durable owner, account and operation ID; two
users cannot collide merely by choosing the same visible operation ID, and raw
ownership identifiers are not sent as provider keys.

Acceptance is persisted before final authorization revalidation. If access is
revoked while sending, the request can be rejected without erasing the receipt
or causing a replay to send again. A Sent-copy failure is a separate receipt
field; partial acceptance identifies rejected recipients. Neither is reported
as “nothing was sent.” Unknown outcomes return
`EMAIL_SEND_OUTCOME_UNKNOWN`; inspect Sent/provider evidence before creating
another copy. No automatic transport fallback or Guardian outbox enqueue occurs.

An authorization failure after SMTP acceptance also reports an uncertain send,
without returning private receipt details to a revoked caller. Generic server
errors and untyped custom-adapter failures are not treated as proof that nothing
was sent: the browser keeps the original operation ID and freezes the draft for
recovery. Completed send receipts cannot be overwritten by later error handling.
Outgoing inputs are captured before asynchronous account resolution.

Outgoing values allow up to 100 addresses in each To/Cc/Bcc array, 20
attachments, 10 MiB per attachment, 15 MiB total attachment bytes, 998-character
subjects and 1,000,000-character text/HTML fields. The deployment's HTTP body
limit must also admit the base64-expanded envelope. Header controls and invalid
base64/size mismatches are rejected before send admission.

## Live ownership and operations

SSE fans out one provider IDLE watch per actual mailbox/folder inside an app
runtime. The last subscriber retires that watch. Queues are bounded; slow
consumers receive invalidation/reconnect instead of an unlimited backlog.
Delivery is pull-based, including 10-second keepalives. A paused reader does not
accumulate heartbeat frames. Every delivered event/keepalive rechecks the session
and resolver binding; abort releases the provider subscription even if the
consumer is suspended at a yield.
Managed shutdown aborts streams, stops new request admission and waits for
admitted operations to persist their results before closing the private store.
The dedicated inbox database uses SQLite synchronous FULL. The underlying
SMTP/IMAP connection/deadline limits still apply. There is no hidden mailbox
polling loop or full-message SSE payload.

Back up the private state file with its SQLite WAL consistently and retain
send receipts at least as long as an old operation can be replayed. This
baseline does not prune receipts automatically. The file is private plaintext,
not an encryption-at-rest service. Secure host storage/backups appropriately.
Do not deploy separate state copies behind round-robin replicas: they do not
share idempotency or draft notifications. A distributed/Fabric-backed state
adapter is separate work, not silently inferred from local SQLite locks.

Doctor reports configuration issues and in-memory-state warnings without
connecting or sending probe mail. It does not prove DNS/TLS credentials or
mail delivery. Framework integration tests use managed createApp, real Guardian,
loopback SMTP/IMAP, binding revocation and lost-response receipt replay.

## Related guides and next steps

- [Email UI configuration](../../frontend/email/configuration.md) mounts the workspace correctly.
- [Source contract](../../frontend/email/source.md) defines the equivalent custom-adapter obligations.
- [HTML reader](../../frontend/email/html-reader.md) owns message rendering rather than transport authority.
- [Receiving](./mailbox.md) owns MIME limits, UID epochs and the underlying IMAP lifecycle.
- [Roadmap](./roadmap.md) separates further delivery and inbox capabilities from this opt-in baseline.
