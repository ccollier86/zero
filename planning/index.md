# Zero Working Plans

These are internal product/design notes, not current API documentation or
release claims. They intentionally live outside `docs/` and `docs-next/` and
are not in the framework's current package publication list.

- [UI rework](./ui-rework.md): Linear-inspired shared theme, typography, density,
  tasteful microinteractions, component organization, and possible optional UI packages.
- [Documentation plugin](./documentation-plugin.md): an optional, tokenized
  Markdown-folder-to-docs experience, its integration requirements, delivery
  sequence, and acceptance gates.
- [Documentation page experience](./documentation-page-design.md): reference
  study, article layout, callouts/code blocks, navigation/footer, mobile behavior,
  and the actual public/internal Zero component reuse boundaries.
- [Documentation/search review](./documentation-search-review.md): confirmed
  corrections, section-aware search, reader polish and regression evidence.
  Implementation has resumed; final browser/archive release checks are tracked
  in the qualification ledger below.

The documentation reader and shared CodeBlock replacement are implemented on
`feature/markdown-documentation-plugin`, targeting framework 2.5.0 and optional
package 0.1.0. They are not published or merged to main. The plans retain the
original design record; supported usage belongs in the
[plugin guide](../docs/plugins/markdown-docs.md) and
[CodeBlock guide](../docs/frontend/code-block.md), with focused checks recorded
in the [qualification ledger](../docs-next/_work/audits/docs-plugin-qualification.md).

Implementation must follow the [engineering standards](../docs/engineering-standards.md)
and [observability contract](../docs/observability.md). Product direction remains
in the [platform roadmap](../docs/platform-roadmap.md). These plans do not
authorize automatic publication of the isolated documentation rebuild.
