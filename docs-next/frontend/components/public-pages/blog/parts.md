---
id: zero.frontend.components.blog.parts
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
  commit: "68ed0ba811437375dac340474e972952d7c88ab7"
  snapshot: clean
  date: "2026-10-25"
  evidence_level: package-qualified
  artifact:
    version: "2.6.0"
    commit: "68ed0ba811437375dac340474e972952d7c88ab7"
    sha256: "0457000e8d564f7fa838a5be9963827b1f6c0c0eda93845899cb5be598d415b9"
---

# Blog Parts And Media

[Blog UI index](./index.md) · [Documentation index](../../../../index.md)

The focused `@zero/framework/blog` export supplies these parts without choosing
a backend or global data store. Use BlogProvider around a standalone composition
to inherit scoped presentation defaults. Layouts are compositions of this family,
not a second implementation with private parallel controls.

## Text And Identity

Typography supports h1–h6, p, lead, small, caption and label variants, optional
primary/secondary/tertiary color, balance and lineClamp. It composes Zero's
Heading/Text consumers. Prose supplies the long-form reading scope with default
or lg size; the default is lg. CodeBlock, CodeBlockFiles and CodeBlockInline are
the existing [Zero code family](../code-block.md), not archived highlighter copies.

AuthorAvatar accepts author, xs/sm/default/lg size, showTooltip and className.
AuthorAvatarGroup accepts authors and maximum count. Avatars use Zero's avatar
fallback; rich preview is the default when showTooltip is enabled. tooltip='simple'
keeps the shared Grow tooltip; tooltipOptions configures the interactive preview.
Absence of an image does not create a broken URL.
BlogPostMeta shows only provided author/date/reading-time values.

AuthorCard accepts author, showSocial/showBio (true), postsLink, className and
default/inline/featured variant. AuthorCardInline/Featured are wrappers.
BlogAuthor requires only id/name. Avatar, role, bio, href, legacy named social
links and generic `{id,label,href,icon?}` socialLinks are optional. Missing social
links remove that navigation, and no contact/email field is inferred from a user.

CategoryBadges accepts categories, maxVisible (2), onCategoryClick and className;
overflow uses rich CategoryTooltip by default (tooltip='simple'/'none' available).
Rich preview controls use Popover semantics. Categories have id/name/slug, optional
description/count/href and a semantic tone. EmptyState accepts title,
description/action/className. EmptySearchResults accepts query and onClear.

## Search And Pagination

BlogSearchPalette accepts posts, optional authors/categories/tags/baseUrl and the
[general CommandPalette](../../controls/command-palette.md) options. It projects
rich results into Posts, Authors (`@`), Tags (`#`) and Categories (`/`) groups.
Only supplied optional groups appear. Callbacks are onSelectPost/Author/Tag/
Category, each receiving the record and `{signal}`. Async results are awaited;
false keeps the opening, rejection leaves a safe retry state. Post selection
falls back to the configured post href; other records
use their explicit href or remain open when no action is available. No data is
fetched and there is no history persistence or fake recent-search list.

SearchBar is the shared Zero input with value/onChange, optional loading state
and native input props. CategoryFilter accepts categories, selectedCategory,
onCategoryChange and allLabel. Omitted selection is local; supplied selection is
controlled. Both filtering and pagination callbacks report intent only.
SearchWithResults/SearchBarWithDropdown adds an optional inline dropdown with
preview, weighted local/manual matching and awaited selection. Its full contract
is in [images, search and previews](./images-and-previews.md#inline-search).

BlogPagination accepts currentPage/totalPages, optional totalItems/itemsPerPage,
onPageChange, hrefForPage, showPageInfo (true) and className. It reuses the shared
Pagination family with `variant="editorial"`; the ordinary Pagination default
is unchanged. Page windows are bounded, disabled edges are inert and modifier
clicks retain native anchor behavior. Provide hrefForPage to preserve app filters
or use custom route shapes. Without a callback, links navigate normally.

TableOfContents accepts items, title, collapsible/defaultCollapsed,
showNumbers, className, contentRoot and onItemClick. TableOfContentsSidebar is
its sticky variant. Item IDs address real content headings; levels affect
indentation, not authorization or a route. TOC items are presentation input,
not a source of executable selectors.
TableOfContentsFloating uses that same owner with left/right placement.

## Images And Galleries

ContentImage accepts src/alt, caption, width/height, full/float-left/float-right
variant, expandable (true), loading (lazy) and className. Full/FloatLeft/
FloatRight convenience wrappers and ExpandableImage use that same implementation.
Expansion uses the existing modal manager and restores focus to the image trigger.
BlogImageLightbox exposes controlled open/image(s)/activeIndex/trigger/onOpenChange,
retained gallery navigation, optional zoom/lens/thumbnails/download and manager options.

ImageGallery accepts images, 2/3/4 columns, grid/stack layout and className.
ImageStack selects stack. ImageCarousel accepts images, label and className;
its previous/next controls and announced position describe real caller images.
LightboxProvider shares an instance-local image opening across a composition;
standalone ContentImage works without a required provider. Nothing loads a
shared archived singleton or modifies document.body overflow itself.
See [images and previews](./images-and-previews.md) for all defaults and triggers.

## Audio And Video

AudioPlayer and VideoPlayer accept BlogMediaPlayerProps: src, title, artist,
poster, coverArt, peaks, loop, className and onPlay/onPause/onError callbacks.
Sources are HTTP(S) or root-relative media files; arbitrary iframe/YouTube/Vimeo
embedding is not silently inferred. Applications can supply their own deliberate
embed node through the article content slot.

Zero buttons/ranges control the real media element, with seek/time, mute,
volume, loop and video fullscreen. Playback requires intent; preload is none.
Waveforms use supplied normalized peaks, at most 256 drawn bars, not generated
random values or an invented audio analysis. Native controls remain the
no-JavaScript fallback. Playback failures are displayed without exposing the URL
or exception contents.
Every recovered audio/video control part is available for explicit composition;
see [composable media](./media.md) for exact options, controller lifecycle and examples.

## Links Citations And Optional Forms

InlineLink uses safe links and an external indicator. InlineLinkPreview accepts
href, children, title/description/image and opens a shared Popover; metadata is
provided, never scraped. Glimpse accepts term/definition/children for an
interactive explanatory popover. DemoLink accepts label/children for inline
native disclosure. None contacts the archive's screenshot service.

CitationProvider accepts an explicit citations list. CitationRef uses an entry
id; CitationsList renders the matching ordered references with instance-local
anchors. Missing references render nothing. SocialShare accepts url/title,
platforms (X, LinkedIn, Facebook and email), showCopyLink (true), className and
onCopyError. An absolute share URL is required. Copy only reports success after
the clipboard promise resolves; share links act only on a user's selection.

NewsletterSignup accepts title/description/buttonLabel/consent/className,
onSubscribe(email,{signal}) and onError. NewsletterSignupCompact is the same
composition. Without onSubscribe it renders nothing. The callback must resolve
only when the app considers subscription accepted; rejection leaves a safe retry
state. The UI has native email validation and prevents duplicate pending submits,
but it is not a newsletter provider, storage contract or consent policy.
NewsletterModal/NewsletterTrigger reuse the same form inside the shared manager,
holding busy state until accepted success. ReadingProgressBar/Circle and
SpotlightBorder are optional independent parts; see
[images and previews](./images-and-previews.md#reading-and-spotlight).

## Related Guides And Next Steps

- [Content blocks](./content-blocks.md) composes text and media from typed UI data.
- [Configuration](./configuration.md) covers tokens, URLs and shared ownership.
