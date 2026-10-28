---
id: zero.frontend.components.blog.publishing-workspace
type: how-to
audience: [developer, agent, operator]
owner: blog
status: draft
visibility: internal
system: blog
feature: publishing-workspace
maturity: experimental
applies_to: ["2.7.0 source/local package; use the qualified selected commit/archive"]
---

# Managed Reader And Publishing Workspace

[Blog UI index](./index.md) · [Backend configuration](../../../../backend/blog/configuration.md) · [Publishing API](../../../../backend/blog/publishing-api.md)

Use the exact qualified 2.7.0 archive selected by `zero-release --status`, not a
moving source branch. The [combined release record](../../../../_work/combined-blog-messaging-logging-release.md)
distinguishes pending gates and historical evidence from a selected update.
The older author-only preview is not the publishing package.

## Enable The Defaults

Add `blog: true` to the existing Zero configuration. Do not replace the project's
DBs, Guardian policy, app shell, stylesheet or public design tokens. With managed
content and application ownership, Zero declares the `/blog` Magazine and
`/blog/:slug` sidebar-TOC reader through the normal build contribution system.
An existing app-owned route under that prefix is a build error, not something
the feature can overwrite. Choose another `basePath` or `pages: false`.

Run the normal Zero build after enabling pages. Production requires the matching
plugin build manifest and enhancement assets; it does not compile UI at startup.
The reader renders useful HTML and head metadata before hydration. Pagination
and ordinary links work without JavaScript. Category links and a search form
provide a no-JS fallback; the enhanced search palette queries the actual public
FTS index rather than searching only the current twelve cards.

`blog.scope: 'application'` is the default for both tenancy modes. Explicit
organization ownership uses `pages: false` and the public facade/custom page
composition; Zero does not guess an organization from Host or the selected
customer session. Headless mode retains the same publishing API.

## Put Management Inside The Existing App

Create an ordinary protected application page using the app's existing route
policy and shared `AppProvider`/`AppShell`:

```tsx
'use client';
import { BlogWorkspace } from '@zero/framework/blog';

export default function PublishingPage() {
  return <BlogWorkspace />;
}
```

Do not add another AppProvider, auth client, system DB or global modal host.
The workspace uses the existing SDK and authorization boundary. If no modal host
is present, it supplies an owned `ModalManager`; otherwise it joins the current
host. Guardian still enforces every operation server-side. Mounting a component
or hiding an action is not permission admission.

The combined candidate distinguishes first-use from filtered-empty lists and
provides a real Retry when publishing capabilities or live reads fail. Same-scope
read interruption masks the editor and disables save/autosave/publication without
discarding its local draft. Fresh authorized reads restore it; a Guardian identity
or scope replacement still retires the workspace and its drafts immediately.
Ordinary author/directory refresh does not dismiss an open managed profile dialog.
Media and revision history also provide explicit read retry and omit empty paging
controls. No transient failure creates an author, publishes a byline or resets data.

For smaller custom compositions, `BlogPostEditor.accessReady` defaults to true.
Pass false for the enclosing source's same-scope interruption; continue to key
the editor to the immutable `boundaryKey` and unmount it when authority retires.
It is a masking/lifecycle input, never a substitute for server authorization.

The default workspace provides:

- Server-paged articles with full-text search and status filtering, preserving
  the standard DataTable query/motion behavior. Live projections invalidate the
  current query; they do not invent INSERT events from snapshots.
- Enrollment of existing users, public byline drafts, explicit publication,
  withdrawal and suspension without modifying account roles. Default user
  search uses the existing administrator directory permission; custom author
  managers can use a known Guardian user ID without gaining global user-list access.
- Category/tag creation, slugs, descriptions, hierarchy, ordinary SEO metadata
  and conditional removal. Referenced terms cannot be removed.
- Optional daily observation counts using the same authorized live projection.
  Metrics is off unless explicitly enabled; no analytics consent is inferred.

Native account photo upload/publication stays in `UserProfileSettings`. An author
profile opts into that explicitly published photo; no private account photo or
biography is silently copied into a public byline.

## Writing And Saving

The editor assembles stable-ID paragraph, heading, list, quote, callout, code,
image, gallery, audio, video, link-card and divider blocks. The existing Tiptap
engine is restricted to inline text/marks. Selection displays a formatting menu
for bold, italic, underline, strike, inline code and links, with the same controls
also available for keyboard and touch. Only the active block's inline editor is
mounted. Canonical versioned JSON—not HTML or the editor's internal document—is
the API contract. This is not Gutenberg JSON/import compatibility.

Author and taxonomy directories are bounded pages, not a silent first-page or
1,000-record cap. **Load more authors** and **Load more categories and tags**
extend choices without losing a draft. Current selected references remain visible
when outside the loaded page. Taxonomy parent selection uses the same directory,
not only the current management-table page; the server still validates ancestry.

Save is explicit by default. `autoSave={1500}` opts into draft-only debounce;
it never publishes. A newly accepted server revision is the only basis for
Publish/Withdraw/Trash/Restore. Edits made while a save is pending remain dirty.
Equivalent JSON property/mark ordering is not an edit: the accepted save stays
clean after an editor round-trip, including combined links and inline formatting.
Actual changed text, formatting values and ordered blocks/taxonomy choices still
require saving.
Another writer's revision does not overwrite a local draft. The existing
Save/Discard/Stay controller protects router navigation and the native unload
warning protects refresh/tab close.

After a transport failure, the post controller retains the original request ID,
body and expected revision. **Retry original operation** reconciles that exact
intent. A new UUID is not a retry. Other mutations remain blocked until its
outcome is known. A real revision conflict requires review/reload; there is no
silent last-write-wins merge. Author-profile APIs retain their older CAS contract:
after an uncertain profile response, inspect the stored profile before another
action rather than pretending the original write was not committed.

History is immutable and byte/node paginated. Restore creates a new draft and
does not publish it. The private preview uses the same article rendering parts
and authenticated image bytes. Audio/video private preview currently shows
metadata; native playback is available on the accepted public article. A preview
does not create a public route or enter discovery.

## Media And Accessibility

Choose an existing private asset or upload through `client.blog.media`. The
library displays allocation/upload/validation progress and preserves allocation
and upload identities for retry. It never creates another auth client or accepts
a caller-selected Storage path/drive. Raster images are normalized server-side;
audio/video use the declared safe MIME/size contract, not arbitrary HTML/SVG.

Every image placement, including heading, gallery, poster, cover and social image,
has its own alt text or explicit decorative/empty-alt setting. Contextual alt text
does not become a universal asset property. A referenced asset cannot be deleted.
Private image previews use authenticated SDK reads and short-lived object URLs,
with bounded concurrent buffering and viewport-local lifetime. Naked private URLs
are not inserted into img tags. Public media remains bound to a current accepted
article reference, including range requests and withdrawal checks.

## SEO And Discovery

The managed reader takes visible content and metadata from the same accepted
public revision. Normal fallbacks are title, excerpt, heading image and the
approved public author name. The editor exposes SEO title/description, social
image/alt and noindex overrides. Current public profile photos/social data remain
subject to Guardian's live public-profile policy; historical article names never
fall back to private accounts.

Configure the app's trusted `app.publicUrl` for absolute canonical/social URLs
and BlogPosting JSON-LD. The existing app SEO/indexing/sitemap settings remain
authoritative; no second SEO plugin is required. Public query search and combined
filter results are noindex. Single category/tag archives use their stored title,
description and noindex policy. Old post slugs redirect only while the post is
published. Indexable, used category/tag archives also enter discovery; private or
unused taxonomy metadata never does. Withdrawn/noindex articles are removed from the blog's live sitemap
contribution. No draft, clinical text, account email or private Storage grant
belongs in metadata, HTML props or discovery.

## Compose Smaller Pieces

The focused `@zero/framework/blog` entry also exports `BlogPostEditor`,
`BlogPostFields`, `BlogDocumentEditor`, `BlogInlineInput`, `BlogMediaPicker`,
`BlogRichText`, `presentBlogDocument` and `presentPublishedBlogPost`. These retain
separate presentation, editing, transport and persistence responsibilities.

`BlogWorkspace` and `BlogPostEditor` accept `renderSelectionMenu(editor)` for a
replacement toolbar; replacing it does not change the document or API.
`BlogDocumentEditor.renderMediaPicker` permits another authorized picker. The
standalone controlled fields never save implicitly. Use the existing public
layout's props/slots for branding, social links, newsletter or custom page chrome;
absent application integrations must not become placeholder controls.

## Related Guides And Next Steps

- [Layouts](./layouts.md) and [parts](./parts.md) document the recovered presentation defaults.
- [Backend upgrade](../../../../backend/blog/upgrade.md) covers additive migration and retention.
- [Implementation evidence](../../../../_work/blog-publishing-implementation.md) separates source/browser checks from final package/Linux qualification.
