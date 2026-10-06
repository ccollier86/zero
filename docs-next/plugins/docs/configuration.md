---
id: zero.plugin-docs.configuration
type: reference
audience: [developer, agent, operator]
owner: docs-plugin
status: draft
visibility: internal
---

# Documentation Plugin Configuration

[Docs plugin index](./index.md) · [Documentation index](../../index.md)

`docs(options)` is a server declaration from `@zero/plugin-docs`. Only
`contentDir` is required. Configuration is explicit app code; V1 has no database
settings store, environment-variable parser or tenant override hierarchy.

| Option | Type / default | Meaning |
| --- | --- | --- |
| `contentDir` | Required string | Selected content root; relative to the immutable app project root. |
| `name` | String; derived from mount | Stable plugin identity. Give independent mounts unique names. |
| `basePath` | String; `/docs` | Absolute URL namespace, no query/fragment or traversal. |
| `title` | String; `<App name> Documentation`, or `Documentation` | Reader brand and page-title suffix. Explicit values override trusted app metadata. |
| `include` | Optional positive pattern array | Allowlist for both pages **and** referenced attachments. |
| `exclusions` | Positive pattern array; none | Additional publication denies that ignore negation cannot undo. |
| `ignoreFile` | String or `false`; `.docsignore` | Root-relative Git-pattern ignore file. `false` disables only this input. |
| `allowEmpty` | Boolean; `false` | Deliberately permit an empty production collection. |
| `limits` | Optional mapping | Bounded document/asset/build budgets; see below. |
| `breadcrumbs` | Boolean; `false` | Optional article ancestry. The default matches the reference's quiet header. |
| `search` | Boolean; `true` | Command search and its public query endpoint. |
| `toc` | Boolean; `true` | On-page headings rail on wide screens. |
| `pageNavigation` | Boolean; `true` | Title-bearing previous/next links in navigation order. |
| `headerLinks` | Array; empty | At most 12 `{label, href}` site links, using admitted local/HTTP(S) URLs. |
| `siteUrl` | Optional HTTP(S) URL; trusted app `publicUrl` fallback | Site origin/prefix for canonical links and sitemap. Never inferred from `Host`. |
| `editUrl` | Optional HTTP(S) URL | Repository-directory URL; the server appends encoded source-relative segments. This is an external edit link, not an embedded editor. |
| `themeStorageKey` | String; `theme` | Existing ThemeProvider presentation preference; optional explicit isolation. |
| `watch` | Boolean; `true` | Development-only source refresh. Production always consumes its snapshot. |

Unknown options are rejected. Protected mounts, versions and executable previews
are [roadmap features](./roadmap.md), not flags that quietly do nothing.

## A Configured Mount

```ts
import { docs } from '@zero/plugin-docs';

export default docs({
  contentDir: './documentation',
  title: 'Acme Docs',
  basePath: '/help',
  breadcrumbs: false,
  headerLinks: [{ label: 'Application', href: '/app' }],
  exclusions: ['notes/', 'review-only.md'],
  siteUrl: 'https://example.test',
  editUrl: 'https://github.com/example/project/edit/main/documentation/',
});
```

This publishes only eligible content in the chosen folder. It does not publish
the repository, merge ambient `.gitignore` rules or infer Guardian permissions.

## Resource Budgets

| `limits` field | Default | Unit |
| --- | --- | --- |
| `maxDocuments` | 5,000 | Markdown candidates admitted by path policy, before frontmatter classification |
| `maxDocumentBytes` | 512,000 | UTF-8 bytes per Markdown input |
| `maxFrontmatterBytes` | 32,768 | Bytes per YAML header |
| `maxAssetBytes` | 8,388,608 | Bytes per referenced attachment |
| `maxTotalBytes` | 134,217,728 | Total admitted document/attachment bytes |

Each override must be a positive safe integer, no greater than eight times its
default. Parsing also bounds node/depth/code-fence/metadata expansion. Increasing
a limit does not bypass publication, safe URLs or path containment.

`maxDocuments` counts path-admitted `.md` candidates, not passive attachments or
only final published pages. A candidate later excluded by frontmatter still
counts toward discovery's document limit. Use path exclusions for large private
subtrees rather than assuming their classification makes discovery unlimited.
Attachments are bounded separately by asset/total byte budgets.

Separate fixed admission bounds apply to inferred and explicit labels: page
titles, navigation labels, headings/anchors, code titles and footnote IDs are at
most 256 UTF-16 code units; canonical page routes are at most 4,096. AST depth is
at most 64 and each page contains at most 25,000 nodes. These are not unlimited
because a document-byte budget was raised. Search has its own bounded query,
excerpt, match-range and result contracts in [Search](./search.md#bounds-and-search-api).

## Multiple Mounts

Declare independent plugins with distinct names and non-overlapping namespaces.
Build-time ownership checks reject overlapping plugin mounts and app route
conflicts. `/` is a deliberate whole-site claim, not the default. Core API/build
namespaces remain reserved; do not use documentation to shadow platform routes.

## Related Guides And Next Steps

- [Publication](./publication.md) gives the exact precedence and ignore grammar.
- [Operations](./operations.md) connects config identity to compiled artifacts.
- [Native build contributions](../../backend/runtime/build-contributions.md)
  define the framework artifact/setup contract behind this declaration.
- [Reader](./reader.md) documents theme tokens instead of hardcoded per-page CSS.
- [Search](./search.md) describes the enabled search experience and fixed budgets.
