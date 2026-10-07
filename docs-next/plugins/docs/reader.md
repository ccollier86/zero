---
id: zero.plugin-docs.reader
type: reference
audience: [developer, agent]
owner: docs-plugin
status: draft
visibility: internal
---

# Reader Layout And Theme

[Docs plugin index](./index.md) · [Documentation index](../../index.md)

The packaged default reader is a standalone public page. Its server output
contains the article, navigation, headings, colored code and previous/next links.
Client hydration adds disclosures, command search, active TOC tracking, copy
controls and the existing Zero theme transition. It does not create a second
Sync client or wait for an authenticated app provider.

The current `@zero/plugin-docs` 0.1.1 preview requires framework 2.6.0 or newer
within major 2. Its shared `Kbd`/`KbdGroup` imports are a package prerequisite,
including when `search: false`; disabling an optional reader feature does not
lower the declared framework peer requirement.

## Default Composition

The left nav scrolls independently and groups folder topics using nested vertical
rails. The current page has a restrained active surface and leading marker.
The article has a readable maximum width and contained code/table scrolling.
On wide screens the right TOC follows headings without taking over the article.

At smaller widths the TOC yields space to the article. Mobile navigation opens
the existing Zero sheet with a clear close action. Without JavaScript, the
article and normal links still work, and mobile readers get a plain browse
disclosure. Breadcrumbs are optional and off by default.

The footer names the actual previous/next pages in authored navigation order.
These are lightweight text links with direction icons, not large cards.
An optional external repository edit link is an authoring convenience, not
permission to edit files through the plugin.

## Search And Keyboard Use

Use the search button or `Cmd/Ctrl+K`. The command dialog searches admitted
titles, descriptions and visible passages on the server, then groups useful
section targets under each page. It shows matched terms, ancestry and excerpts;
arrow keys choose a result and Enter opens its real canonical link.
The trigger and footer use the [shared Kbd/KbdGroup presentation](../../frontend/components/kbd.md)
for compact hints; those components do not register or change these commands.

Queries are bounded and debounced; superseded requests cannot replace newer
results. Loading, no-results and retry states are explicit. Input/footer stay
visible while results scroll within the current visual viewport. Escape returns
focus to the actual invoking control, including inside an open mobile drawer.
Modified clicks retain native link behavior. Current-tab selections can focus
and highlight their destination passage with a one-use, page-hash-bound handoff.
See [Search and result navigation](./search.md) for ranking, Unicode ranges,
keyboard behavior, query privacy and clear-highlight semantics.

Heading and code-line links are normal keyboard-reachable anchors. The page
provides a skip-to-content link, named navigation/TOC landmarks, a primary page title,
semantic tables/callouts and escaped non-executable content.
When frontmatter supplies a different title, an authored first H1 remains
visible and searchable in the body rather than being discarded; see
[Authoring](./authoring.md#folders-and-navigation).

## Tokens

The plugin consumes the current Zero **public lane**. It does not change the
application palette or implement the future global UI redesign. Shared controls
receive public-lane aliases even in their sidebar/search portals.

All plugin visual defaults are centralized in its `styles.css`:

| Token family | Controls |
| --- | --- |
| `--zero-docs-background/foreground/muted/border/surface/hover/accent/active-background` | Semantic surfaces and state colors, inherited from Zero public roles |
| `--zero-docs-font*`, `--zero-docs-title*`, `--zero-docs-h2/h3-size`, `--zero-docs-line-height` | Interface/article type scale |
| `--zero-docs-header-*`, `--zero-docs-navigation-*` | Header/nav density, guides, dimensions and radius |
| `--zero-docs-reading-width`, `--zero-docs-article-*`, `--zero-docs-column-gap` | Reading width and responsive spacing |
| `--zero-docs-toc-*`, `--zero-docs-rail-width/active-rail-width` | TOC density and active guide |
| `--zero-docs-callout-*`, `--zero-docs-table-padding/image-radius` | Content presentation |
| `--zero-docs-search-*`, `--zero-docs-key-*` | Search viewport/dialog dimensions, result density, match/target roles and shortcut labels |
| `--zero-docs-focus-*`, `--zero-docs-scroll-offset` | Focus visibility and anchor positioning |
| `--zero-docs-motion-duration/motion-ease/hover-translation` | Restrained interaction motion |

Override these roles in the application's theme stylesheet, after plugin
defaults. For example:

```css
:root {
  --zero-docs-reading-width: 44rem;
  --zero-docs-navigation-width: 15.5rem;
  --zero-docs-accent: var(--public-accent);
}
```

Media breakpoints are structural: mobile nav below 48rem, compact article/header
below 64rem, wide TOC at 80rem. Reduced-motion preferences disable the plugin's
disclosure/hover animation and inherited micro-transitions. Code presentation uses the shared CodeBlock token
family rather than a separate syntax palette.

## Optional React Composition

```tsx
import { DocsContent, DocsCallout } from '@zero/plugin-docs/react';
```

The React facade exposes the packaged reader parts for advanced composition.
`DocsContent` receives an admitted page and its ordered server highlights;
it is not a Markdown parser. `DocsApp` receives `DocsPageProps` and owns the
standalone theme/sidebar composition. Ordinary apps should use `docs()` rather
than rebuilding publication, SSR, search or asset admission around these parts.

| Component | Inputs and composition requirements |
| --- | --- |
| `DocsApp` | `DocsPageProps`: presentation, admitted page/navigation, ordered highlights, optional previous/next links and request nonce. Owns standalone ThemeProvider/SidebarProvider and inert hydration props. |
| `DocsContent` | `{page, highlights, basePath?}`. Renders the allowlisted AST, typed fence presentation, tables, callouts, footnotes and transient search landing. `basePath` defaults to `/docs`; custom mounts must pass their actual mount. Inline prose code stays valid semantic phrasing content. |
| `DocsNavigation` | `{navigation, page, presentation, onReturnFocus?}` inside Zero `SidebarProvider` and `DocsNavigationScope`. Owns grouped/active links, mobile close and narrow-screen site links. `DocsApp` bridges return focus to its real nav trigger. |
| `DocsNavigationScope` | `{children}` inside `SidebarProvider`, wrapping navigation/search together. Coordinates drawer/search close-focus lifecycles before same-page article landing; `DocsApp` installs it automatically. |
| `DocsToc` | `{headings}`. Renders H2–H4 links and browser reading-position tracking; ordinary anchors work in SSR. |
| `DocsCallout` | `{tone?, title?, children, searchId?}`; tone is `note`, `tip`, `warning` or `danger`. `searchId` binds an admitted passage target; content is React composition, not HTML execution. |
| `DocsFooter` | `{previous?, next?, presentation}`. Honors page-navigation/edit-link settings. |
| `DocsSearch` | `{presentation}`. Uses the configured public mount/search API and existing CommandDialog; no Guardian credential fabrication. |

`highlights` must come from Zero's trusted server preparation and match each
code node in occurrence order. Do not synthesize trusted HTML from user input.
Named public types include `DocsPresentation`, `DocsPageProps`, `DocsPageLink`
and `DocsSearchResult`. Mounting `DocsApp` inside another authenticated app is
not a substitute for publishing/permission admission on the server.

Custom composition must keep `DocsNavigation`, `DocsSearch` and the article in
one reader lifecycle, with navigation/search under `DocsNavigationScope` inside
the shared `SidebarProvider`. The scope closes an open mobile drawer and waits
for both modal close-focus callbacks before a same-page result focuses the
article. A fixed timeout is not an equivalent composition contract. Ordinary
Escape dismissal still returns to the invoker inside the existing drawer.

## Related Guides And Next Steps

- [Configuration](./configuration.md) documents presentation switches.
- [Search](./search.md) owns result targeting, ranking and highlight privacy.
- [API](./api.md) gives the exact exports and projections.
- [CodeBlock](../../frontend/components/public-pages/code-block.md) explains
  shared examples, copy semantics and syntax tokens.
- [Design system](../../frontend/design-system/index.md) explains lane intent.
