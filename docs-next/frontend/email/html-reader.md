---
id: zero.frontend.email.html-reader
type: reference
audience: [developer, agent, maintainer]
owner: email
status: draft
visibility: internal
system: email
feature: html-reader
maturity: preview
applies_to: ["2.6.0 email inbox development source; HTML policy version 1"]
modes: [browser, SSR]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "7aa638f3d1ad7a66f1856ab0ae2b666b8c45f080"
  snapshot: dirty
  date: "2026-10-23"
  evidence_level: source-observed
---

# Safe HTML Email Reader

[Email UI index](./index.md) · [Documentation index](../../index.md)

`EmailHtmlBody` preserves useful email tables, inline formatting, style blocks
and admitted responsive CSS without giving the sender access to the app DOM.
It uses the browser's layout engine, parse5 for network-free preprocessing,
CSS Tree for a restrictive CSS policy and DOMPurify for the final HTML pass.
It is not `dangerouslySetInnerHTML` inside a themed application card.

```tsx
import { EmailHtmlBody } from '@zero/framework/email-inbox';

<EmailHtmlBody
  html={message.html ?? ''}
  text={message.text}
  contentKey={`${authorizationScopeKey}:${accountId}:${message.id}`}
  allowRemoteImages={false}
/>
```

The body must already belong to an authorized message. The renderer sanitizes
content; it does not decide whether the current user may access it.

## Props and ownership

| Prop | Meaning |
| --- | --- |
| `html`, `text?` | Received HTML and escaped plain-text fallback. |
| `contentKey` | Required identity/revision key including authorization scope, account and message. Changing it retires image work and remote-image consent. |
| `loadInlineImage?(contentId, signal)` | Authorized bytes loader for a CID in this message only. Never accept a raw remote URL as the loader's target. Duplicate/missing CIDs fail closed. |
| `allowRemoteImages?` | Default true permits an explicit Load images button; remote images are still blocked initially. False disables that opt-in and retires an active allowance. |
| `onOpenLink?(url)` | Optional host navigation/confirmation callback for a validated external link. Default opens with `noopener,noreferrer`; local fragments stay within the email. |
| `title?`, `className?` | Accessible iframe title (default Email content) and surrounding layout. |

## Security and privacy policy

The preprocessing tree never fetches. It removes scripts, foreign namespaces,
forms, frames, base/meta/link directives, event handlers, srcset, sender data
URLs and unsupported resource surfaces. CSS uses an AST allowlist: URL/import/
font loads, unknown functions, positioning overlays, animations, custom
properties and sender-owned scroll traps are not admitted. The app does not
promise pixel-identical rendering of unsafe or unsupported email CSS.

The final document has `sandbox="allow-same-origin"` without `allow-scripts`,
and CSP denies scripts, connect, forms, frames, objects, fonts and base URLs.
Same-origin access is retained solely so the trusted parent can size the
scriptless document and intercept safe link gestures. No sender script or
message bridge is enabled. Do not add `allow-scripts` to this sandbox.

Remote images are blocked by default. Explicit consent enables validated
http/https image origins for that message only. App-host, relative, credential-
bearing, literal-IP and local/private-name image URLs remain rejected. The
browser may reveal its IP and opening time after consent; this version does
not supply an anonymizing image proxy. Consented URLs remain outside the
sanitizer's detached DOM and enter the final serialized iframe only behind its
CSP and no-referrer policy. No backend arbitrary-URL fetch is provided.

CID images come from the authorized attachment API. The reader checks PNG,
JPEG, GIF or WebP signatures/dimensions and converts admitted bytes to local
image data; SVG/HTML and decompression-sized dimensions are rejected. No CID
contains credentials or a public attachment URL. Failed inline files remain
available through the separately authorized attachment download UI.

## Limits and fallback

Policy version 1 allows 2 MiB HTML, 25,000 nodes, depth 128, 256 KiB CSS,
4,000 CSS-rule/declaration visits and 100 image elements. Inline images are
limited to 5 MiB each, 40 million pixels and 12 MiB aggregate loaded bytes.
Oversized/invalid HTML gives escaped plain text with an explanation. The
underlying MIME mailbox has its own independent size limits.

The parent owns vertical sizing, bounds resize feedback and caps measured
height at 200,000px. A wide message uses a shared horizontal ScrollArea, not a
page-wide scrollbar; measured width is capped at 10,000px. Unusually large
layouts may be constrained. The email uses a readable light canvas even when
the app is dark; original email CSS is isolated rather than globally rethemed.
SSR renders an empty preparation state and does not require a server DOM.

## Verification and maintenance

Keep DOMPurify and the parser dependencies patched together with this policy.
Changes require hostile HTML/CSS tests and browser network assertions, not only
string snapshots. The current focused browser suite exercises Chromium;
Firefox/WebKit qualification remains an explicit release gate. The tests also
cover no passive requests, consent referrer behavior, responsive overflow,
mobile navigation and app-CSS isolation.

## Related guides and next steps

- [Workspace](./workspace.md) supplies scoped messages and loader cancellation.
- [Managed backend](../../backend/email/inbox.md) authorizes MIME bytes and forces safe download headers.
- [Roadmap](./roadmap.md) separates image proxies and further browser qualification from the current implementation.
