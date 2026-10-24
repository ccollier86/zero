---
id: zero.email.html-rendering-plan
type: architecture
audience: [developer, agent, maintainer]
owner: email
status: draft
visibility: internal
system: email
feature: email-html-rendering
maturity: planned
applies_to: ["2.6.0 working source; proposed received email renderer"]
modes: [browser, SSR, managed-server, Guardian single, Guardian multi]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "7aa638f3d1ad7a66f1856ab0ae2b666b8c45f080"
  snapshot: dirty
  date: "2026-10-22"
  evidence_level: source-observed
---

# HTML Email Rendering Plan

[Working evidence](./index.md) · [Email Inbox plan](./email-inbox-plan.md) · [Current mailbox API](../backend/email/mailbox.md)

Use the browser's layout engine inside an isolated email document, with
DOMPurify for HTML sanitization and an explicit email CSS/resource policy.
Qualify CSS Tree for CSS parsing and parse5 for a non-fetching preprocessing
pass. This stack now backs the working-source `EmailHtmlBody`; the
[current manual](../frontend/email/html-reader.md) owns its implemented contract.
The comparisons and wider qualification plan remain design evidence, not an
assertion that installing a package secures an inbox.
The inbox's buttons, folders, menus and scroll treatment remain Zero components;
the sender's email layout does not become a collection of themed application cards.

## Implemented Choice

The initial implementation qualifies the scriptless `allow-same-origin`
alternative described below, with no `allow-scripts`, restrictive CSP and
parent-owned sizing/link handling. Chromium regressions check no passive
requests, no app CSS contamination, consent-only image loads without a Referer,
wide-message shared ScrollArea and scoped cleanup. Remote image URLs remain
out of the sanitizer's detached DOM until trusted final serialization. This
is not an opaque-origin design or completed Firefox/WebKit qualification.
The dependencies are DOMPurify 3.4.17, CSS Tree 3.2.1 and parse5 8.0.1.

## Library Recommendation

No single reviewed package supplies the full Zero contract: faithful received
mail, blocking of passive network requests, authorized CID attachments, isolation,
accessible links, automatic sizing and integration with the shared ScrollArea.
Keep the wrapper small and use maintained parsers/security libraries for their
actual responsibilities instead of writing an HTML sanitizer or layout engine.

| Responsibility | Recommended foundation | Boundary |
| --- | --- | --- |
| MIME decoding | Existing PostalMime integration | Preserve the current mail transport. MIME parsing does not sanitize HTML. |
| Non-fetching HTML preprocessing | parse5 | Parse a bounded tree and neutralize resource/navigation surfaces before a browser DOM parse. A parser alone is not a sanitizer. |
| HTML security | DOMPurify, dedicated instance and narrow email policy | Final browser-side HTML pass; do not weaken namespace, clobbering or executable-URL defenses. |
| Email CSS | CSS Tree plus a versioned allowlist | Parse declarations, selectors and admitted media rules. Grammar validation alone does not make CSS safe. |
| Layout and isolation | Native browser iframe, restrictive CSP and qualified sandbox | Retain table layouts and responsive email CSS without exposing the app document. |
| Reader integration | Proposed Zero EmailHtmlBody | Own resources, lifecycle, blocked-content controls, links, sizing, fallback and scroll behavior. |

[parse5](https://github.com/inikulin/parse5/blob/b45055d18d58026a1de7016dfb7c6804a459668f/README.md)
provides an HTML-standard parser/serializer.
[CSS Tree](https://github.com/csstree/csstree/blob/f8980154f79110833bf56c391cd45fe5f9205752/README.md)
provides detailed CSS syntax trees, traversal, generation and syntax matching.
Neither project promises an email security policy; that policy is Zero's work.

DOMPurify's own threat model explicitly excludes CSS attacks and reliable
prevention of resource-request leaks. It belongs in the stack, but cannot be
the whole stack. Keep any resource rewrite inside the reviewed pipeline and
run the final sanitizer after transformations, not before an unreviewed HTML
postprocessor.
[DOMPurify threat model](https://github.com/cure53/DOMPurify/wiki/Security-Goals-%26-Threat-Model#non-goals),
[safe output handling](https://github.com/cure53/DOMPurify#is-there-any-foot-gun-potential).

## Alternatives and Webmail References

| Option | Useful properties | Decision for Zero |
| --- | --- | --- |
| DOMPurify with an email-specific pipeline | Mature HTML security project; browser DOM behavior, configurable policy and hooks. | Preferred security core, not advertised as a complete email renderer. |
| react-letter and lettersanitizer | Email-specific React display, style support, resource/link rewrite callbacks and optional sandboxed iframe. | Useful comparison candidate. Its defaults do not enforce Zero's isolated, remote-blocked reader contract; its CSS URL handling uses regular expressions. Prefer DOMPurify plus an AST-based CSS policy as the security foundation. |
| sanitize-html | Established server-oriented HTML allowlist/transform API. | Server-side alternative if separately needed, not a second default sanitizer. Its documented inline CSS URL filtering depends on caller policy, and allowing style blocks needs particular care. |
| Proton Mail renderer and Tuta sanitizer | Real webmail examples of separating message processing, resources and rendering. | Architecture references, not drop-in dependencies or code to copy into Zero without a license review. Their source trees carry GPL-3.0 licenses and application-specific integration. |
| React Email Render | Generates outgoing HTML from React email templates. | Not a viewer or security boundary for received HTML. Do not substitute it for the incoming renderer. |

Source details behind these comparisons:

- [react-letter's component](https://github.com/mat-sz/react-letter/blob/aaf99a34bea41b1268e6d453bbe0ee0a294489f0/src/Letter.tsx)
  uses lettersanitizer; iframe rendering is optional. Its
  [configuration guide](https://github.com/mat-sz/react-letter/blob/aaf99a34bea41b1268e6d453bbe0ee0a294489f0/README.md)
  documents resource callbacks. The reviewed
  [lettersanitizer implementation](https://github.com/mat-sz/lettersanitizer/blob/2071884eb16abd2924a6cf1641b5c94cde193cb3/src/index.ts)
  parses with DOMParser and rewrites CSS URL strings. This is a design comparison,
  not a claim of a demonstrated vulnerability in its current release.
- [sanitize-html's current manual](https://github.com/apostrophecms/apostrophe/blob/2e1277dd543de306cd40b7365fbe13bbd675f30c/packages/sanitize-html/README.md#allowed-css-styles)
  describes caller-controlled CSS filtering. The current package lives in the
  Apostrophe monorepo; the old standalone repository is archived, which must not
  be mistaken for proof that the package itself stopped receiving maintenance.
- Proton uses [DOMPurify-based processing](https://github.com/ProtonMail/WebClients/blob/1062814a51f5049aa24c806e9b2af3cd4eaad6c3/packages/sanitize/src/purify.ts)
  and a separate [message iframe component](https://github.com/ProtonMail/WebClients/blob/1062814a51f5049aa24c806e9b2af3cd4eaad6c3/packages/mail-renderer/src/components/MessageBodyIframe.tsx).
  Tuta's [sanitizer](https://github.com/tutao/tutanota/blob/f5e2d8628f17be558fe63130396ff625bbe69c77/src/applications/common/misc/HtmlSanitizer.ts)
  also uses DOMPurify, with explicit external-content handling; its policy forbids
  style blocks. These are useful differing fidelity/security choices, not settings
  to copy blindly. See their [Proton license](https://github.com/ProtonMail/WebClients/blob/1062814a51f5049aa24c806e9b2af3cd4eaad6c3/LICENSE)
  and [Tuta license](https://github.com/tutao/tutanota/blob/f5e2d8628f17be558fe63130396ff625bbe69c77/LICENSE.txt).
- [React Email Render](https://react.email/docs/utilities/render) is explicitly
  a React-to-email-template utility.

## Proposed Rendering Algorithm

1. **Accept only an authorized message body.** Keep the existing MIME size limits
   and add explicit HTML/CSS/node/depth/processing budgets for rendering. Preserve
   the original message separately. A failed or over-budget render offers escaped
   plain text and a clear explanation; never return raw HTML as a fallback.
2. **Normalize without a live browser document.** Use parse5's default tree adapter,
   without resource loaders or script execution, to inventory the bounded input.
   Remove active elements, foreign executable content, sender base/meta directives,
   preload links and form controls. Replace resource references with renderer-owned
   inert identifiers and a separate manifest. Never trust identifiers supplied by
   the sender as entries in that manifest.
3. **Apply the CSS and URL policies.** Parse stylesheets and inline declarations
   with CSS Tree, retain admitted presentation, and drop unsupported/raw/unparsed
   syntax. Validate every resource-bearing value and navigation target. Serialize
   CSS safely for an HTML style element, including raw-text closing-tag cases.
   Do not insert unprocessed CSS into a live stylesheet to inspect it.
4. **Run the final DOMPurify pass.** Sanitize the transformed HTML for its exact
   HTML sink using a dedicated instance with an explicit email allowlist. Keep
   CSS only after the CSS policy has processed it. No sender script, event,
   nested browsing context, form, custom-element behavior or unsafe scheme is
   admitted. Preserve needed class/ID relationships without clobbering the wrapper.
5. **Build the isolated document.** Insert only that output into a trusted wrapper
   with a fixed security policy, readable canvas and the qualified sandbox mode.
   Do not hydrate sender HTML as React or append it to the AppShell DOM. Resolve
   allowed images through the resource manifest; never restore an original URL
   by interpolating unchecked attributes after sanitization.
6. **Own interaction and lifecycle.** Handle safe external links and mailto through
   the reader contract, lazy CID images, dimensions and overflow. Cancel and revoke
   message resources on replacement, scope changes and unmount. Reject stale sizing,
   image or link messages from the previous render generation.
7. **Rebuild when policy changes.** Loading remote images creates a new rendering
   generation from the original body and manifest under the explicit new policy.
   It does not turn arbitrary sender attributes or scripts back on. Cache identity
   includes scope, message revision, policy version and renderer versions.

The preprocessing step addresses a privacy trap: a separate DOMParser document
is script-inert, but can still download image/iframe resources. Calling a parse
"inert" does not prove that no requests occurred before sanitization. The proof
must observe the entire parse-to-display sequence, not only the finished frame.
[MDN DOMParser behavior](https://developer.mozilla.org/en-US/docs/Web/API/DOMParser/parseFromString#description).

Preprocessing is defense in depth, not a substitute for the browser sanitizer:
HTML repair and serialization can change the meaning of malformed input. Use
malformed/namespace/raw-text regression cases against the final displayed result.

## CSS Resources and Fidelity

Keep useful table attributes, cell spacing, widths, inline typography, borders,
background colors, lists, quotes, language and writing direction. Preserve safe
style rules and width-based responsive media queries rather than flattening every
email into plain paragraphs. Restrict height-dependent rules, fixed/sticky overlays
and viewport-sized content where they undermine bounded sizing. Drop CSS imports,
remote fonts, animations, executable/unknown syntax and unapproved resource loads.
The allowlist must cover values/functions and at-rules, not just property names;
CSS Tree's `Raw` recovery nodes must never pass through unchecked.

Default network policy blocks remote images and every other passive request,
including CSS backgrounds, image-set variants, srcset, legacy background attributes,
font loads, preload/prefetch and link pings. Unknown URL surfaces fail closed.
Local fragment links stay within the message. Relative paths must not become
authenticated application requests. Do not add broad `https:` or `'self'` image
permission merely to make a single inline image work.

Resolve `cid:` against the current message's MIME parts, with bounded decoding,
approved raster types and collision/missing-part handling. Sender-provided data
or blob URLs are not automatically trusted renderer assets. Active HTML/SVG files
remain downloads or separately qualified previews. Object URLs are temporary and
scoped; an opaque frame's ability to load them must be tested, not assumed.

Remote-image opt-in is per message and explicitly warns that loading can disclose
an open and network information. Loading remote images is not permission for
external CSS or fonts. A future image proxy is a separate capability requiring
SSRF/redirect/DNS/content/size protections; this plan does not require one for v1.

The browser remains the rendering engine. Do not promise pixel-identical Gmail,
Outlook or Word-engine emulation. Test newsletters, invoices and transactional
mail for useful fidelity, including fallbacks for Outlook-specific markup. Keep
the sender's colors on a readable message canvas by default; provide an optional
reader preference rather than unconditional dark-mode color inversion.

## Isolation Sizing and Scrolling Proof

Prefer an opaque-origin frame for separation. If automatic sizing/link handling
requires code inside it, admit only a small fixed trusted bridge under a narrowly
scoped script CSP; sender scripts remain forbidden. Do not grant same-origin
access as well. Authenticate bridge traffic by exact source window or a privately
established MessagePort, render generation and message schema; a claimed message
ID or `Origin: null` is not authentication. Bound dimensions, rates and commands.

A scriptless frame with same-origin access for parent measurement is an alternative
to qualify, not an opaque frame. Never silently combine `allow-scripts` and
`allow-same-origin` on an app-origin document to bypass browser integration issues.
Keep top navigation, forms and automatic downloads disabled. CSP starts from
`default-src 'none'`, denies base/form/connect/object/frame/font capabilities, and
admits only the explicitly needed styles and renderer-owned image resources.
Set no-referrer behavior, keep policy before content, and test the parent CSP's
effect on srcdoc. Final permissions and transport are a browser-proof deliverable,
not copy-paste production configuration from this plan.
[Iframe sandbox rules](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe#sandbox),
[CSP](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy),
[cross-document messaging](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage#security_concerns).

Target one reader-owned vertical ScrollArea, with the email sized to its content
and a bounded horizontal overflow treatment for genuinely wide tables. Qualify
image-load/resizing updates, quote expansion, selection/copy, keyboard link access,
zoom, wheel/touch handoff and nested thread bodies. An opaque fixed-height iframe
with an unrelated native scrollbar is not completion of the Zero scrolling brief.
Do not use CSS height loops, synthetic wheel cancellation or a second always-on
scroller to hide an unresolved sizing problem.

SSR renders the authorized reader shell/fallback, not untrusted body markup.
Load the DOM-dependent security/rendering code only in the client entry. A server
HTML-processing capability, if later needed, has its own qualification: DOMPurify
requires a maintained DOM implementation there, and its maintainers warn against
substituting Happy DOM. Do not imply a successful browser render validates Bun
server sanitization or add a server DOM dependency just for this browser reader.
[DOMPurify server guidance](https://github.com/cure53/DOMPurify#running-dompurify-on-the-server).

## Qualification and Dependency Gates

Before implementing the inbox organism, approve a focused renderer proof that:

- Shows sanitized fixtures for newsletters, invoices, quoted conversations,
  legacy tables, missing images, width-based media queries, RTL, plain text and
  both application themes at desktop/mobile widths.
- Observes zero unapproved requests during preprocessing, sanitization, display
  and interaction; checks HTML/CSS resource variants, malformed markup, style
  breakouts, namespace confusion and relative authenticated endpoint requests.
- Verifies scripts/forms/top navigation stay denied; spoofed/stale bridge traffic
  cannot access the app, create resources, open links or cause unbounded resizing.
- Exercises authorized/missing/duplicate CID parts, MIME spoofing, revocation,
  scope replacement, attachment bounds and object-URL cleanup.
- Passes supported Chromium, Firefox and WebKit engines, including parent CSP
  and Trusted Types compatibility where supported, without weakening app policy.
- Measures parse/render work and bundle cost with explicit limits, lazy loading
  and cancellation; updates must not blank the surrounding list or reset scroll.

The package check on 2026-10-22 found DOMPurify 3.4.17, CSS Tree 3.2.1 and
parse5 8.0.1. Treat these as research baselines, not installed dependencies or
permanent security-approved pins. Recheck the actual release/advisories before
adoption, retain license notices and record reproducible browser evidence.
[DOMPurify release](https://github.com/cure53/DOMPurify/releases/tag/3.4.17),
[CSS Tree package](https://www.npmjs.com/package/css-tree),
[parse5 package](https://www.npmjs.com/package/parse5).

The reviewed DOMPurify package declares MPL-2.0 OR Apache-2.0; select and retain
the applicable notices during dependency review. CSS Tree and parse5 are MIT.
react-letter/lettersanitizer declare BSD-3-Clause-Clear. No third-party source
has been vendored by this plan.
[DOMPurify declaration](https://github.com/cure53/DOMPurify/blob/cde95990b2190338cfd7c00b768f3d81d3219d61/package.json),
[CSS Tree license](https://github.com/csstree/csstree/blob/f8980154f79110833bf56c391cd45fe5f9205752/LICENSE),
[parse5 license](https://github.com/inikulin/parse5/blob/b45055d18d58026a1de7016dfb7c6804a459668f/LICENSE),
[react-letter declaration](https://github.com/mat-sz/react-letter/blob/aaf99a34bea41b1268e6d453bbe0ee0a294489f0/package.json).

Keep the approved pipeline behind one Zero renderer contract so security patches
do not require every app to assemble or update its own sanitizer. The renderer
does not grant trust to email content for AI tools, authorization or server-side
HTML/PDF execution; those are distinct consumers with their own boundaries.
