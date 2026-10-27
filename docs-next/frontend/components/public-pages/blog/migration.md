---
id: zero.frontend.components.blog.migration
type: reference
audience: [developer, agent]
owner: frontend-components
status: in-review
visibility: internal
system: frontend-components
feature: blog-ui
maturity: supported
applies_to: ["2.6.0 source/local builds containing c9c5fb9; older 2.6.0 archives differ"]
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

# Recovered Blog UI Migration Inventory

[Blog UI index](./index.md) · [Documentation index](../../../../index.md)

This inventory covers every runtime export in the recovered blog package, not
just its default pages. It is a Zero-native adaptation: use the supported
imports below rather than copying Next.js imports or archived stores into an app.

The retained source is the recovered `packages/blog-components` folder from
`code-backup-7-28-26.zip`. Neither that source nor its separate demo was rewritten.
All new editorial owners live in `src/components/blog/`; the generic command
palette lives in `src/components/command-palette/`. Both have focused public
package exports. Physical source paths are implementation locations, not app imports.

## Presentation And Layouts

| Recovered export | Zero destination |
| --- | --- |
| Typography, Prose | Same names in `@zero/framework/blog`, composing Zero Heading/Text and scoped prose. |
| typographyVariants | Replaced by Typography variant/color/balance/lineClamp props and shared text recipes; no duplicate archived CVA theme. |
| BlogCard, BlogCardGrid | Same names; tokenized card variants and configurable grid/empty slot. |
| BlogHero, BlogHeroCompact, BlogHeroContained | Same names; contained image/title-overlay is the default, editorial above-image is optional. |
| RecentPostsHero, RelatedPosts | Same names; one, two and three-post compositions, optional empty presentation. |
| BlogListPage, BlogListPageMinimal, BlogListPageSidebar, BlogListPageList | Same names. Magazine is the no-configuration default. |
| BlogPostPage, BlogPostPageWide, BlogPostPageWithSidebar, BlogPostPageSplit | Same names. Centered reading column/right TOC is the default. |
| AuthorCard, AuthorCardInline, AuthorCardFeatured | Same names, optional bio/social/actions. |
| AuthorAvatar, AuthorAvatarGroup | Same names, Zero avatar fallback and configurable preview. |
| AuthorTooltip, CategoryTooltip | Same names; rich **interactive Popover**, not interactive content in an ARIA tooltip. |
| CategoryFilter, CategoryBadges | Same names; magnetic filtering and optional rich category overflow. |
| EmptyBlogHero, EmptySearchResults, EmptyCategoryResults, EmptyState | Same names; real caller-owned actions and configurable copy. |
| Pagination | BlogPagination; composes the shared Pagination editorial variant. Existing platform pagination defaults stay unchanged. |
| TableOfContents, TableOfContentsSidebar, TableOfContentsFloating | Same names; real headings/native anchors, magnetic highlight and bounded ScrollArea. |
| SocialShare | Same name; requires a real URL, optional platforms/copy, no automatic share or invented success. |
| ReadingProgressBar, ReadingProgressCircle | Same names; real document/article/viewport progress. Optional ReadingProgressProvider shares one observer. |
| SpotlightBorder | Same name; tokenized pointer border, no animation loop or event interception. |

## Search And Local State

| Recovered export | Zero destination |
| --- | --- |
| SearchBar | Same name; shared input. |
| SearchWithResults, SearchBarWithDropdown | Same names; inline combobox/Popover with optional result preview, local or manual source mode. |
| CommandPaletteProvider, CommandPaletteTrigger, useCommandPalette | Same names in the general `@zero/framework/components/command-palette` family, also re-exported by blog. Scoped state, no singleton. |
| CommandPaletteConnected | BlogSearchPalette with explicit posts/authors/categories/tags and awaited selection callbacks. |
| CommandPaletteTriggerConnected | Default BlogSearchPalette trigger or scoped CommandPaletteTrigger; no connected global store. |
| BlogProvider | Same name, presentation-only scope for URLs/link adapter/locale/tokens. |
| useBlogData | Not ported as a fake backend. Supply authorized records through props; future publishing data contracts remain separate. |

The command palette is reusable for app commands without importing blog data.
Use its Provider when several triggers/controllers share one opening. Inline
search does not register a global keyboard shortcut. See [search and previews](./images-and-previews.md).

## Content And Media

| Recovered export | Zero destination |
| --- | --- |
| ContentImage, ContentImageFull, ContentImageFloatLeft, ContentImageFloatRight | Same names, safe sources, optional expansion/aspect treatment. |
| ImageGallery, ImageCarousel, ImageStack | Same names, local selected image and retained managed gallery opening. |
| LightboxProvider, LightboxContext, useLightbox | Same names; scoped registration/controller, no shared archived store. |
| LightboxConnected | BlogImageLightbox, controlled opening/image(s)/index/origin/options. |
| LightboxImageTrigger, LightboxGalleryTrigger | Same names; work standalone or with a provider. |
| CodeBlock | Shared Zero CodeBlock, re-exported by blog. |
| CodeBlockGroup, InlineCode | Shared CodeBlockFiles and CodeBlockInline. |
| CODE_THEMES, THEME_PAIRS, getThemesByMode, getThemesByCategory | Replaced by shared CodeBlockTheme/tokens and the existing code-block configuration. No second theme registry or automatic light/dark owner. |
| VideoPlayer, VideoPlayerDefault | Same names; one native element/controller, configurable default or composed controls. |
| VideoPlayerContent, VideoPlayerControlBar | Same names; compositional layout parts. |
| VideoPlayerPlayButton, VideoPlayerSeekBackwardButton, VideoPlayerSeekForwardButton | Same names; same native controller. |
| VideoPlayerTimeRange, VideoPlayerTimeDisplay, VideoPlayerMuteButton, VideoPlayerVolumeRange, VideoPlayerFullscreenButton | Same names; native measured state, explicit fullscreen intent. |
| AudioPlayer, AudioPlayerMinimal, AudioPlayerSynthwave | Same names; shared controller and semantic-token variants. |
| AudioPlayerPlayButton, AudioPlayerSkipBackwardButton, AudioPlayerSkipForwardButton | Same names; configurable skip seconds. |
| AudioPlayerMuteButton, AudioPlayerLoopButton, AudioPlayerVolumeSlider, AudioPlayerTimeDisplay | Same names; native measured state. |
| AudioPlayerWaveform, AudioPlayerProgress | Same names; caller-supplied measured peaks, real seekable timeline. |
| InlineLink, InlineLinkPreview, DemoLink | Same names; safe links, caller-provided preview metadata and native disclosure. |
| CitationProvider, CitationRef, CitationsList, Glimpse | Same names; local reference state and shared Popover. |
| BlockRenderer | Same name; typed escaped UI blocks, not an editor or storage migration. |

See [media](./media.md), [images/previews](./images-and-previews.md),
[typed content blocks](./content-blocks.md) and the existing
[code-block guide](../code-block.md) for exact contracts.

## Optional Integrations And Intentional Exclusions

| Recovered export/behavior | Zero decision |
| --- | --- |
| NewsletterSignup, NewsletterSignupCompact | Same names; render only with onSubscribe. Await accepted action; failures remain retryable. |
| NewsletterModalConnected | NewsletterModal with explicit controlled state/onSubscribe, managed busy/accept lifecycle. |
| NewsletterTrigger | Same name; opens the same managed newsletter composition. |
| ToastContainer | Existing Zero Toaster/Sonner; do not mount a second archived notification owner. |
| AnimatedThemeToggle, FloatingThemeToggle, THEME_TOGGLE_CSS | Deliberately excluded per request. The app owns theme switching. |
| Fingerprinting, screenshot proxy, global tracking/store persistence | Deliberately excluded; not necessary for blog presentation. |

No database tables, author-profile extension, CMS, Gutenberg-style editor,
publisher, newsletter delivery, analytics or automatic SEO activation are hidden
inside this migration. These are not missing UI components; they are the
[separately planned next phase](./roadmap.md).

## Adopting In An App

1. Use the selected committed-main archive/commit described by the [release qualification](../../../../backend/blog/qualification.md),
   not a guessed version number. Work on an app feature branch.
2. Import the normal Zero styles and `@zero/framework/blog`. Start with
   BlogListPage/BlogPostPage and caller-supplied data.
3. Wrap in BlogProvider for custom URLs/router links/locale/scoped tokens.
   Keep native anchors unless the app supplies its supported link adapter.
4. Add optional identity/share/newsletter data only when the app owns those
   integrations. Existing public-site brand tokens are not overwritten.
5. Replace recovered code/media/search/store wrappers using this inventory.
   Keep a single ModalManager/theme/notification owner.
6. Verify desktop/mobile/dark/reduced motion, real media, callback failures,
   navigation, focus return and source retirement in the consuming app.

Feature-branch qualification is not a main release selection or a live-app
upgrade. The original recovered components remain available for comparison.

## Related Guides And Next Steps

- [Layouts](./layouts.md) owns the default page compositions and slots.
- [Configuration](./configuration.md) owns tokens/routing/motion.
- [Roadmap](./roadmap.md) owns the deferred backend discussion.
