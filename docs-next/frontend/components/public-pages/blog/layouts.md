---
id: zero.frontend.components.blog.layouts
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

# Blog Layouts And Defaults

[Blog UI index](./index.md) · [Documentation index](../../../../index.md)

`BlogListPage` defaults to Magazine. `BlogPostPage` defaults to `with-sidebar`,
matching the original `/demo/post` composition. Set a variant only for an
alternative; do not configure those defaults again in every consuming app.

## Listing Pages

`BlogListPageProps` requires `posts: readonly BlogPost[]`. Additional inputs:

| Input | Default and behavior |
| --- | --- |
| title / description | Our blog / omitted. Description is not fabricated. |
| variant | magazine; alternatives sidebar, list and minimal. |
| recentPosts / showRecentHero | First three input posts / true. Hidden during filtering and in minimal mode. |
| categories | Empty; category controls appear only when supplied. |
| columns | 3; accepts 2, 3 or 4, collapsing responsively. List mode uses horizontal rows. |
| baseUrl | Provider default, otherwise /blog. Explicit post hrefs or provider postHref take precedence. |
| search | palette; inline selects the shared input, dropdown selects rich anchored results, false removes search. |
| searchProps | BlogSearchPalette callbacks, supplied authors/tags, trigger and palette options. |
| searchResultProps | SearchWithResults options when search='dropdown'; caller selection/query/source options. |
| filterMode | local; filters and pages the supplied array. manual displays exactly supplied rows and makes no request. |
| filters | Optional controlled search/category/author/tag state. Category, author and tag values match IDs. Omitted state stays instance-local; manual mode leaves filtering to the caller. |
| pagination | Optional controlled page counts. Omitted counts derive from local data. |
| pageSize | 9; finite values clamp to 1–100 in local mode. |
| onSearchChange / onCategoryChange / onPageChange | Optional intent callbacks, not persistence or a query transport. |
| isLoading | false; shows an accessible loading state instead of the grid. |
| empty | Optional React node replacing the grid's default empty presentation. |
| headerActions / sidebar / children | Optional application-owned presentation slots. No theme switch is inserted. |
| className | Additional outer layout classes. |

For already paginated server results, use `filterMode="manual"` and provide the
authoritative pagination/filter state. Otherwise the browser cannot know counts
outside the supplied array. Changing external data does not replace a global
store or automatically rerun a server query.

`BlogListPageSidebar`, `BlogListPageList` and `BlogListPageMinimal` are convenient
variant wrappers over that same prop contract.

## Article Pages

`BlogPostPageProps` requires `post`. `content` accepts trusted React nodes; when
omitted, `post.blocks` renders through BlockRenderer. The article body is not
treated as raw HTML or automatically parsed Markdown.

| Input | Default and behavior |
| --- | --- |
| variant | with-sidebar; alternatives default, wide and split. |
| heroStyle | contained image with title/meta overlaid at the bottom. fullwidth widens it; editorial puts the heading above the image. Split uses its two-column hero. |
| heroProps | Optional height, showGradient and showShare overrides; inherited hero defaults otherwise. |
| tocItems | Explicit items, then post.toc, then block headings when rendering blocks. |
| showHero / showToc / showAuthor / showRelated | true; each section still requires its relevant data. |
| shareUrl | Omitted; no sharing section or floating copy control appears without a URL. |
| showFloatingShare | true when a share URL exists; hidden on narrow screens. |
| relatedPosts / recentPosts | Empty; related wins when populated, otherwise recent is a fallback. |
| relatedPlacement | content (inside the reading column); wide opts into full-width related content. |
| baseUrl | Related-post link prefix, subject to provider/post overrides. |
| headerActions / sidebar / newsletter / footer | Application-owned nodes; absent slots create no placeholder feature. |
| className | Additional outer classes. |

The desktop reading column stays centered with TOC alongside it. On smaller
screens the sidebar becomes an inline collapsible TOC. The TOC uses Zero's
ScrollArea for genuine overflow, native anchor links and a magnetic active
highlight. It does not install a second page scroll controller.

When arbitrary React `content` has no supplied TOC, the browser indexes its
rendered h2–h6 headings after hydration. Existing IDs are preserved; headings
without IDs get instance-local anchors. Pass `tocItems` when those links must
already exist in server HTML. Block-based headings provide their TOC on the
server without additional configuration.

`BlogPostPageWithSidebar`, `BlogPostPageWide` and `BlogPostPageSplit` select the
corresponding variant. None chooses an app route or fetches a post.

## Heroes And Cards

BlogHero accepts title, excerpt, image/alt, author, publication date, reading
time, categories and shareUrl. Its default is contained; BlogHeroCompact and
BlogHeroContained are explicit wrappers. Variants are contained, fullwidth,
compact, split and editorial. height defaults lg (sm/md/full available),
showGradient/showShare default true. Image-backed contained/fullwidth variants
overlay text on a tokenized scrim; editorial preserves the above-image option.
Missing media yields a compact hero.
Invalid dates are omitted rather than throwing or inventing a publication date.

BlogCard accepts post, default/featured/compact/horizontal/editorial variant,
baseUrl, showCategory/showReadingTime/showAuthor, onCategoryClick, onClick and
className. BlogCardGrid adds posts, 2/3/4 columns and emptyMessage.
RecentPostsHero uses up to three articles in the asymmetrical Magazine layout;
one article is centered and two use equal editorial cards. maxCategories
defaults 2; showEmptyState defaults true with an optional empty node.
RelatedPosts accepts an article list, title and baseUrl. Empty hero/related lists
do not invent articles.

## Related Guides And Next Steps

- [Parts and media](./parts.md) owns the reusable controls within these layouts.
- [Configuration](./configuration.md) owns token and routing adaptation.
