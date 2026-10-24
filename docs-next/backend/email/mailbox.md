---
id: zero.email.mailbox
type: reference
audience: [developer, agent, operator]
owner: email
status: draft
visibility: internal
system: email
feature: imap-receiving
maturity: supported
applies_to: ["2.6.0 development source; not package-qualified"]
modes: [managed-server, standalone-server]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "8850d12a24f1744818ab17fa37bb3dbf235229da"
  snapshot: dirty
  date: "2026-10-22"
  evidence_level: source-observed
---

# IMAP Mailboxes and Live Updates

[Email index](./index.md) · [SMTP sending](./smtp.md)

Enable `email.imap` to add an app-owned receiving mailbox alongside any send
provider. Zero supplies the IMAP connection, MIME parsing, attachment handling
and live IDLE subscription behind `zero.mailbox`. It does not start a mail
server, expose an anonymous inbox endpoint or automatically copy private mail
into application tables.

## Enable Receiving

For apps using `email: emailFromEnv()`, add:

```dotenv
IMAP_HOST=imap.purelymail.com
IMAP_PORT=993
IMAP_USER=join@example.test
IMAP_PASSWORD=replace-with-mailbox-app-password
# Optional; leave unset if the server already saves outgoing mail.
# IMAP_SENT_FOLDER=Sent
```

Purelymail documents `imap.purelymail.com:993` with implicit TLS and a full
mailbox-address username. Use an app password when its two-factor
authentication is enabled. [Purelymail technical setup](https://purelymail.com/docs/setup/technical)

SMTP and IMAP are independently optional. With only `IMAP_HOST` configured,
`emailFromEnv()` selects a receive-only runtime with `provider: 'noop'`.
Guardian correctly considers sending unavailable. With SMTP configured too,
the same managed runtime exposes sending and receiving. Omitting `imap` or
setting it false creates no receiving service; configuring it does not open
sockets until an operation/subscription is used.

An explicit alternative is:

```ts
email: {
  provider: 'smtp', from: 'Example <join@example.test>',
  smtp: { host: 'smtp.purelymail.com', port: 465 },
  imap: {
    host: 'imap.purelymail.com', port: 993,
    auth: { user: Bun.env.IMAP_USER, pass: Bun.env.IMAP_PASSWORD },
    maxMessageBytes: 25 * 1024 * 1024,
    // sentFolder: 'Sent', // opt in only when needed
  },
},
```

The common connection fields follow [SMTP configuration](./smtp.md), using
`IMAP_*` variables instead of `SMTP_*`. IMAP requires a username/password;
implicit TLS defaults to port 993, or port 143 uses required STARTTLS.
Certificate verification cannot be disabled. `maxMessageBytes` defaults to
25 MiB and accepts 1 byte–100 MiB. It bounds raw MIME download/parse size,
including encoded attachments; it is not a per-attachment decoded size.

## Mailbox API

Use `zero.mailbox` inside an already-authorized server operation. It is null
when receiving is disabled. Its types and standalone `ImapMailbox` class are
exported from `@zero/framework/email` and the server barrel.

| Method | Result and behavior |
| --- | --- |
| `verify({ signal? })` | Explicit connection/TLS/login probe; never reads message bodies. |
| `folders({ signal? })` | Folder paths, names, special-use hints and flags. |
| `list(options?)` | Bounded UID page of headers/envelopes, flags, sizes and stable identifiers. Default folder INBOX, limit 50; maximum 200 UID positions. |
| `read(ref, { signal? })` | Text/HTML, addresses, threading headers and in-memory attachments. Reading does not mark a message seen. |
| `setFlags(ref, { seen?, flagged?, answered? }, { signal? })` | Explicit flag mutation. No blanket delete/expunge operation is exposed. |
| `move(ref, destination, { signal? })` | Server MOVE, returning the destination's stable identifier. Servers lacking MOVE are rejected rather than using unsafe COPY/EXPUNGE fallback. |
| `append(message, { folder, draft?, messageId?, signal? })` | Save a composed draft or sent copy. Returns a stable reference, or null if accepted without UIDPLUS identifiers. |
| `watch({ folder?, signal? })` | Async iterable of live mailbox changes, reconnect and resync events. Requires server IDLE support. |
| `close()` | Stop owned work and close connections. Managed app shutdown calls it. |

Folder creation, filtering/Sieve, mailbox provisioning and inbound-domain
routing stay with the mail server. An email interface can use this API for its
mail operations without implementing a transport. Its frontend layout,
business permissions and retention policy remain app decisions.

## Stable Identity and Bounded Paging

Every message reference has `{ folder, uidValidity, uid }`. UIDVALIDITY is a
string so it survives JSON serialization; the UID is a positive integer.
Never use changing sequence numbers, row indexes or Message-ID as the mailbox
record identity. Mutations and reads check the epoch before accessing a UID.
A changed epoch raises `EMAIL_MAILBOX_RESYNC_REQUIRED`/409 instead of touching
an unrelated message with a recycled UID.

```ts
const page = await mailbox.list({ folder: 'INBOX', limit: 50 });
const older = page.hasMore
  ? await mailbox.list({
      folder: page.folder, uidValidity: page.uidValidity,
      beforeUid: page.nextBeforeUid, limit: 50,
    })
  : null;
```

Pages scan bounded UID windows, not the entire mailbox. Deleted UIDs and search
filters can produce fewer results, or an empty page with `hasMore: true`.
Continue using the returned cursor until `hasMore` is false; do not stop just
because a page is empty. `query` supports `from`, `to`, `subject`, `text`,
`seen` and `flagged` within that window.

For incremental ingestion, use `afterUid` and advance `nextAfterUid` even when
there are gaps. `afterUid: 0` starts an initial ascending scan. Supply the saved
epoch on subsequent calls. Before/after cursors are mutually exclusive.
Persist an epoch/cursor and derived rows together only after the corresponding
application write commits; reconnect alone does not prove ingestion succeeded.

## Real Time Through IDLE

`watch()` keeps an authenticated IMAP IDLE connection rather than repeatedly
loading the inbox. It publishes metadata signals; fetch only the needed UID
windows/messages through the same facade. The application can commit those
changes to its authorized ReactiveDB tables so existing Sync subscriptions
update clients. Zero does not choose a shared/global mail table or tenant
mapping on an application's behalf.

```ts
for await (const change of mailbox.watch({ folder: 'INBOX', signal })) {
  // change is a typed metadata event. Reconcile only the affected folder/UIDs
  // through mailbox.list/read and the app's existing authorized data layer.
  await inboxService.reconcile(change);
}
```

`inboxService` above is an application's domain operation, not a Zero-provided
service or a transport adapter applications must build. The IMAP module itself
already owns connectivity, parsing, backpressure and reconnection.

| Event | Consumer action |
| --- | --- |
| `resync` with `connected` | Establish a baseline/cursor using its folder, epoch, count and UIDNEXT. |
| `arrival` | Compare saved epoch/cursor and fetch new UIDs with `afterUid`; the event count is not itself a UID. |
| `flags` | Update the named UID's flags within that epoch. |
| `removed` | Remove the named UID, when the server supplied a stable UID. |
| `resync` with `sequence-expunge` | Reconcile membership; never guess a removed UID from a sequence number. |
| `resync` with `unidentified-flags` | Reconcile flags when a server did not identify the changed UID. |
| `resync` with `reconnected` | Reconcile changes missed while disconnected; discard old identifiers if the epoch changed. |
| `resync` with `overflow` | Consumer fell behind the bounded queue; reconcile instead of assuming all deltas arrived. |

Each subscription owns one connection. An instance admits at most eight
simultaneous operations/subscriptions; share a server-side subscription for an
app mailbox rather than opening one per browser. Connection attempts have the
configured deadline. Transient disconnects reconnect with bounded exponential
backoff; IDLE is renewed after 25 minutes. Unsupported IDLE raises
`EMAIL_MAILBOX_IDLE_UNSUPPORTED`/409, not a hidden polling fallback.
Iterator return, AbortSignal and managed shutdown retire the actual socket,
including when a consumer is waiting for its next event. Queues cap at 128
events and signal resynchronization when overloaded.

## Ownership and Security

The configured mailbox is app-global, not automatically the signed-in user's
mailbox. Normal multi-tenant request and workflow projections block raw mailbox
access. Deliberate privileged server code can use `zero.unsafe.mailbox` only
after applying live permissions and server-derived mailbox/tenant targets.
Do not catch the guard and silently bypass it. A per-user mail product must
own account provisioning, encrypted credential storage and which users may use
which mailbox; enabling IMAP does not create those policies.

No credentials or message bodies are included in change events. HTML, links,
addresses and filenames remain untrusted mail content: sanitize HTML, control
remote images, validate attachment downloads and never use a supplied filename
as a filesystem path. MIME parsing has size, header, nesting and part limits.
Neither reading nor moving performs a blanket mailbox expunge.

Generic operations use independent bounded connections, so an IDLE listener
does not occupy a lock required by a read/write call. A move accepted without
a stable UID map requires reconciliation; do not blindly retry it. A draft or
copy accepted without UIDPLUS returns null for the same reason.

## Verification and Lifecycle

Doctor checks receiving configuration even when Guardian auth is disabled and
does not contact the server. A standalone runtime/class must be closed by its
owner. Managed `createApp` closes its mail runtime after draining owned auth
delivery work; enabling this module requires no database migration.

Implementation: `src/email/imap-mailbox.ts`, `imap-mailbox-watch.ts`, and
`mailbox-types.ts`. Protocol tests cover sparse UID pages, MIME/attachments,
epoch changes, IDLE signals, reconnect, bounded queues, abort and shutdown.
Check provider permissions, folders and an authorized test mailbox before
using a production account.
