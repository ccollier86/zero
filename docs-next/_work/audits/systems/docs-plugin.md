---
id: zero.inventory.docs-plugin
type: inventory
audience: [agent, maintainer]
owner: docs-plugin
status: in-review
visibility: internal
system: docs-plugin
feature: system-inventory
maturity: preview
applies_to: ["2.5.0 source/local release with @zero/plugin-docs 0.1.0"]
modes: [public read-only, development, production]
reviewed_against:
  package: "@zero/framework"
  version: "2.5.0"
  commit: "0ef2cb30d47788722627014c7a28da616f33b5c8"
  snapshot: clean
  date: "2026-10-06"
  evidence_level: source-observed
related_packages:
  - package: "@zero/plugin-docs"
    version: "0.1.0"
    maturity: preview
---

# Optional Markdown Documentation System

[System inventories](./index.md) · [Qualification ledger](../docs-plugin-qualification.md)
· [Plugin index](../../../plugins/docs/index.md)
· [Documentation index](../../../index.md)

## Purpose And Identity

The optional `@zero/plugin-docs` package supplies public read-only documentation
from one explicitly selected folder. Its native declaration plugs into Zero's
ordinary server lifecycle and required build contributions. Parser dependencies
remain optional-package runtime dependencies, not mandatory framework services.

This supplemental inventory records the committed 2.5.0 source/local release
above, not a replacement of the other systems' pinned original 2.1.1 audits.
Its metadata deliberately records **source observation**, not artifact
qualification. Exact archive identities and synthetic installed/compiled
deployment results belong to the [qualification ledger](../docs-plugin-qualification.md).
A local archive check does not imply availability in a public package registry.

## Features And Documentation Coverage

The rows enumerate implemented contracts and their canonical documentation
homes. Exported reader components are accounted for individually, even when
they share a guide. These are placement and source-ownership records, not a
claim that every guide, runtime mode or future public documentation site has
completed an independent acceptance review.

| Feature | Maturity and modes | Public surfaces | Evidence | Planned/final guide | Review status |
| --- | --- | --- | --- | --- | --- |
| Factory, options and trusted app identity | Preview; development/production | `docs()`, `DocsOptions` | `packages/docs/src/index.ts`, `options.ts`, `server/setup.ts` | [Configuration](../../../plugins/docs/configuration.md) | Authored; source observed |
| Bounded Markdown, frontmatter, GFM and directives | Preview; public read-only | Content compiler and supported authoring syntax | `packages/docs/src/content/compile.ts`, `frontmatter.ts`, `markdown.ts` | [Authoring](../../../plugins/docs/authoring.md) | Authored; source observed |
| Publication includes, exclusions, ignore rules and classification | Preview; public read-only | `include`, `exclusions`, `.docsignore`, publication metadata | `packages/docs/src/content/discovery.ts`, `publication.ts` | [Publication](../../../plugins/docs/publication.md) | Authored; source observed |
| Canonical routes, headings, local links and published Markdown | Preview; public read-only | Admitted page routes, anchors and Markdown projection | `packages/docs/src/content/routes.ts`, `links.ts`, `markdown-projection.ts` | [Authoring](../../../plugins/docs/authoring.md) | Authored; source observed |
| Admitted passive attachments and cache identity | Preview; public read-only | Explicit asset map, digest-addressed routes and response headers | `packages/docs/src/content/assets.ts`, `server/handler.ts` | [Publication](../../../plugins/docs/publication.md) | Authored; source observed |
| Passage-aware server search, ranking and safe match ranges | Preview; public read-only | Bounded search over the admitted manifest | `packages/docs/src/server/search.ts`, `search-index.ts`, `content/search-passages.ts` | [Search](../../../plugins/docs/search.md) | Authored; source observed |
| Public HTTP and agent projections | Preview; public read-only | Manifest, Markdown, search, sitemap, llms and GET/HEAD readers | `packages/docs/src/server/handler.ts`, `projections.ts`, `responses.ts` | [Public API](../../../plugins/docs/api.md) | Authored; source observed |
| Development withdrawal, rebuild and disposal | Preview; development | Watched snapshots and awaited native lifecycle | `packages/docs/src/server/watch.ts`, `setup.ts` | [Operations](../../../plugins/docs/operations.md) | Authored; source observed |
| Compiled artifact admission and source-free runtime | Preview; production | Admitted production snapshot and build assets | `packages/docs/src/server/artifact.ts`, `artifact-search.ts`, `build.ts` | [Operations](../../../plugins/docs/operations.md) | Authored; source observed |
| DocsApp server rendering, hydration and reader layout | Preview; public read-only | `DocsApp` | `packages/docs/src/ui/docs-app.tsx`, `hydrate.tsx`, `server/page.ts` | [Reader](../../../plugins/docs/reader.md) | Authored; source observed |
| Safe article and AST presentation | Preview; public read-only | `DocsContent` | `packages/docs/src/ui/docs-content.tsx`, `ui/index.ts` | [Reader](../../../plugins/docs/reader.md) | Authored; source observed |
| Grouped nested navigation and mobile reader navigation | Preview; public read-only | `DocsNavigation` | `packages/docs/src/ui/docs-navigation.tsx`, `ui/index.ts` | [Reader](../../../plugins/docs/reader.md) | Authored; source observed |
| Shared navigation and modal lifecycle scope | Preview; public read-only | `DocsNavigationScope` | `packages/docs/src/ui/docs-navigation-scope.tsx`, `ui/index.ts` | [Reader](../../../plugins/docs/reader.md) | Authored; source observed |
| Outline and active-heading navigation | Preview; public read-only | `DocsToc` | `packages/docs/src/ui/docs-toc.tsx`, `ui/index.ts` | [Reader](../../../plugins/docs/reader.md) | Authored; source observed |
| Callout tones and content presentation | Preview; public read-only | `DocsCallout` | `packages/docs/src/ui/docs-callout.tsx`, `ui/index.ts` | [Reader](../../../plugins/docs/reader.md) | Authored; source observed |
| Previous/next page navigation and footer presentation | Preview; public read-only | `DocsFooter` | `packages/docs/src/ui/docs-footer.tsx`, `ui/index.ts` | [Reader](../../../plugins/docs/reader.md) | Authored; source observed |
| Search palette, result navigation and transient landing highlights | Preview; public read-only | `DocsSearch` | `packages/docs/src/ui/docs-search.tsx`, `use-docs-search.ts`, `use-docs-search-landing.ts` | [Search](../../../plugins/docs/search.md) | Authored; source observed |
| Scoped tokens, microinteractions and reduced motion | Preview; public read-only | `@zero/plugin-docs/styles.css`, reader theme aliases | `packages/docs/src/ui/docs.css`, `use-docs-motion.ts` | [Reader](../../../plugins/docs/reader.md) | Authored; source observed |
| Shared Zero code presentation | Supported framework component; preview docs integration | Existing Zero CodeBlock family used by the reader | `src/components/code-block/`, `packages/docs/src/ui/code-options.ts`, `docs-content.tsx` | [CodeBlock](../../../frontend/components/public-pages/code-block.md) | Authored; source observed |
| Native build, SSR and shared React identity integration | Preview; development/production | Required server-plugin build and rendering contributions | `packages/docs/src/server/build.ts`, `setup.ts`; framework native build/SSR integration | [Build contributions](../../../backend/runtime/build-contributions.md) | Authored; source observed |
| Normal Zero build, compile and deployment integration | Preview; production | `zero build` and compiled app deployment | Framework build CLI and `packages/docs/src/server/build.ts` | [Build command](../../../cli/tooling/build.md) | Authored; source observed |

## Public Facades

- `@zero/plugin-docs`: server factory, option/content/error types.
- `@zero/plugin-docs/content`: bounded compiler and admitted-asset tooling.
- `@zero/plugin-docs/react`: `DocsApp`, `DocsContent`, `DocsNavigation`,
  `DocsNavigationScope`, `DocsToc`, `DocsCallout`, `DocsFooter`, `DocsSearch`
  and optional advanced reader composition types.
- `@zero/plugin-docs/styles.css`: centralized docs tokens/layout.

Default usage needs only `docs({ contentDir })` in `server/plugins/docs.ts`.
It does not require an AppProvider session, a docs database, per-page components,
another router, arbitrary SQL or a custom search backend. Source configuration
is trusted code; Markdown/files are untrusted inputs with enforced boundaries.

## Evidence And Roadmap

Executed source, browser, installed archive and compiled checks and confirmed
corrections are in the [qualification ledger](../docs-plugin-qualification.md).
Permission-gated authoring, protected mounts, versions and registered previews
remain explicitly staged in the [roadmap](../../../plugins/docs/roadmap.md).
The global token/library redesign is separate product work.
