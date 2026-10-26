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

The working publishing branch now implements user-backed authors, isolated
Fabric content, immutable revisions, conditional drafts/publication, taxonomy,
private Storage media, indexed search, optional aggregate observations and
managed public rendering. The native workspace uses these APIs and existing Zero
controls/save/modal machinery. See [publishing APIs](./publishing-api.md) and the
[workspace manual](../../frontend/components/public-pages/blog/publishing-workspace.md).

The earlier `feature/blog-foundation-current` preview remains historical. See the
[qualification record](../../_work/audits/blog-author-foundation.md#resumed-continuation-2026-10-26)
for its retained checkpoint and migration overlap. It does not qualify the newer
publishing implementation.

The [implementation checkpoint](../../_work/blog-publishing-implementation.md)
tracks actual source/browser results and the remaining final package/Linux
qualification. No focused passing test substitutes for a qualified release.

## Implemented Working-Source Slices

1. One app-owned private Fabric file by default in either tenancy mode; explicit
   organization ownership for custom/headless composition.
2. Versioned canonical blocks, inline marks, CAS, stable command identities,
   separate published snapshots, immutable history and draft-only restoration.
3. Existing Guardian author/post restrictions, separate native scope ceilings,
   explicit public profiles/photos and retained approved historical names.
4. Private media allocation/normalization, bounded processing, per-placement alt,
   current-publication delivery and safe retained cleanup/refusal of referenced deletion.
5. Magazine/sidebar-TOC pages, real public search, category/tag filters, slug
   redirects and authorized private preview.
6. Metadata and structured data from the accepted public revision, trusted app
   origin and the existing SEO/sitemap lifecycle; explicit indexing controls win.

Each slice needs existing-project additive upgrade support, organization/site
isolation, accepted revision semantics, background lifecycle and public-package
qualification. Scheduled publication and notification delivery need durable
work boundaries, not process-local animation timers.

## Author Foundation Extensions

Custom site slugs/domain bindings, public all-author directories, author-profile
redirects, translations, scheduled publication, review assignments,
account-deletion retention tools and transfer/erasure policies remain future work. Do not invent these
APIs in app code because the metadata schema exists.

No engagement fingerprinting, screenshot collection or session replay is
imported with the recovered blog UI. Any later analytics must use explicit
application privacy policy and the supported Logging boundaries.
