---
id: zero.frontend.components.blog.index
type: index
audience: [developer, agent]
owner: frontend-components
status: in-review
visibility: internal
system: frontend-components
feature: blog-ui
maturity: preview
applies_to: ["2.6.0 UI source on feature/blog-foundation; not the selected main archive"]
modes: [browser, SSR, public-pages]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "68ed0ba811437375dac340474e972952d7c88ab7"
  snapshot: clean
  date: "2026-10-25"
  evidence_level: package-qualified
  artifact:
    version: "2.6.0"
    commit: "68ed0ba811437375dac340474e972952d7c88ab7"
    sha256: "0457000e8d564f7fa838a5be9963827b1f6c0c0eda93845899cb5be598d415b9"
---

# Blog UI Components

[Public pages index](../index.md) · [Documentation index](../../../../index.md)

Compose editorial pages from `@zero/framework/blog`. The default list is
Magazine: a large recent article beside two stacked previews, followed by the
article grid. The default article is the recovered demo's contained hero,
centered reading column and right-hand sidebar TOC. Neither requires a variant
setting. Author information, social links, sharing and newsletter content are
optional; absent integration data does not become a placeholder control.

Importing this family alone enables no backend. The display-only parts accept
data/content/URLs/callbacks. The new optional native workspace and editor use the
existing authenticated SDK when mounted; they do not provision services by import.

The opt-in [publishing backend](../../../../backend/blog/index.md) now provides
user-backed authors, private Fabric content, media, search and published-only
reader assembly on the working feature branch. The [publishing workspace](./publishing-workspace.md)
uses those facades without rebuilding the app's shell/auth. Final installed
release qualification remains separate from source/browser checks.

This is a Zero-native adaptation, not an import-compatible copy of the archived
Next.js package. Shared buttons, inputs, menus, tooltips, avatars, cards and code
rendering reuse Zero. Archived Connected wrappers and singleton stores are
replaced by explicit props/callbacks; theme switching, fingerprinting and the
screenshot proxy are not imported.

## Start With The Defaults

Use the app's normal Zero stylesheet and theme setup, then:

```tsx
import { BlogListPage, BlogPostPage, type BlogPost } from '@zero/framework/blog';

const post: BlogPost = {
  id: 'welcome', slug: 'welcome', title: 'Welcome',
  excerpt: 'An introduction to our work.',
  blocks: [
    { type: 'heading', level: 2, text: 'Getting started' },
    { type: 'paragraph', text: 'Useful content goes here.' },
  ],
};

// Render on the list route:
<BlogListPage posts={[post]} />;
// Render on the article route:
<BlogPostPage post={post} />;
```

`@zero/framework/components/blog` is the same focused family. The main React
facade also exposes the Blog-prefixed layouts, cards, search and data types.
Use the focused import for the complete smaller parts and their props.

The [qualification record](../../../../_work/audits/blog-ui-qualification.md)
identifies the frozen UI source/archive and the focused checks. Feature-branch
readiness does not select it as the main package or enable publishing.

## Component Guides

- [Publishing workspace and managed reader](./publishing-workspace.md) covers complete app integration, composition, save/retry, media, author profiles, SEO and actual release boundaries.
- [Layouts](./layouts.md) covers Magazine, sidebar/list alternatives, heroes,
  article composition, TOC discovery and optional sections.
- [Parts and media](./parts.md) covers cards, author/category presentation,
  pagination, images, media players, links, citations and newsletter UI.
- [Images, search and previews](./images-and-previews.md) covers gallery zoom/lens,
  rich hover cards, inline search, reading indicators and managed newsletter openings.
- [Composable media](./media.md) lists every audio/video control and player option.
- [Complete migration inventory](./migration.md) maps every recovered export,
  including shared replacements and deliberate exclusions.
- [Configuration and tokens](./configuration.md) documents presentation
  defaults, optional routing adaptation, theme inheritance and motion.
- [Content blocks](./content-blocks.md) defines the escaped, typed renderer
  accepted by the UI; it is not the future editor or storage schema.
- [Roadmap](./roadmap.md) preserves the design requirements and distinguishes implemented working-source behavior from later extensions.

Blog search uses the general [CommandPalette](../../controls/command-palette.md),
not a separate blog modal, global state store or screenshot service. It keeps
rich results and the two-panel group filters while the existing command controls,
magnetic highlight, ScrollArea and modal manager retain their responsibilities.

## Related Guides And Next Steps

- [Public UI development](../../../../guides/public-ui-development.md) owns site assembly.
- [SEO](../../../../backend/configuration/seo.md) describes the existing metadata foundation;
  rendering a BlogPostPage does not itself publish head metadata or sitemap entries.
- [Modal manager](../../../modals/index.md) owns image/palette focus, stack and dismissal.
