# Zero Working Plans

These are internal product/design notes, not current API documentation or
release claims. They intentionally live outside `docs/` and `docs-next/` and
are not in the framework's current package publication list.

- [UI rework](./ui-rework.md): Linear-inspired shared theme, typography, density,
  tasteful microinteractions, component organization, and possible optional UI packages.
- [Guardian profiles and adaptive settings](./guardian-profile-settings.md):
  first-class profiles, staged avatars, contact verification, completion,
  shared save behavior, reusable settings organisms and the final Kbd step.
- [Guardian profile implementation outline](./guardian-profile-outline.md):
  the complete requirements checklist, screenshot relationships, feature-enable
  provisioning, delivery order and qualification gates for this run.
- [Guardian presence with Fabric and Reactive DB](./guardian-presence.md):
  connection leases, activity/status aggregation, protected reactive projections,
  actor reads, freshness, scope retirement and service lifetime.
- [Documentation plugin](./documentation-plugin.md): an optional, tokenized
  Markdown-folder-to-docs experience, its integration requirements, delivery
  sequence, and acceptance gates.
- [Documentation page experience](./documentation-page-design.md): reference
  study, article layout, callouts/code blocks, navigation/footer, mobile behavior,
  and the actual public/internal Zero component reuse boundaries.
- [Documentation/search review](./documentation-search-review.md): confirmed
  corrections, section-aware search, reader polish and regression evidence.
  Implementation and correction qualification pass; exact release checks are tracked
  in the qualification ledger below.

The documentation reader and shared CodeBlock replacement were implemented on
`feature/markdown-documentation-plugin` for framework 2.5.0 and optional
package 0.1.0, retaining main's intervening 2.4.1–2.4.3 fixes. The plans retain the
original design record; supported usage belongs in the
[plugin guide](../docs/plugins/markdown-docs.md) and
[CodeBlock guide](../docs/frontend/code-block.md), with focused checks recorded
in the [qualification ledger](../docs-next/_work/audits/docs-plugin-qualification.md).

Implementation must follow the [engineering standards](../docs/engineering-standards.md)
and [observability contract](../docs/observability.md). Product direction remains
in the [platform roadmap](../docs/platform-roadmap.md). These plans do not
authorize automatic publication of the isolated documentation rebuild.
