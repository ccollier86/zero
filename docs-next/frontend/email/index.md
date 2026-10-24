---
id: zero.frontend.email
type: index
audience: [developer, agent]
owner: email
status: draft
visibility: internal
system: email
feature: inbox-workspace
maturity: preview
applies_to: ["2.6.0 development source on the email inbox feature branch; not a published release"]
modes: [browser, SSR, managed-server, Guardian-single, Guardian-multi-custom-adapter]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "7aa638f3d1ad7a66f1856ab0ae2b666b8c45f080"
  snapshot: dirty
  date: "2026-10-23"
  evidence_level: source-observed
---

# Email Inbox

[Frontend index](../index.md) · [Documentation index](../../index.md)

`EmailInbox` is an optional email workspace, not a chat or notification inbox.
It combines visible folders, a searchable message list, an isolated HTML reader
and a rich-text composer. The host retains its existing AppShell navigation;
the inbox adds a resizable mail sidebar and reading area inside that shell.
On a phone, Back switches between the list and detail without duplicating the
composer tree.

## Choose an integration

| Guide | Purpose |
| --- | --- |
| [Configuration](./configuration.md) | Enable managed mail and mount the workspace under the existing providers. |
| [Workspace and lifecycle](./workspace.md) | Organism props, controller, hook, live insertion, drafts and send recovery. |
| [Reusable parts](./parts.md) | Folder navigation, mailbox switcher, message rows, headers, reader, composer, recipients and attachments. |
| [HTML reader](./html-reader.md) | Sanitization, privacy, isolated layout, CID images, links and fallback. |
| [Adapter contract](./source.md) | Reuse the UI over an app-owned authorized mail backend. |
| [Roadmap](./roadmap.md) | Conversation view, account provisioning and distributed state work that is not part of this baseline. |
| [Managed backend](../../backend/email/inbox.md) | Guardian policy, endpoint contract, durable state, limits and operations. |

Use `@zero/framework/email-inbox` for the narrow browser-safe entry point.
The same UI exports are available from `@zero/framework/react`. Server provider
classes remain at `@zero/framework/email`; do not import them into a page.

## Composition and design

The workspace uses Zero's compact semantic surfaces, typography, controls,
magnetic folder highlight, shared ScrollArea, Select, Popover, Tooltip and
ModalManager. It reuses an existing modal host and supplies one when embedded
alone. It does not replace the app's theme, primary sidebar or navigation owner.
Received HTML keeps its sender's presentation inside a separate white email
document, including in a dark application; that is not a competing app theme.

One controller owns the source, selection, requests and live subscription. Parts
do not connect independently. Live mail retains existing row nodes and selection;
an older scrolled position gets a New mail action instead of a forced jump.
The list is bounded to 40 messages per page, not a full-mailbox DOM tree.

## Related guides and next steps

- [Email setup](../../backend/email/index.md) supplies SMTP/IMAP and Guardian delivery independently of this optional UI.
- [Application UI development](../../guides/application-ui-development.md) explains the surrounding shell and provider composition.
- [UI reference](../ui-reference.md) owns tokens and shared action-to-motion rules.
- [Authorization scope](../runtime/authorization-scope-boundary.md) explains why an identity or tenant change retires private inbox state.
