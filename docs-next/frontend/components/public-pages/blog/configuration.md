---
id: zero.frontend.components.blog.configuration
type: reference
audience: [developer, agent]
owner: frontend-components
status: in-review
visibility: internal
---

# Blog Presentation And Design Tokens

[Blog UI index](./index.md) · [Documentation index](../../../../index.md)

Configuration is React props and scoped CSS, not AppConfig, database settings
or environment variables. Import the app's normal Zero styles. Full layouts
create their own blog styling scope; wrap standalone smaller parts in
BlogProvider. Its context is instance-local and contains presentation only.

```tsx
import { BlogProvider, BlogListPage } from '@zero/framework/blog';
import { Link } from '@zero/framework/react';

<BlogProvider
  baseUrl="/journal"
  linkComponent={Link}
  style={{ '--zero-blog-prose-width': '46rem' } as React.CSSProperties}
>
  <BlogListPage posts={posts} />
</BlogProvider>;
```

This is a composition fragment; `posts` belongs to the app. Provider options
are baseUrl (fallback /blog), postHref(post), compatible linkComponent and
locale (fallback en-US), plus children/className/style. Nested providers inherit
unspecified options. A nested full layout does not reset the parent's blog token
overrides.

Native anchors are the portable default, requiring neither Next.js nor a Zero
router provider. A link adapter is optional; supply Zero Link only inside its
normal router context. A post's href wins over generated baseUrl/encoded slug;
provider postHref has highest precedence. URLs are limited to root-relative,
fragment/query or HTTP(S) links, with mailto allowed only for link presentation.
Protocol-relative, credential-bearing and executable URLs are not admitted.
No screenshot or URL-preview proxy is contacted.

## Visual Token Ownership

The family retains the reference's asymmetric Magazine grid, editorial images,
large article heading, centered reading measure, soft category badges and
sidebar TOC. It does not transplant its old independent palette, UI primitives,
animation engine or theme toggle.

Every default color is a semantic alias. The `--zero-blog-*` namespace maps to
the current public lane with application-semantic fallbacks. Typography,
spacing, radii, borders, media proportions, control geometry and motion have
named override points in the canonical
[blog token file](../../../../../src/components/blog/blog-tokens.css).

| Token group | Role |
| --- | --- |
| background / surface / raised / text / secondary / muted / border | Public surface/text/border aliases; no hardcoded archive light/dark colors. |
| accent / accent-foreground / accent-soft / ring | Existing public accent and focus roles. |
| success / warning / danger | Existing semantic feedback roles for category/callout tones. |
| font / mono | Existing public/platform typography families; no new font loader. |
| type-body / type-prose / type-small / type-caption / type-label / type-title / type-article-title / type-heading / type-card-title | Editorial type roles retaining the reference hierarchy. |
| leading-body / leading-prose / leading-heading / weight-* / tracking-heading | Reading rhythm, emphasis and heading spacing. |
| space-1 through space-16 | Layout spacing with Zero spacing aliases where available. |
| page-width / prose-width / toc-width / sidebar-top | Magazine measure and centered article/sidebar geometry. |
| radius / radius-small / border-width / shadow / focus-width | Shared material and focus treatment. |
| avatar* / icon / control-height / disabled-opacity | Compact identity/control geometry. |
| media-aspect / hero-aspect / feature-aspect / lightbox-height / player-seek-min-width / waveform-height / volume-width | Media and player geometry. |
| duration-fast / duration-standard / duration-enter / ease / hover-lift / media-zoom / media-duration / enter-distance | Zero task-motion aliases, not the archive's timing presets. |

Category tone is accent, success, warning, danger or neutral. Arbitrary archive
hex colors are not copied into data records as the design system. Change
semantic roles or scoped token values deliberately instead.

## Motion And Shared Components

Zero motion is the default. Entrance, hover and media feedback use shared theme
timings/geometry; prefers-reduced-motion removes motion while keeping content
and interaction available. Native media and scrolling are not disabled.

Tooltips keep Zero's grow/arrow defaults. Interactive previews keep the shared
Popover and ScrollArea. Image expansion and rich search use ControlledModal and
the existing manager: origin when a trigger exists, rise fallback and its normal
reverse exit/backdrop/focus/stack behavior. The family's optional local modal host
is used only when the application has not already supplied one.

The app remains the only theme owner. No theme switch, theme storage key,
dark-mode state, global blog store or automatic telemetry is installed.

## Related Guides And Next Steps

- [Layouts](./layouts.md) owns layout prop defaults and controlled state.
- [Typography](../../../design-system/typography.md) owns the shared text roles.
- [Design tokens](../../../design-system/tokens.md) owns platform/public lane boundaries.
