---
id: zero.blog.roadmap
type: roadmap
audience: [developer, agent, maintainer]
owner: blog
status: draft
visibility: internal
system: blog
feature: publishing-roadmap
maturity: planned
---

# Blog Backend Roadmap

[Blog index](./index.md) · [Presentation and editor roadmap](../../frontend/components/public-pages/blog/roadmap.md)

The current preview implements user-backed author enrollment, draft/public
profiles, optional explicitly public avatars, Guardian admission, audit capture
and scoped reactive projections. It deliberately stops before post publishing.

## Next Backend Slices

1. Decide site/content ownership and post storage with supported ReactiveDB/
   Fabric APIs, preserving public UI prop/callback composition.
2. Define a versioned block document and draft/published revision boundary,
   autosave/conflict handling and a Gutenberg-style editor contract. The current
   display BlockRenderer is not an editor or Gutenberg format compatibility.
3. Define actual writing/review/publishing permissions, author lifecycle and
   retained attribution. Author enrollment does not itself grant arbitrary post
   administration.
4. Integrate Storage media and explicit public publication, actual alt text,
   dimensions, removal and safe embedding rules.
5. Assemble the default Magazine and sidebar-TOC article routes, author archives,
   slug redirects, optional search and safe preview/noindex behavior.
6. Use one admitted public revision for visible content and automatic existing
   SEO/canonical/social/BlogPosting/sitemap integration. No private draft or
   scheduled future post may leak into discovery.

Each slice needs existing-project additive upgrade support, organization/site
isolation, accepted revision semantics, background lifecycle and public-package
qualification. Scheduled publication and notification delivery need durable
work boundaries, not process-local animation timers.

## Author Foundation Extensions

An author-management/profile UI, custom site slugs/domain bindings, public
directory pagination, previews, profile redirects, account-deletion retention
tools and transfer/erasure policies remain future work. Do not invent these
APIs in app code because the metadata schema exists.

No engagement fingerprinting, screenshot collection or session replay is
imported with the recovered blog UI. Any later analytics must use explicit
application privacy policy and the supported Logging boundaries.
