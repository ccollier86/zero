---
id: zero.frontend.email.parts
type: reference
audience: [developer, agent]
owner: email
status: draft
visibility: internal
system: email
feature: component-parts
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

# Email Component Parts

[Email UI index](./index.md) · [Documentation index](../../index.md)

All parts below come from `@zero/framework/email-inbox`. The source family is
`src/components/email-inbox/`; the `html/` folder holds the message safety
pipeline. Reuse exported parts rather than deep-importing private parser,
editor or transport internals.

## Parts sharing the workspace controller

`EmailFolderNav`, `EmailMessageList`, `EmailReader` and `EmailComposer` accept
`{ controller, state, onAction }`. Obtain controller/state from
`useEmailInbox`; `onAction(work)` runs a promise and presents its rejection
under the still-current scope. The default workspace supplies that error owner.
Parts do not open new mail connections.

| Part | Behavior |
| --- | --- |
| `EmailFolderNav` | Visible special folders, optional custom folder disclosure, shared ScrollArea and one paint-only magnetic highlight. Paths come from admitted server metadata. |
| `EmailMessageList` | Folder title/count, bounded search, All/Unread/Starred, magnetic hover paint, page-local selection and bulk actions, scrolling, live-insertion affordance and pagination. Up/Down/Home/End move row focus; Enter opens the focused message. |
| `EmailReader` | Message toolbar, isolated HTML/plain switch, headers, safe downloads, Reply/Reply all/Forward and an explicit empty/loading state. Archive/Trash are offered only when those special-use folders exist. |
| `EmailComposer` | To/Cc/Bcc, admitted From identities, subject, lazy structured Tiptap editor, formatting controls, attachments, draft state, send recovery and managed discard confirmation. Ctrl/Cmd+Enter submits. |

## Focused presentation parts

| Part | Inputs and responsibility |
| --- | --- |
| `EmailMailboxSwitcher` | `accounts`, `selected`, `onChange(id)`, `enabled?`. Uses rich Zero Select items; a single mailbox needs no switcher menu. |
| `EmailMessageRow` | `row`, `selected`, `checked`, `onSelect`, optional `onCheck`, `onStar` and `animateInsert`. Omit `onCheck` when the binding has no bulk write capability. Stable row keys are message-reference keys, not list indexes. It does not mark seen on hover. |
| `EmailHeaders` | `message`. Sender avatar initials are presentation, not identity verification. A shared Popover reveals available recipients, Reply-To and exact timestamp; Bcc appears only if actually present in the authorized message. |
| `EmailAttachments` | `files`, `onDownload(file)`. Download chips show filename and size. Rendering a chip never fetches a remote URL or grants file authority. |
| `EmailRecipientField` | `label`, `value`, `onChange`, `disabled?`, optional controlled `draft`/`onDraftChange`. Accepts plain addresses separated by commas/semicolons; Enter and blur commit chips. The composer persists unfinished recipient input too. It intentionally does not parse arbitrary display-name address syntax. |
| `EmailHtmlBody` | Safe reusable HTML document with an explicit content/scope key and optional authorized inline-image loader. [Full contract](./html-reader.md). |
| `EmailPlainTextBody` | `text`, `className?`. Escaped, wrapping plain text; never raw HTML fallback. |

`EmailComposeValue` and all account/message/draft/source types are exported.
The formatting editor is private to `EmailComposer`; it has a narrower schema
than the received-email renderer. Received scripts, layout styles and image
resources never become editor commands.

## Related guides and next steps

- [Workspace and lifecycle](./workspace.md) owns controller startup, accepted actions and cleanup.
- [UI reference](../ui-reference.md) owns token/motion/overlay choices used by the parts.
- [HTML reader](./html-reader.md) explains the intentional boundary between app chrome and authored mail.
