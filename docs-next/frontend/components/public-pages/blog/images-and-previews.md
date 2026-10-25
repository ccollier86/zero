---
id: zero.frontend.components.blog.images-and-previews
type: reference
audience: [developer, agent]
owner: frontend-components
status: in-review
visibility: internal
system: frontend-components
feature: blog-ui
maturity: preview
applies_to: ["2.6.0 UI feature snapshot; not the selected main archive"]
modes: [browser, SSR, public-pages]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "ac857766bc10c8a0643622bf95bb541159592c31"
  snapshot: dirty
  date: "2026-10-25"
  evidence_level: source-observed
---

# Blog Images Search And Rich Previews

[Blog UI index](./index.md) · [Documentation index](../../../../index.md)

These smaller parts compose the existing Zero Popover, Command, ScrollArea and
ModalManager. They do not create a second portal, scroll lock, theme switcher,
search transport or archived singleton store.

## Images And Managed Galleries

ContentImage defaults to full width, lazy loading, natural aspect and expandable.
Its full/float-left/float-right variants and wrappers share the same implementation.
aspectRatio accepts auto, square, video, 4/3 or 3/2; ExpandableImage defaults to
video. Safe src and alt are required; caption, dimensions and className are optional.

ImageGallery accepts images, columns 2/3/4 (2 default), layout grid/stack and
lightbox options. ImageStack selects stack. ImageCarousel adds previous/next
controls, optional label and announced position. Changing images while its
lightbox is open retains the same managed modal, not a fresh opening per image.

```tsx
import { ImageGallery } from '@zero/framework/blog';

<ImageGallery
  images={[
    { src: '/photos/one.jpg', alt: 'Studio', caption: 'Inside the studio' },
    { src: '/photos/two.jpg', alt: 'Materials' },
  ]}
  lightbox={{
    zoom: { min: 1, max: 4, step: .5 },
    lens: { shape: 'circle', magnification: 2 },
    showThumbnails: true,
    download: false,
  }}
/>;
```

| Lightbox option | Default and behavior |
| --- | --- |
| zoom | Enabled, min1/max3/step.5/defaultZoom1. false or enabled:false removes controls. Finite geometry bounds: min .5–2, max min–8, step .1–2; defaults/changes clamp accordingly. |
| lens | Enabled control, initially inactive. false or enabled:false removes it; defaultActive opts in. Shape circle/square, size token default160px bounded60–400, magnification token default2 bounded1.1–6. |
| loop | false; previous/next edges disable. |
| showThumbnails / maxThumbnails | true / 40, finite count bounded1–100. Large galleries show a window near the active image. |
| download | false; explicit safe image link when enabled. Cross-origin download behavior depends on browser/server headers. |
| size / motion / className | xl / shared manager recipe / optional frame classes. |

The image lives in a real both-axis ScrollArea. Zoom enables mouse drag panning;
touch retains native viewport panning. +/-/0 control zoom, L toggles the lens and
left/right change images. Form fields keep their keys. Escape belongs to the
manager; focus returns to the original trigger. Lens positioning uses actual
image geometry and never intercepts pointer actions.

Standalone images need no provider. LightboxProvider optionally accepts
registered images, default options and onImageChange(image,index).
useLightbox exposes open/image/activeIndex, openImage, openGallery and close.
openImage/openGallery accept the actual trigger element and local options.
Unsafe registered sources are omitted; callbacks index the admitted image list.

LightboxImageTrigger and LightboxGalleryTrigger accept native Zero Button props,
image or images, lightbox options and optional initialIndex for galleries.
They work with a scoped provider or their own controlled manager adapter.
BlogImageLightbox exposes explicit open/onOpenChange, image or images,
activeIndex/onIndexChange, trigger and the same options.

## Rich Author And Category Previews

AuthorTooltip shows provided author/role/bio, valid social links and optional
postCount/View all posts. showBio/showSocial default true. CategoryTooltip accepts
categories, optional title/count and onCategoryClick; descriptions/counts/links
are shown only when supplied. Category choices use Zero's magnetic highlight.

Despite the recovered names these are **interactive Popovers**, not ARIA tooltips.
Their shared options are children (one suitable focusable trigger), controlled
open/onOpenChange or defaultOpen, side top, align center, openDelay180ms,
closeDelay140ms, tiltfalse and className. Hover previews close on leave; click/touch
pins until dismissal. Keyboard focus opens without reopening after Escape/focus
restoration. Optional inner-plane tilt leaves the outer positioning/motion owner
untouched and is removed under reduced motion.

AuthorAvatar's showTooltip enables the rich preview; tooltip='simple' opts into
the existing Grow tooltip. tooltipOptions configures rich behavior.
CategoryBadges uses rich overflow by default, with tooltip='simple' or 'none'
alternatives. No fake social links, avatars or counts are generated.

## Inline Search

SearchWithResults (also SearchBarWithDropdown) uses a shared combobox plus
anchored Popover. Input focus is retained, arrow/Enter selection stays in cmdk,
and Escape dismisses its own dropdown. It supports:

- posts, optional baseUrl, label/placeholder and sm/default/lg size;
- controlled query/onQueryChange or defaultQuery, controlled open/onOpenChange
  or defaultOpen;
- filterMode local (default) or manual for caller-retrieved records;
- maxResults6 (finite1–100), match all (default) or any, showPreviewtrue;
- loading, empty, className, awaited onSelect(post,{signal}) and onError.

Local matching ranks title/excerpt/categories/tags, limits query matching to256
characters, preserves stable ties and never modifies the source.
Manual mode does not start requests. The preview panel hides on narrow screens.

Selection is duplicate-guarded. false retains the opening; a rejection displays
a generic retryable message, not exception contents. Query/data/opening retirement
aborts stale selection signals. Without onSelect, post selection follows its
safe configured href. This is UI cancellation, not a server transaction guarantee.

BlogListPage search='dropdown' selects this composition via searchResultProps.
The default modal BlogSearchPalette remains available and adapts posts/authors/
tags/categories into the [general CommandPalette](../../controls/command-palette.md).

## Reading And Spotlight

ReadingProgressBar/Circle use real document scroll by default. Provide an article
target and optional native scroll container for article-relative progress.
ReadingProgressProvider shares one measurement between indicators;
useReadingProgress returns progress (0–100) and scrollable.
Explicit value opts out of measurement. hideWhenUnscrollable defaults true,
bar position defaults top (bottom/inline available), bar showPercentagefalse,
circle showPercentagetrue. Both accept label/className/style.

Measurements use passive listeners, ResizeObserver and one scheduled frame per
event burst. Cleanup removes them. They do not track telemetry, prevent wheel
events, animate invented progress or add a second scrolling controller.

SpotlightBorder accepts normal div props plus enabledtrue, radius100, color,
borderRadius and containerClassName. Its masked pointer-transparent border
uses scoped semantic tokens. No idle loop runs; reduced motion uses a static
highlight. It never blocks nested links/buttons.

## Newsletter Opening

NewsletterModal adds controlled open/onOpenChange and trigger to NewsletterSignup
props. NewsletterTrigger accepts a newsletter object and normal Zero Button props.
Both disappear without onSubscribe. Pending accepted-action work marks the
managed modal busy; only successful acceptance closes it. Rejection stays safe
and retryable. No service, mailing list, consent policy or persistence is fabricated.

## Related Guides And Next Steps

- [Parts](./parts.md) owns identity, pagination, citations and form details.
- [Media](./media.md) owns audio/video control composition.
- [Migration inventory](./migration.md) maps archived stores and Connected wrappers.
- [Modal manager](../../../modals/index.md) owns overlay focus/stack/dismissal.
