---
id: zero.plugin-docs.authoring
type: how-to
audience: [developer, agent]
owner: docs-plugin
status: draft
visibility: internal
---

# Author Markdown Documentation

[Docs plugin index](./index.md) · [Documentation index](../../index.md)

Ordinary `.md` files work without frontmatter. The compiler supports CommonMark,
GFM tables/task lists/strikethrough, footnotes and the callouts below. It does not
evaluate MDX, raw HTML, scripts or fence contents.

## Folders And Navigation

```text
documentation/
  index.md
  getting-started/
    index.md
    installation.md
    first-app.md
  reference/
    schema.md
    assets/
      diagram.png
  .docsignore
```

An `index.md` is its folder's landing; `README.md` is the fallback. Without
either, the compiler generates a landing from admitted child topics. File/folder
names supply human labels and deterministic natural ordering. Folder groups
have nested rails and their own landing links.

Routes are normalized, content-root-relative URLs under `basePath`. Explicit
slug/redirect conflicts fail the build rather than unpredictably selecting a
file. The first H1 supplies the default title. It appears once when it matches
the final page title; a different frontmatter title leaves the authored H1
visible in the body rather than silently deleting that content. Repeated
headings receive deterministic distinct anchors. Inline formatting preserves
heading text: `# get**User**` has the displayed text `getUser`, not `get User`.

Page titles, navigation labels, heading text/anchors, code titles and footnote
identifiers are bounded to 256 UTF-16 code units. Canonical public page routes
are bounded to 4,096. An inferred value exceeding a bound produces an actionable
compiler error; browser-only truncation is not the validation boundary.

## Optional Frontmatter

```yaml
---
id: acme.docs.installation
title: Install Acme
description: Install and configure the client.
slug: getting-started/install
navigation:
  label: Installation
  order: 10
  hidden: false
searchable: true
visibility: public
status: verified
redirects: [old-installation]
x-acme:
  topic: client
---
```

`description` is included in search and HTML metadata. A distinct description
can appear beneath the page title; the reader avoids duplicating an extracted
introduction. Article prose remains the authored body. `id` is an optional unique semantic
identifier. `navigation.label/order/hidden` control presentation only.
`sidebar`, `order`, `label` and `hideFromNavigation` are recognized aliases;
prefer the single `navigation` mapping. `search` aliases `searchable` and cannot
disagree with it.

Classification keys are documented in [publication](./publication.md). Unknown
settings fail with a source-relative diagnostic; custom data must be namespaced
(for example `x-acme` or `acme.topic`). Safe shared documentation metadata such
as `audience`, `applies_to`, `modes`, `reviewed_against`, `related_packages`,
`maturity`, `system`, `feature`, `owner` and `type` is retained as bounded data,
not executable instructions or application settings. The standard `modes` list
and `related_packages` entries (`package`, `version`, `maturity`) do not need a
custom namespace. Supporting these fields never publishes internal, draft or
`_work/` content; the publication rules still run first. Other custom keys must
remain namespaced. YAML aliases/custom tags are rejected.

## Links And Attachments

```md
Read [installation](../getting-started/installation.md#configuration).
![Schema diagram](./assets/diagram.png)
Download the [checklist](./assets/checklist.pdf).
```

Relative references resolve against their source page, then rewrite to admitted
routes. Missing pages, excluded attachments and missing local fragments reject
publication. Explicit HTTP(S), `mailto:` and `tel:` links are allowed; image
schemes are narrower. Protocol-relative, credential-bearing and executable URLs
are rejected. Local images and attachments get hashed manifest-owned routes;
the app does not expose the source directory.

## Callouts

Use `note`, `tip`, `warning` or `danger` directives:

```md
:::tip[Keep credentials on the server]
Use the existing service boundary rather than passing a key to browser code.
:::
```

An optional `title` attribute is supported. Arbitrary HTML attributes are not.
GitHub-style blockquote markers such as `> [!WARNING]` are also supported.

## Code Fences

````md
```ts title="server.ts" showLineNumbers {2} /app/
const name = 'Zero';
const app = createApp(config); // [!code ++]
console.log(app); // [!code focus]
```
````

Fences use Zero's shared [CodeBlock](../../frontend/components/public-pages/code-block.md)
metadata and diff/focus/word transforms. The server prepares colored HTML once.
The reader does not download a second Markdown parser or browser Shiki engine.
Unknown languages render escaped readable source rather than executing code.
Fence line links use document-unique prefixes. The copy action copies the source,
not rendered HTML or line-number gutters.

## Related Guides And Next Steps

- [Publication](./publication.md) distinguishes hiding a link from excluding data.
- [API](./api.md) explains the frontmatter-free Markdown projection.
- [Search](./search.md) explains how visible text, labels and descriptions are indexed.
- [Operations](./operations.md) covers actionable build failures and refresh.
