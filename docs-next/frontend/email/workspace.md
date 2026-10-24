---
id: zero.frontend.email.workspace
type: reference
audience: [developer, agent]
owner: email
status: draft
visibility: internal
system: email
feature: workspace-controller
maturity: preview
applies_to: ["2.6.0 email inbox development source"]
modes: [browser, SSR, managed-server, custom-source]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "7aa638f3d1ad7a66f1856ab0ae2b666b8c45f080"
  snapshot: dirty
  date: "2026-10-23"
  evidence_level: source-observed
---

# Email Workspace and Lifecycle

[Email UI index](./index.md) · [Documentation index](../../index.md)

Use the complete `EmailInbox` for normal assembly. Use `useEmailInbox` and
`EmailInboxWorkspace` when the host needs additional controls around the same
controller. Creating a second controller solely for a reader or folder menu
creates a second lifecycle and is not the intended composition.

## Public surface

| API | Contract |
| --- | --- |
| `EmailInbox` | Props: optional `source`, `scopeKey`, `markSeenOnOpen`, `mailboxSwitcher`, `resizable`, `className`, `toolbar`. The toolbar slot is application-owned content in the mailbox header. |
| `useEmailInbox(options?)` | Returns `{ controller, state }`. Uses `client.emailInbox` by default, owns start/dispose and draft autosave, and follows the authorization boundary. Controller can be null without an available source. |
| `EmailInboxWorkspace` | Presentation over a supplied controller. Props: `controller`, `mailboxSwitcher`, `resizable`, `className`, `toolbar`. It does not start an arbitrary controller itself. |
| `new EmailInboxController(source, scopeKey, options?)` | Advanced non-hook lifecycle. Call `start()`, use `subscribe/getSnapshot`, and call `dispose()` when ownership ends. Hook-owned controllers must not be manually disposed by a part. |
| `initialEmailInboxState()` | Creates an empty loading snapshot, including the SSR fallback. No mail is serialized into the document by this component. |

The hook uses 800ms autosave after editing stops. It pauses after a failed or
conflicted save instead of repeatedly overwriting a draft. Browser unload warns
for unsaved changes and uncertain sends; revocation discards the old scope's
private UI rather than preserving it for another identity.

## Controller actions

Navigation: `selectAccount(id)`, `selectFolder(path)`, `setSearch(text)`,
`setFilter('all'|'unread'|'starred')`, `nextPage()`, `previousPage()`,
`selectRow(row)`, `clearSelection()`, `refresh()`, `retry()`, `clearError()`.
`setNearTop(boolean)` and `showLatest()` let a custom list preserve a scrolled
position when new mail arrives. The supplied list already connects these.

Selection and mail: `check(id, checked)`, `checkAll(checked)`,
`setFlags(row, { seen?, flagged? })`, `move(row, destination)` and
`attachment(file, message?, signal?)`. Bulk actions apply only to checked rows
on the current page. Unsupported capabilities hide or disable the corresponding
actions; they never invent a provider success.

Composition: `compose('new'|'reply'|'reply-all'|'forward')`, `openDraft(id)`,
`updateDraft(value)`, `saveDraft()`, `closeDraft()`, `discardDraft()`,
`copyConflictedDraft()` and `sendDraft()`. Reply respects Reply-To; Reply all
excludes admitted From identities. Forward copies authorized attachment bytes
within the send limits and uses an escaped plain-text quote. It does not import
an arbitrary received newsletter into the rich-text editor unchanged.

## Live updates and state boundaries

One subscription follows the selected account/folder. Reconnection retains
current rows and shows status; it uses a fresh authorized stream. Metadata
invalidations debounce refresh by 180ms, without replaying a first-load
animation. Arrival near the top inserts a row with a small layout animation;
arrival while reading older rows offers New mail. Page changes retain a
bounded list and do not run insertion animation for an unrelated page.

Account, scope and folder changes cancel owned reads and fence late results.
UIDVALIDITY replacement retires stale references and cursor history. Existing
message content is not replaced merely because a star/read flag changed.
Folder counts are provider hints refreshed after relevant events; the active
query's result count is separate and authoritative for its returned page.

## Sending and recovery

Drafts use compare-and-swap revisions. A conflict keeps local text but freezes
saving until the user explicitly keeps a new copy or reopens the stored draft.
Closing or changing folders saves the draft before leaving it. An uncertain
send remains durably locked; the user may close it to inspect Sent and reopen
it without losing its original operation ID.

Send is single-flight in the controller. The backend persists the operation
before contacting the sender and records acceptance before returning success.
An explicit Check send result reuses that operation, rather than sending under
a fresh ID. A receipt replay can recover an accepted send even after its draft
was removed. A partial acceptance or failed Sent copy has its own notice and
is not an invitation to resend the whole message. SMTP acceptance is not
recipient delivery or a read receipt.

## Related guides and next steps

- [Reusable parts](./parts.md) shows the composition boundaries for custom layouts.
- [Managed inbox](../../backend/email/inbox.md) owns durable receipt and authorization semantics.
- [Adapter contract](./source.md) lists the same obligations for custom transports.
