---
id: zero.plugin-docs.roadmap
type: roadmap
audience: [developer, agent, maintainer]
owner: docs-plugin
status: draft
visibility: internal
---

# Documentation Plugin Roadmap

[Docs plugin index](./index.md) · [Documentation index](../../index.md)

These are future capabilities, not implemented configuration settings.

## Planned Follow-Ups

- [ ] Permission-gated viewer/editor: authorized users edit source through a
  deliberate authority/storage boundary, with accepted saves, conflict handling
  and safe publication review. Reading permission is not authoring permission.
- [ ] Protected mounts with live Guardian admission across page/search/Markdown/
  asset projections, scope-aware caches and revocation. Do not bolt auth onto
  only the visible page and leave its other projections public.
- [ ] Versioned collections with explicit canonical links and version-aware search.
- [ ] Registered component previews, curated examples and interactive tutorials.
  Markdown must never import arbitrary app code or execute arbitrary fences.
- [ ] Development/Doctor diagnostics for publication/link/index rules through
  supported tooling, not a private raw-file API exposed to anonymous readers.
- [ ] Optional navigation overrides and persisted section preferences after the
  folder-driven baseline is qualified.
- [ ] Bounded typo tolerance, recent/popular suggestions, an all-results page
  or optional external/semantic search after measured demand. Current local
  type-ahead search already includes passage targets, grouping, Unicode-safe
  result/destination highlighting and native links; these are not future work.

## Design Direction

The separate global UI rework will refine typography, density, surfaces and
shared motion. This reader uses current Zero tokens so it follows that future
theme work without an unrelated docs-only palette. UI reorganization/package
splitting is also separate from this optional documentation package.

## Related Guides And Next Steps

- [Reader](./reader.md) describes the current public read-only experience.
- [Search](./search.md) distinguishes implemented matching from future suggestions.
- [Publication](./publication.md) describes the boundary future features preserve.
- [Configuration](./configuration.md) lists implemented flags only.
