---
id: zero.plugin-docs.publication
type: architecture
audience: [developer, agent, operator]
owner: docs-plugin
status: draft
visibility: internal
---

# Publication And Exclusions

[Docs plugin index](./index.md) · [Documentation index](../../index.md)

The content root is a publication boundary, not a raw file-server root. A single
admitted manifest supplies every public view: HTML, navigation, TOC, search,
Markdown, agent index, sitemap and attachments. Excluded input must not survive
in another projection.

Search indexes only admitted visible text and uses manifest-owned passage IDs,
heading ancestry and immutable page identities. Compiled snapshot admission
validates those annotations against the AST rather than trusting a second
metadata source. Unknown/orphaned targets, invalid labels and inconsistent
passage text/order reject startup. Earlier version-1 snapshots without the
additive passage metadata can derive the same projection from their admitted
AST; absence is not permission to bypass bounds or content admission.

## Policy Precedence

1. Mandatory path containment and internal/tooling exclusions apply first.
2. The selected `.docsignore` supplies ordered Git-pattern ignore rules.
3. Configuration `exclusions` add denies; these cannot be undone by negation.
4. An optional `include` allowlist narrows eligible files further.
5. Frontmatter classification rejects non-public and draft/in-review pages
   before their Markdown bodies are parsed.

Dot-prefixed or underscore-prefixed path segments and dependency/build/tooling
folders (`node_modules`, `vendor`, `dist`, `build`, `coverage`, `target`) are
never published. This includes `_work/` and private dotfiles. Symlinks cannot
escape the content root or rescue an excluded canonical target through an alias.

`visibility: internal/private`, `access: private/protected/internal`,
`draft: true` and `status: draft/in-review` exclude a page. Plain files are
eligible public content; for reviewed documentation, `visibility: public` and
`status: verified` state the intent explicitly. Conflicting, malformed or unknown
recognized values are errors, not permissive fallbacks.

## `.docsignore`

```gitignore
# Root-relative rules, using Git pattern semantics.
notes/
**/*.working.md
drafts/*
!drafts/released.md
```

The ignore library handles comments, escaped markers, ordered negations,
directory patterns and `**`. A negation cannot re-include a file beneath an
ignored parent until that parent is re-included. It also cannot override
mandatory safety/classification/configuration denies.

Only the explicitly selected root-relative file is used. Ambient `.gitignore`,
global Git excludes, tracked status and Git repository discovery have no effect.
Missing default `.docsignore` is allowed. An explicit missing file, or an
existing unreadable/invalid ignore file, rejects publication. `ignoreFile: false`
disables this optional input, not the other boundaries.

## Inclusion Is Not A Permission

```ts
import { docs } from '@zero/plugin-docs';

export default docs({
  contentDir: './documentation',
  include: ['index.md', 'guides/**', 'assets/**'],
  exclusions: ['guides/operator-notes.md'],
});
```

`include` uses positive patterns for pages **and attachments**. Include needed
assets deliberately. It is not an override for internal classification.

`navigation.hidden: true` removes a sidebar item while retaining its public
route. `searchable: false` removes search results while retaining its public
route. Neither setting makes content private. Link validation still applies.

## Attachments

Only referenced, admitted passive formats are packaged. Supported images are
PNG/JPEG/GIF/WebP/AVIF/ICO; downloads include PDF/text/CSV/JSON. SVG, HTML and
executable files are not served. Download responses use `nosniff` and attachment
disposition where appropriate.

Attachments remain private build files until a current manifest-owned hashed
route admits them. They are not permanent public `/_build` copies. In development,
a source-policy change retires the old snapshot before replacement; old asset
routes stop working. A downloaded public document cannot be recalled from a
reader's device, but subsequent server reads do not bypass the new policy.

## Related Guides And Next Steps

- [Authoring](./authoring.md) covers valid metadata, links and code.
- [Operations](./operations.md) covers failed rebuild behavior and recovery.
- [API](./api.md) documents all projections of the admitted content.
- [Search](./search.md) covers index ownership and stale-result rejection.
