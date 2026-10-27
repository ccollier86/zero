---
id: zero.frontend.components.blog.roadmap
type: roadmap
audience: [developer, agent, maintainer]
owner: frontend-components
status: draft
visibility: internal
maturity: planned
---

# Blog Publishing And Editor Roadmap

[Blog UI index](./index.md) · [Documentation index](../../../../index.md)

The UI migration and native publishing delivery are implemented. The
[author foundation](../../../../backend/blog/index.md) now implements enrollment,
draft/public profiles, explicit public photos, Guardian and audit integration.
The [native workspace/reader](./publishing-workspace.md) and
[publishing API](../../../../backend/blog/publishing-api.md) are covered by the
[current release qualification](../../../../backend/blog/qualification.md).
The sections below retain design requirements and later extensions; old UI-only
or author-only archives do not acquire these features from their version label.

## User Backed Authors

The [current backend contract](../../../../backend/blog/authors.md) preserves
account identity and roles, adds explicit scoped author enrollment and publishes
only allowlisted public fields. Omitted expanded private profile options can be
enabled safely in existing projects; public author drafts remain separate from
private account data. Required names/photos gate byline publication, not login.
The working native workspace now composes author management/profile editing and
the separate post permissions. It does not insert arbitrary protected app routes.

## Block Editing

The working block editor produces the versioned validated document and reuses
the presentation parts. Draft/publication separation, conditional saves,
uncertain-outcome retry, media selection and Save/Discard/Stay guards are part of
the new source. BlockRenderer remains presentation-only, and neither renderer nor
editor promises Gutenberg interchange or WordPress plugin compatibility.

## Automatic SEO Integration

The implemented working-source behavior is automatic integration in managed blog
pages, not an extra SEO plugin or repeated per-post head wiring.
Use the existing [SEO facade](../../../../backend/configuration/seo.md) for
rendering and app-local sitemap contributions. Site indexing controls and
explicit opt-outs still win. Standalone display components still change neither
head metadata nor sitemaps; the managed page controller owns that integration.

One admitted public revision must supply both the visible article and its SEO
projection. Do not separately read a newer draft for metadata or derive public
discovery from an editor's privileged query. The intended default projection is:

| Public content | Automatic SEO behavior to implement |
| --- | --- |
| Article | Title/description fallback, trusted canonical URL, Open Graph/Twitter card, author byline, actual published/modified dates and BlogPosting JSON-LD. |
| Magazine and paginated archive | Correct list/page title and canonical, deliberate query/pagination policy, optional collection/breadcrumb structured data and admitted public discovery. |
| Author/category/tag pages | Metadata only for enabled, intentionally public routes; no empty or private user-profile discovery. |
| Images and media | Public Storage/asset URLs, real alt text and supplied dimensions; configured site fallback card when available. No invented image or dimensions. |
| Localized content | Actual available translations, language alternates and trusted locale-specific URLs, without claiming translations that do not exist. |

Keep simple editorial overrides possible: SEO title/description, canonical,
share image and index policy. Derive ordinary defaults from published content
and the site configuration; an author should not need to understand head markup.
An override must not bypass publication, tenant, preview or site-wide noindex
policy. Plan the editor controls alongside the document schema instead of
adding an unrelated metadata store.

### Publication And Discovery Lifecycle

Publish, edit, schedule, unpublish and delete must update rendering and discovery
from the accepted state. Scheduled posts remain undiscoverable until the
publication boundary is reached. Slug changes need deliberate redirects and a
new canonical; withdrawn pages must not linger in a cached sitemap. Failed
publication must not advertise an article that cannot be served.

Register an app-local sitemap provider using the existing SEO extension point,
with bounded paging/limits and current published entries only. Reuse its trusted
site URL and same-origin admission. Multi-tenant/custom-domain deployments need
an explicit site binding; never choose a canonical host from an untrusted Host
header or leak another tenant's entries. Stop/unmount must unregister the
contribution. Failure follows the SEO service's safe discovery error contract,
not partial publication or stale private entries.

The future server routes must render metadata and readable article content on
direct requests without JavaScript. Any client-navigation integration must use
the router's supported metadata mechanism; a client-only effect is not the
server SEO implementation. Cache keys and invalidation must include the site,
locale and public revision so drafts or earlier publication states cannot leak.

### Privacy And Verification Gates

Drafts, previews, private and future posts never enter public sitemaps, search
results or automatic author pages. Preview URLs retain access control and
noindex; robots directives are not a substitute for authorization. User-backed
authors expose only their allowlisted public byline, not account emails, roles
or other private profile fields. Structured data must describe what the visitor
can actually read, not privileged/editor-only content.

Before enabling this integration, test direct server HTML and client navigation,
HTML/JSON-LD escaping, site/locale isolation, public Storage assets, pagination,
publish/edit/withdraw/slug changes, scheduled publication, failed writes and
preview/private exclusions. Qualification must use the public package and real
SEO/rendering contracts, not a second test-only head serializer. Automatic
metadata is not a promise of indexing, rich-result eligibility or ranking.

## Backend Composition

Use Zero's reactive database, supported resources/functions, Guardian and Storage
where appropriate. The current prop/callback interface must remain useful for
other approved content sources too. No database versus Markdown decision is
implied by importing the UI. Future activity/engagement tracking must be explicit,
not a revived archived fingerprinting or screenshot subsystem.

## Related Guides And Next Steps

- [SEO](../../../../backend/configuration/seo.md) is the current metadata/discovery foundation.
- [Identity](../../../../backend/guardian/index.md) owns existing account and permission semantics.
