---
id: zero.inventory.docs-plugin
type: inventory
audience: [agent, maintainer]
owner: docs-plugin
status: in-review
visibility: internal
system: docs-plugin
applies_to: ["2.5.0 working implementation; optional package 0.1.0"]
reviewed_against:
  package: "@zero/framework"
  version: "2.5.0"
  commit: "636b1c01b3484317df56ce624c7cd57976ee417c"
  snapshot: dirty
  date: "2026-10-06"
  evidence_level: package-qualified
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

This is a supplemental 2.5.0 dirty-working-tree inventory based on 2.4.0 main,
not a replacement of the registry's pinned original 2.1.1 source audit.
Actual archives and synthetic installed/compiled deployments were checked; no
clean release commit, registry publish or main merge follows from this metadata.

## Feature And Ownership Map

| Feature | Implementation owner | Canonical guide |
| --- | --- | --- |
| Factory/options/app identity | `packages/docs/src/index.ts`, `options.ts`, `server/` | [Configuration](../../../plugins/docs/configuration.md) |
| Bounded Markdown/frontmatter/directives | `packages/docs/src/content/` | [Authoring](../../../plugins/docs/authoring.md) |
| Includes/exclusions/ignore/classification | Content discovery/admission and canonical asset guards | [Publication](../../../plugins/docs/publication.md) |
| Links, headings, GFM, canonical Markdown | Shared admitted AST/manifest; serializers and slugger | [Authoring](../../../plugins/docs/authoring.md) |
| Search/manifest/Markdown/sitemap/llms/HEAD | Runtime routes over the same immutable manifest | [Public API](../../../plugins/docs/api.md) |
| Safe private attachments and caching | Explicit admitted asset map, hashed routes, ETag/content-type contracts | [Publication](../../../plugins/docs/publication.md) |
| Development withdrawal and rebuild | Generation-fenced watcher and awaited native disposal | [Operations](../../../plugins/docs/operations.md) |
| SSR, hydration and layout | `packages/docs/src/ui/` safe AST reader; existing Sidebar/Command/theme controls | [Reader](../../../plugins/docs/reader.md) |
| Docs theme aliases/motion | `packages/docs/src/ui/docs.css`, `use-docs-motion.ts` | [Reader](../../../plugins/docs/reader.md) |
| Shared code presentation | Replaced `src/components/code-block/` family; no second engine/renderer | [CodeBlock](../../../frontend/components/public-pages/code-block.md) |
| Build artifacts and React identity | Framework native build/SSR contributions | [Build contributions](../../../backend/runtime/build-contributions.md) |
| Normal build and compiled deployment | Framework `zero build` CLI | [Build command](../../../cli/tooling/build.md) |

## Public Facades

- `@zero/plugin-docs`: server factory, option/content/error types.
- `@zero/plugin-docs/content`: bounded compiler and admitted-asset tooling.
- `@zero/plugin-docs/react`: optional advanced reader composition/types.
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
