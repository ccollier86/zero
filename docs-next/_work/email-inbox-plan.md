---
id: zero.email.inbox-plan
type: roadmap
audience: [developer, agent, maintainer]
owner: email
status: draft
visibility: internal
system: email
feature: email-inbox-workspace
maturity: planned
applies_to: ["2.6.0 working source; proposed email UI and authorized inbox service"]
modes: [browser, SSR, managed-server, Guardian single, Guardian multi, Fabric]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "7aa638f3d1ad7a66f1856ab0ae2b666b8c45f080"
  snapshot: dirty
  date: "2026-10-22"
  evidence_level: source-observed
---

# Zero Email Inbox Plan

[Working evidence](./index.md) · [Email subsystem](../backend/email/index.md) · [Frontend index](../frontend/index.md)

Plan an optional, complete email workspace using Zero's tokens, components,
authorized services and realtime data. The user's screenshot establishes the
double-sidebar arrangement, not a chat product: the result needs actual folders,
email headers and HTML bodies, attachments, drafts and email composition.
The user subsequently approved implementation. The additive baseline now has
[frontend manuals](../frontend/email/index.md) and a
[managed backend contract](../backend/email/inbox.md). The plan below retains
the broader requirements; it is not a claim that every future capability or
release qualification is complete.

## Implementation Baseline

The feature branch implements folders/list/reader/composer, private revisioned
drafts, persisted send intent/receipts, authorized attachments, optional account
switching and shared IDLE-to-SSE metadata. It reuses Zero controls, magnetic
folder paint, shared scroll treatment, AppShell layout and managed confirmations.
Focused Chromium and managed Guardian/SMTP/IMAP tests exercise the real paths.
Original components and theme files remain intact.

Received HTML uses the scriptless same-origin iframe alternative after
network-free parse5 preprocessing, CSS Tree filtering and DOMPurify. It does
not enable sender scripts or an opaque-frame message bridge. The
[HTML manual](../frontend/email/html-reader.md) records its exact policy and limits.

Conversation grouping, account provisioning, provider Drafts synchronization,
distributed/Fabric state, body previews beyond provider metadata and further
browser engines remain on the [explicit roadmap](../frontend/email/roadmap.md).
The current private state file and app-local event fanout must not be described
as cross-replica transactional mail or automatic ReactiveDB ingestion.

## Initial Qualification on 2026-10-23

Working-tree implementation checks passed: 82 focused tests across 16 files,
plus the separate installed-archive consumer test (83 total, zero failures).
The five browser cases run in Chromium and cover desktop/light/dark and phone
flows, hostile/wide HTML, no passive resource requests, consent referrer
behavior, retained live rows, send flow and unfinished-recipient draft recovery.
The mail tests use loopback SMTP/IMAP and synthetic identities only.

Reproduce the installed-consumer gate with
`bun --no-env-file test src/email/mail.package.test.ts`. It packs the current
source, installs it in a disposable external scratch consumer, typechecks the
public server/inbox imports, exercises SMTP/IMAP, renders SSR and builds a browser
entry. The component suite is
`bun --no-env-file test src/components/email-inbox/email-inbox.browser.test.ts`.
Use the external project scratch root through TMPDIR for these tests.

Targeted strict TypeScript checks and `git diff --check` pass. The documentation
graph contains 798 reachable pages with unique IDs and no reported problems.
Fresh-consumer checking also corrected one pre-existing declaration:
registered read-query `values()` can return SQL NULL. That correction changes
the TypeScript result union only, not SQL execution, auth or database schemas.

This is local feature-branch evidence, not a merged release, real-account pilot,
cross-replica qualification or Firefox/WebKit certification. No existing
application/Guardian database or external mail account was changed. Keep the
feature opt-in and complete the deployment-specific account/browser checks
before a production rollout.

## Follow Up Review

The production-quality review adds pull-based SSE keepalives, immediate IDLE
release for paused consumers, managed shutdown draining, immutable inputs and
accepted-receipt protection. Post-acceptance authorization changes and generic
send failures retain the same operation ID instead of enabling an accidental
duplicate send. Provider keys hash the owner/account boundary. Resend now maps
documented attachment MIME types and inline content IDs and requires a valid
acceptance receipt.

UI polish reserves row space for attachment/star controls and respects
receive-only capabilities for selection and bulk actions. Compose remains
visible but disabled where sending is unavailable. The browser fixture now uses
the actual AppShell `subtitle` property, and the root TypeScript check covers
the complete implementation rather than only selected entries.

Review evidence is under
`/Volumes/code-bank/artifacts/zero-platform/diagnostics/email-inbox-review/`.
The focused mail/server/controller/HTML run passes 74 tests, and all six Chromium
workspace cases pass. A separate 43-test core SDK/request/query regression run
also passes. No real mailbox, customer email, credential or existing app
database is used. The separate fresh installed-archive gate also passes,
including source parity for the reviewed service, stream, receipt store,
Resend adapter and authenticated browser source, public API typechecking,
loopback SMTP/IMAP, SSR and browser compilation. The review checks total
81 mail/workspace/package tests plus the 43 core regressions. The documentation
graph remains 798 reachable pages with no reported problems.

## Product and Layout Decisions

Keep the existing AppShell sidebar and its polished interactions unchanged.
The email organism occupies its content region with a message sidebar and
reading/composing area: three columns total on a wide screen.

```text
Existing app sidebar | Email sidebar             | Main area
                    | Optional mailbox switcher | Message actions and subject
App navigation      | Compose                   | Sender and recipient details
                    | Visible folder navigation | HTML or plain-text email
                    | Search and filters        | Attachments and thread items
                    | Message list              | Inline reply or composition
```

Folder navigation is visible by default, in a compact, collapsible section of
the email sidebar. A host can instead place the same folder component in a
contextual AppShell navigation slot. Do not require a fourth persistent rail or
make a folder dropdown the only desktop navigation. Keep folder navigation and
the message list independently usable when either becomes long.

Use the screenshot's clear pane divisions, quiet surfaces, selected-row treatment
and anchored controls. Replace chat handles, bubbles, online status, typing,
reactions and Call/View profile actions with email information and commands.
External senders do not acquire Guardian identities or presence badges merely
because their addresses match a displayed name. Do not reuse the reference's
photos, branding or other assets.

The sidebar should resize through the existing panel primitives, with proposed
starting width around 320px and bounded minimum/maximum sizes to qualify against
the actual AppShell. Preserve its scroll position and selected message during
resizing. On narrow screens show folders/list and the reader as navigable views,
with explicit Back behavior and retained state; do not squeeze three columns
into a phone. Avoid a dependency on the separately planned drawer manager.

## Email Workflows

Default folder choices are Inbox, Drafts, Sent, Archive, Junk/Spam and Trash
when supported/mapped for the selected account. Starred and Unread are explicit
filtered views, not invented provider folders. Show custom folders and nested
paths. Resolve special-use folders from server metadata plus trusted overrides;
do not assume English paths or equate a provider's All Mail with Archive.
Missing capabilities get a deliberate unavailable/setup state, not a pretend
successful action or silent folder creation.

The message list shows sender, subject, bounded text preview, timestamp, unread
state, flag/star and attachment/draft indicators. Distinguish hovered, selected,
checked and unread rows without depending on color alone. Page-local bulk
selection is the baseline; selecting every search result needs a separate
server contract. Search covers sender, recipient, subject and content, with
Unread/Starred/Attachments filters admitted only when the backend supports them.

The reader includes subject, From, To/Cc, Reply-To, precise date/time and an
expandable header view. Preserve Bcc only where actually present and authorized,
such as an owned draft or sent copy. Plain text and rich HTML both have supported
views. Provide Reply, Reply all, Forward, mark unread/read, star, move, archive,
junk and trash according to capabilities. Downloads and attachment previews use
separate authorized actions, not inline JSON blobs or arbitrary URLs.

Email conversation view is a capability, not subject-string grouping. Build
threads from normalized Message-ID, In-Reply-To and References, accounting for
missing/duplicate IDs and copies across folders. Keep message view available
when relationships are incomplete. Read/unread belongs to individual messages;
thread summaries must say what their count represents. Prefetch and list reads
never mark mail seen. Default mark-on-open requires a genuinely active reader
and an explicit accepted flag update; manual-only is a supported policy.

The composer covers New, Reply, Reply all and Forward, To/Cc/Bcc, subject,
authorized From identities, HTML/plain text, attachments, quoted content and a
clear send action. Resolve Reply-To and exclude the user's own addresses from
Reply all correctly. Supply a compact formatting toolbar rather than exposing
raw HTML as the normal editor. A dedicated rich-text mail editor is still a
dependency decision; the JSON/document editor is not that component.

Draft autosave reports saving/saved/failed/conflicted truthfully. Reopening or
editing a draft must not append an endless sequence of unrelated draft copies.
Changing folder, account or route preserves an owned draft or invokes the shared
unsaved-change decision. Scope revocation retires its UI and listeners without
exposing it to the new account. Recovery after reauthentication stays subject
to the original owner's authorization and storage/retention policy.

Sending distinguishes queued, submitting, SMTP-accepted, partially rejected,
failed and uncertain outcomes. A Sent-copy failure is separate from sending.
Neither an animation nor provider acceptance proves recipient delivery or read.
Do not offer a naive retry that can send a duplicate after a lost acknowledgment.
Scheduled sending, AI drafting, signatures, rules/Sieve and contact-directory
integration can follow later; none is required to start this email workspace.

## Optional Mailbox Switching

The switcher is optional and hidden for the ordinary single-mailbox case.
When enabled it lists only inboxes admitted by the server for the current
Guardian scope. Entries may represent a shared app inbox, an organization inbox
or a personal inbox once its account-management contract exists. It is distinct
from AppShell's organization/workspace switcher; it never silently changes the
active tenant.

Switching cancels old requests/subscriptions, fences late results, retires old
menus/previews/composers and clears private data before showing the new scope.
Keep per-mailbox folder/selection preferences only under their owner's scoped
key. A browser supplies a stable mailbox ID, never credentials, hostnames or a
free-form tenant/account selector. Multiple IMAP accounts and a provisioning
screen are not already provided by the current single-mailbox runtime.

## Composition and Proposed Public API

Use the explicit name **EmailInbox** to avoid confusing this feature with the
existing notification inbox or a future chat system. The following are proposed
names/responsibilities, not current exports, configuration keys or runnable APIs.

| Layer | Proposed responsibility |
| --- | --- |
| EmailInbox | Ready-to-use organism; normal managed composition plus an explicit controller adapter for embedding/testing. |
| EmailInboxController and useEmailInbox | One owner for readiness, source membership, folder/account/selection, pending actions, capabilities and live updates. Reuses the integrated client/auth transport. |
| EmailMailboxSwitcher and EmailFolderNav | Reusable navigation parts, with optional host placement. |
| EmailMessageList and EmailMessageRow | Bounded/virtualized list, selection and truthful preview/count states. |
| EmailReader, EmailHeaders and EmailThread | Detail layout and conversation composition; no new transport per child. |
| EmailHtmlBody and EmailPlainTextBody | Reusable body renderers with one explicit email-content safety contract. |
| EmailComposer, EmailRecipientField and EmailAttachments | Shared composition state with reusable recipient, body and file parts. |
| Scoped server inbox service and typed client facade | Browser-safe DTOs, Guardian policy, account selection, provider capabilities and acknowledged commands over the existing mail engines. |

Parts should accept the same controller/context or explicit presentation inputs;
embedding a reader must not open a second IMAP listener. Offer slots for row
metadata, toolbar actions, empty states and attachment presentation without
forking the default component. Keep genuinely private helpers with their parent
family. Package paths and any `email.inbox` enablement shape must be frozen and
documented before coding, not guessed by an agent from this proposal.

Proposed source ownership is `src/email/inbox/` for the domain service and pure
models, existing server/client integration locations for authenticated adapters,
and `src/components/email-inbox/` for UI. Use existing module conventions and
public export patterns; do not restart the paused broad component reorganization.

## Reuse Zero Presentation and Motion

Use [AppShell](../frontend/app-shell/index.md),
[Resizable/ListDetail composition](../frontend/components/primitives/resizable.md),
[the UI reference](../frontend/ui-reference.md), and
[application UI development](../guides/application-ui-development.md) as owners
of layout, density, typography and motion. Reuse Buttons, Inputs, Search,
Checkbox, Badge, Avatar, file presentation, recipient/tag validation,
Select/Combobox, DropdownMenu, Popover, Tooltip and managed modals where their
actual contracts fit. Do not assume every planned input enhancement is shipped.

Apply semantic next-theme roles to chrome rather than cloning the screenshot's
palette. Proposed email-specific tuning roles cover pane width, row density,
unread/selected material, header/body spacing, attachment geometry and the email
reading canvas; reconcile each against existing tokens before adding one.
The app's dark theme must not blindly invert a sender's branded HTML. Keep
authored email presentation inside its boundary, with a deliberate readable
canvas and optional reader preference.

Keep magnetic highlights beneath stationary folder/menu labels. Use Select's
approved morph for the optional account selector, current anchored motion for
small menus, Grow tooltips, and the modal manager's origin/Rise defaults for
actual dialogs. An inline reply is not a modal. Do not build new overlay owners
or retune the preserved primary sidebar. Reduced motion removes decorative
travel without changing request, read or autosave timing.

Use [ScrollArea](../frontend/components/primitives/scroll-area.md) treatment on
the actual bounded folder, list, reader and composer viewports: subtle overflow
fades, overlay rails and proper wheel/touch handoff at edges. Avoid nested
redundant scrollers and page-wide horizontal overflow. Live insertion animates
only the new/reordered row; it must never blank the entire list, replay first
load, reset selection or overwrite a reply draft. If the user is reading older
mail, retain position and offer a truthful new-mail indicator instead of forcing
them to the top. Do not infer an exact arrival count from a changing total alone.

## Safe HTML and Attachments

HTML rendering is a first-class reusable component with an explicit threat
model, not direct injection of arbitrary mail into the application DOM.
Preserve useful table layouts, basic typography, lists, quotes and inline images
where admitted; provide plain-text fallback when safe rendering fails.

The [HTML email rendering plan](./email-html-rendering-plan.md) recommends native
browser layout inside an isolated document, DOMPurify as the HTML security core,
CSS Tree for a structured CSS policy and parse5 for non-fetching preprocessing.
It compares email-specific viewer libraries and mature webmail source, records
license/version baselines, and defines the required browser proof. These are
proposed dependencies, not packages already integrated into the mailbox API.

The proposed defense is reviewed HTML/CSS/URL sanitization plus an isolated
message document with restrictive CSP and sandbox permissions. Block sender
scripts, event handlers, forms, embedded documents/plugins, base/meta redirects,
top-level navigation and executable URL schemes. Strip or rewrite relative
resources so they cannot resolve against authenticated app paths. Do not copy
app secrets, session credentials or global styles into that document. Isolation
permissions require a dedicated browser proof: combining scripts and same-origin
access on an app-origin frame can undermine its sandbox.
[MDN iframe sandbox reference](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe#sandbox)

Block remote images, CSS imports, font URLs, CSS resource loads and tracking
pixels by default. A visible Load remote content action is a scoped opt-in and
must not silently enable external resources in every message. Any future server
proxy needs its own SSRF, redirects, DNS/IP, size, timeout and content checks;
being a proxy does not automatically make remote content private or safe.
CSP complements sanitization; it is not a replacement for it.
[MDN Content Security Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy)

Use DOMPurify after the dependency/security review, not a handwritten regex
sanitizer. Evaluate HTML, CSS and URL policy separately: a library allowing CSS
by default does not establish an email-safe network policy. Resource/CID rewrites
must be part of the reviewed sanitization pipeline; later markup mutation must
not reintroduce unsafe input. Observe network activity during parsing as well
as after display; a script-inert DOM parse is not inherently non-fetching.
[DOMPurify safety and configuration guidance](https://github.com/cure53/DOMPurify#is-there-any-foot-gun-potential)

CID images resolve only to attachments belonging to the authorized message.
Use bounded, approved MIME types and revoke temporary object URLs on replacement
or unmount. HTML/SVG and other active attachments do not render directly in the
app origin. Download filenames, MIME labels and links remain untrusted input;
attachment downloads require fresh access checks and safe response headers.
Never include full attachment byte arrays in list/detail JSON by default.

The renderer proof must resolve sizing, link handling and ScrollArea ownership.
An opaque sandbox cannot simply be measured through the parent DOM. If a small
trusted sizing/link bridge is needed, admit only that code and validate frame
identity, render generation, message schema and bounded dimensions; never trust
an arbitrary `postMessage` because it claims the right message ID. No sender
script permissions or global CSP weakening may be added to make sizing work.
[MDN cross-document messaging](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage)

## Existing Foundation and Backend Gaps

The current [SMTP](../backend/email/smtp.md) and
[IMAP](../backend/email/mailbox.md) modules are the transport foundation. Their
server APIs are not an authorized browser inbox service or complete mail product.

| Area | Present at the reviewed source | Work the inbox implementation must cover |
| --- | --- | --- |
| Sending | EmailService, SMTP/Resend, MIME/attachments, reply threading, safe outcomes, optional Sent copy; Guardian's account-action outbox. | Authorized inbox send commands, allowed From identities, per-recipient results and durable user-send recovery if queued sending is offered. Do not reuse Guardian's secret-bearing outbox as a generic mail queue. |
| Accounts and access | One optional app-local IMAP mailbox, runtime cleanup and guards on raw multi-tenant/workflow access. | Inbox registry/permission binding, capability snapshots, scoped HTTP/client/hooks and optional multiple-account lifecycle. UI hiding never grants access. |
| Folders and list | Folder paths/special-use hints, UID-window envelope pages and basic windowed query filters. | Accurate per-folder unread/count status, preview/attachment metadata, user-facing search across its declared scope, accessible paging and supported folder management. UID-window filtering is not complete mailbox search. |
| Reading and threading | Parsed HTML/text, addresses, reply headers and in-memory MIME attachments with size limits. | Safe HTML renderer, normalized browser DTOs, authorized attachment streaming, lazy body loading and reliable thread relationships. |
| Mutations | Seen/flagged/answered updates, safe server MOVE, append of a draft or sent copy. | Revision-aware draft replacement/removal, mapped archive/junk/trash actions, capability-qualified folder changes and precise permanent deletion. APPEND alone is not autosave. |
| Real time | IDLE events, stable UIDVALIDITY references, reconnect, bounded queue and resync signals. | Shared subscription ownership, persistent metadata/cursor reconciliation where enabled, authorized fanout and stable browser source membership. |

Permanent deletion must be limited to exact selected messages with the server's
safe UID-specific capability; never use a blanket EXPUNGE fallback that removes
someone else's deleted mail. Folder deletion has separate destructive admission.
Bulk commands report per-item results instead of pretending multiple IMAP actions
are one atomic database transaction. Unsupported actions stay unavailable.
[IMAP message identity and deletion semantics](https://www.rfc-editor.org/rfc/rfc9051.html)

## Realtime Data and Authorization

Use one scoped server service and controller, following the existing
[reactive control-plane contract](../guides/reactive-control-plane.md) and
[scoped client patterns](../frontend/sdk/scoped-control-planes.md). Resolve
inbox ownership and authorization on the server for every list, read, download
and mutation, including after awaits and for long-lived subscriptions. Permission
revocation retires active delivery and cached private content, not just buttons.

If the feature stores folder/message/thread metadata, put that private domain
projection on the appropriate application/Fabric data plane with explicit
exposure and policy, not in a globally readable Guardian table. Keep provider
credentials server-side, using existing secret facilities if persistence is
enabled. Do not introduce an automatic BYOK vault or mailbox-provisioning product
in this first slice. Bodies and attachments load on demand with bounded private
caches; persistent full-body retention is a separate app setting/policy.

Key synchronization by inbox/account, folder, UIDVALIDITY and UID, not sequence
number or subject. Advance a saved cursor only with its accepted metadata commit.
On reconnect, overflow, unidentified flags or sequence expunge, reconcile
membership/flags and reset an old epoch instead of fabricating missing deltas.
Fan out one admitted server watcher per needed account/folder, not one IMAP socket
per React component or browser. Distributed background sync needs an explicit
owner/lease and recovery contract before enabling it across workers.

Scope caches and pending work by Guardian identity/authority, inbox, folder,
query and relevant revisions. Maintain useful current-scope rows during refresh;
clear old-identity data immediately on transition. Do not hydrate mail from a
public/shared SSR cache or persist private drafts in an unscoped browser key.
Mail views must be deep-linkable through the supported router with opaque IDs
and access checks, without placing addresses, subjects or secrets in URLs.
This does not authorize the separately planned routing-engine migration.

## Implementation Order After Approval

1. Freeze default layout and folder placement, supported workflows, capability
   vocabulary, controller/public naming and the scoped service contract. Review
   the screenshot against a small email-specific wireframe before styling.
2. Prove safe HTML rendering with hostile MIME/HTML/CSS fixtures, CID resources,
   dark/light content and real browser isolation/sizing/scroll tests. Qualify the
   recommended rendering stack and decide the separate editor dependency; do not
   start with an unsafe temporary renderer.
3. Add the minimal server/browser bridge and real folder/list/read/download
   capabilities, followed by IDLE-to-scoped-data reconciliation. An explicit
   read-only mode is valid while write capabilities are not yet admitted.
4. Implement composer, drafts, reply/forward, attachments, accepted send outcomes
   and mapped folder/flag operations, with revision/conflict and uncertain-send
   recovery. Finish required backend gaps before advertising each UI action.
5. Assemble the default EmailInbox from reusable parts, add optional switching
   for authorized multi-account configurations, and qualify compact/responsive
   interactions without changing the main sidebar.
6. Qualify package exports, SSR, real-time privacy, lifecycle, visual/accessibility
   behavior and a disposable Purelymail/test-provider environment. Add first-class
   component/API docs and explicit upgrade notes. Merge/release only after approval.

The full target includes both reading and composing; a visual shell or read-only
prototype is not completion. Multi-user mail provisioning, AI/routing automation,
scheduled sending, full offline mail, external address books and a chat product
remain follow-on scope unless separately requested.

## Acceptance and Documentation Gates

- Visual: preserve the existing AppShell, visible folders, compact rows and
  meaningful empty/no-selection/search-empty/loading/denied/offline/error states.
  Check long addresses/subjects, unknown totals, large folders and both themes.
- Interaction: keyboard list/menu/separator access, focus return, bulk selection,
  mobile Back, zoom/RTL, native scrolling, overflow fades and reduced motion.
- Content safety: scripts/events, malformed markup, CSS URLs/imports, relative
  URLs, redirects, frames/forms, hostile links/attachments, CID collisions,
  oversized bodies and SSR/renderer policy parity. Assert blocked content makes
  no unexpected network requests and cannot reach parent/session state.
- Data: real arrivals/flag changes/moves/deletes, missed events/UID reset,
  sparse pages and search completeness. Existing rows, selection and composer
  must stay intact during current-scope updates.
- Authority: denied cross-mailbox reads/writes/downloads, stale search/body
  results, scope replacement and revocation while reading, streaming or composing.
- Delivery: draft conflicts, double-click send, partial rejection, disconnect
  before/after acceptance, Sent-copy failure and restart recovery; no automatic
  duplicate mail. Confirm every real recipient used for integration testing.
- Distribution: a fresh installed consumer can enable the optional service and
  render the organism/individual public parts without importing server secrets
  into the browser. Disabled mode starts no inbox subscriptions or private routes.

Publish a frontend Email Inbox index, full organism/controller/part manuals,
HTML safety and composer contracts, backend inbox service/capabilities/config,
Guardian permission examples, realtime/retention and operational recovery guides.
Link them from the UI reference, backend Email index, application-development
guide and agent entrypoints. Doctor should diagnose enabled-but-unconfigured
inboxes, unsafe policy/config combinations and unsupported action declarations.
Exact names, schema/migration requirements and release evidence belong in those
implemented guides; this plan must not become a substitute for them.

## Planning Result

The agreed direction is an optional email client with folders, Zero-native
composition and safe HTML, using the current SMTP/IMAP foundation. The public
API, renderer sandbox/bridge details, editor choice and account-management
schema remain explicit implementation decisions. The linked rendering plan
provides a researched library recommendation and qualification gates. Only
planning documentation and its links change during this task.
