---
id: zero.blog.publishing-plan
type: roadmap
audience: [developer, agent, maintainer]
owner: blog
status: draft
visibility: internal
system: blog
feature: publishing-foundation
maturity: planned
---

# Publishing Foundation: Next Implementation Boundary

[Blog index](./index.md) · [Current authors](./authors.md) · [Roadmap](./roadmap.md)

This is the complete delivery plan, not a claim that all CMS work is released.
The [publishing API](./publishing-api.md) describes the implemented backend,
native workspace and default public reader. The
[release qualification](./qualification.md) records the completed code-candidate
gates. This document retains the original delivery requirements and later CMS
ideas; it is not an alternate API or permission to build a second app-specific
backend around the owned framework contracts.

## Current Delivery Scope (2026-10-26)

The approved next work is backend-first. Finish the managed Fabric content
plane, application-wide ownership in both tenancy modes, author admission,
versioned drafts and published snapshots, taxonomy management, private media
admission/public references, indexed published-content search, optional bounded
metrics, the server/browser facades, and additive enable/disable/restart checks.
Retain explicit organization-scoped author compatibility; it is not the default
ownership model for an application's public blog. An organization administrator
must not inherit platform-blog management authority.

Keep SEO limited to useful defaults and ordinary overrides: title/description,
canonical/social data, image alternatives and discovery. Rank-Math-style scores,
keyword dashboards and an elaborate optimization product are out of scope.
The editor, floating selection-formatting toolbar and management UI follow
backend qualification. Paragraphs/headings are normal writing blocks; galleries,
audio, video and the migrated rich components must have a versioned document
contract and searchable text without accepting executable HTML.

Execution gates:

- [x] Merge the qualified main navigation/audit/avatar fixes into this branch.
- [x] Implement and focus-test one private Fabric content database and final-edge
  Guardian authority (including application-wide multi-tenant admission).
- [x] Validate rich documents, revisions, taxonomy and publication atomically.
- [x] Admit private Storage media and derive only published delivery references.
- [x] Implement indexed public/private search, metrics and accepted live changes.
- [x] Extend public request/browser facades and managed HTTP composition.
- [ ] Add focused and installed/bundled Linux regression evidence and update
  configuration/API/upgrade documentation before selecting any new archive.

## Preserve What Is Already Working

- Keep the tokenized Magazine list and sidebar-TOC article as the eventual
  no-configuration public defaults. Retain alternative layouts, optional social
  sections, the shared search palette, media parts and normal Zero motion.
- Keep the existing Guardian account and author assignment. Publishing must
  not replace an account role with an author role, create a duplicate identity,
  copy private profile fields into public output, or publish a private avatar.
- Keep current single/multi tenancy and simple/advanced authorization. Enabling
  blogging must not enable registration, change organization membership or
  widen the application's existing profile/privacy decisions.
- Keep the author/profile APIs and prop-driven presentation useful on their own.
  A headless application must not need an unused public route or block editor.
- Keep main's qualified logging, session recovery and source/bundle migration
  identity fixes. Blog qualification cannot substitute an old framework archive
  merely because it has the same `2.6.0` version string.

## Implement In Vertical Slices

| Slice | Deliverable | Acceptance boundary |
| --- | --- | --- |
| Content ownership and migrations | Managed Fabric content storage, versioned draft/public records, scoped admission and safe existing-project enablement. | New/existing isolated apps preserve users, app data, author records and prior ledgers. Feature-off mounts no public CMS surface. |
| Draft operations | Public Zero server/browser facade for bounded reads, create/edit, revisions and accepted conflict responses. | Two writers cannot silently overwrite each other; account/org transitions retire stale browser operations. |
| Publication | An explicit publish/withdraw transaction, accepted public revision and secret-free audit events. | No half-published content, draft metadata, private media or stale scheduled revision becomes public. |
| Author experience | Native author management and public-byline editing, integrated with the existing private profile/photo controls. | Explicit public-photo consent, readiness, conflicts and role-preserving enrollment work without custom app SQL. |
| Public assembly | Default Magazine/article routes and automatic SEO/search/discovery from the admitted public revision. | Direct server HTML is readable without JavaScript; withdrawal immediately removes access and discovery. |
| Block editor | A separately validated editor document/controller over the existing renderer/media primitives. | Autosave, dirty-navigation guards, accessibility, media admission and extension/version rules are qualified before activation. |

The first backend acceptance path is **existing enrolled user → create draft →
save with expected revision → explicitly publish → anonymous public read →
edit without changing public content → withdraw → public read unavailable**.
The block editor is not required to prove that path; a validated structured
document supplied through the facade is enough for the initial backend tests.

## Ownership And Storage

Retain identity-adjacent author/site metadata in SYSTEM. Put content and its
durable work in a managed private Fabric realm, using existing placement,
readiness, migration, admission and actor supervision contracts. The exact
realm declaration and supported topology must be qualified before documenting
a public configuration option; a second unmanaged SQLite file is not a Fabric
integration.

Every content operation resolves its site from current admitted application or
organization authority. Public delivery resolves an explicitly public site
binding, not a browser-selected tenant ID or the request's untrusted Host.
Single-tenant enablement stays single-tenant. Multi-tenant deployments must not
expose all organizations simply because the author service has opaque site slugs.

Use the existing scoped database/facade boundaries rather than making apps
maintain private table names, migration SQL or fabricated row-change events.
Authority and content may reside in different transaction domains: use Zero's
supported final commit admission, not an invented cross-file transaction or a
SYSTEM exclusive lease held across Storage, provider calls or network waits.

The content model needs explicit owners for:

- Stable post identity and site ownership, separate from its current URL.
- Versioned validated draft document, draft revision and optimistic CAS.
- An immutable accepted public snapshot and independent public revision.
- Publication/withdrawal state and actual accepted timestamps.
- Scoped slug reservation and admitted redirect history.
- Draft/public media references and optional editorial SEO overrides.
- Retained author attribution and a declared transfer/deletion policy.
- Durable scheduled commands and idempotency receipts when scheduling is added.

Those are requirements, not permission to add every possible blog feature in
one migration. Use append-only migrations after the released chain; never edit
old receipts or turn the earlier preview-ledger conflict into an automatic reset.

## Authorization And Author Lifecycle

Separate author enrollment management, draft editing, review and publication
permissions. Existing Guardian registries must explicitly own any new grants;
configuration must not silently assign a new privileged role to all authors.
Self-service author editing does not imply permission to publish someone else's
article or manage other accounts. Native session scopes remain a ceiling on
top of the same Guardian permissions, not a replacement for them.

Recheck user/session, membership, site policy and expected revisions at the
accepted mutation boundary. An authority failure must leave neither accepted
content nor a successful audit event. Directory administration must not grant
managers permission to publish another person's private account photo.

Define attribution before publishing posts. Current public author profiles are
withdrawable and disappear for ineligible accounts. An already published article
must not silently become authorless, expose a replacement private name, retain
an unauthorized old photo, or be deleted by a cosmetic profile edit. Choose and
document the explicit attribution/erasure and suspended-author policy before
the public-post contract is finalized; do not infer it from the nullable user FK.

## Documents, Media And Editing

Validate a versioned, bounded, serializable document on the server. Use the
existing block renderer as a presentation contract, not as proof that arbitrary
editor JSON, raw HTML or Gutenberg wire formats are accepted. Unsupported
versions/types must be rejected explicitly, with extension ownership defined.
Heading identities must keep the default TOC and deep links stable across edits.

Draft uploads stay private. Publishing must verify actual admitted Storage
assets, supplied alt text/dimensions and allowed embed origins. A file ID or
client-provided URL is not evidence of media ownership or public consent.
Removal/withdrawal must account for references and in-flight delivery without
deleting assets shared by other retained revisions.

Build editing from existing Zero form, revision, save, modal/drawer, upload,
popover and ScrollArea components. Preserve draft state on retryable failures;
make accepted save/publish status distinguishable from optimistic animation.
Do not add a second uncontrolled save bar or an app-specific author identity
store just to demonstrate the UI.

## Rendering, SEO And Realtime

Use one admitted public snapshot for visible article content, byline, canonical,
social cards, BlogPosting structured data, public search and sitemap entries.
Private draft edits cannot change any of these until publication is accepted.
Honor site-wide noindex, public URL bindings, disabled route families and
editorial overrides without letting them bypass publication or authorization.

Default route installation needs collision detection and explicit headless/path
overrides. An existing project's `/blog` route or public theme must not be
overwritten. Document the eventual change from author-only preview enablement
to full CMS enablement rather than silently adding public routes on upgrade.

Internal editors/list views use scoped reactive snapshots and normal native
DataTable behavior. Accepted changes update rows without remounts, invented
events or repeating the initial table animation. Anonymous live consumers, if
supported, receive a public-only projection; never expose the private draft
table to Sync and rely on the UI to hide fields. Cache/invalidation keys include
site, locale and public revision, and withdrawal must also retire stale
discovery/redirect output.

## Durable Work And Logging

Do not schedule publication with a process-local timer. Later scheduling uses
supported durable workflows and a pinned expected draft/policy revision.
Duplicate callbacks, rescheduling, cancellation and restart must not publish a
different newer draft or repeat external notifications. Short automation starts
must not hold a database queue or authority lease through slow work.

Reuse the configured core logging source bridge and its separate private Fabric
storage/workers. Record stage-appropriate actor/scope/target/revision metadata,
not article bodies, private biographies, credentials or upload capabilities.
An HTTP response is not evidence of human attention. Optional analytics, AI
writing, notifications and subscriber management are separate future features;
none is implicitly enabled by this foundation.

## Qualification Gates

Before a CMS archive is selected, test the actual managed app and public package:

1. Fresh and existing-app enable/disable; migrate:false, schema/route collisions,
   prior ledger preservation and the explicitly unsupported old preview ledger.
2. Single/multi simple/advanced permissions; read-only native scopes, API keys,
   membership loss, revocation, policy replacement and stale browser results.
3. Concurrent draft edits, stale publication, accepted/failed audit capture,
   provider-independent rollback and public/draft isolation.
4. Actual Storage upload/media ownership, explicit publication, replacement and
   removal, including denial during in-flight delivery.
5. Direct SSR, default layouts/TOC/search, canonical/structured-data escaping,
   preview noindex, publish/edit/withdraw/rename and sitemap invalidation.
6. Source-prepared → official bundle startup/restart with matching migration
   identity, supervised workers and no implicit provider-secret inheritance.
7. Reactive row retention and keyboard/mobile/reduced-motion behavior through
   the native components, not a parallel test-only UI implementation.

Each implementation slice updates its own configuration/API/upgrade guides and
the qualification record. Only select an exact qualified committed-main archive;
application acceptance and deployment still belong to the application owner.
