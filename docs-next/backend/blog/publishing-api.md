---
id: zero.blog.publishing-api
type: reference
audience: [developer, agent, operator]
owner: blog
status: draft
visibility: internal
system: blog
feature: publishing
maturity: experimental
applies_to: ["feature/blog-publishing-backend working implementation; not a selected release"]
---

# Publishing Backend And Facades

[Blog index](./index.md) · [Implementation checkpoint](../../_work/blog-publishing-implementation.md)

This guide describes implemented feature-branch APIs. The earlier qualified
author-only archive does not contain them. Public pages/editor have real-browser
checks; final installed Linux qualification remains in progress. Do not select this working
tree as a production update.

## Ownership And Enablement

`blog: true` enables existing Guardian authors and the private publishing plane.
One application-owned Fabric database is the default in both tenancy modes.
Organization administrators do not inherit authority over the platform blog.
`blog.scope: 'organization'` explicitly retains organization-scoped authors and
sites within that same managed content file. Application-owned multi-tenant
management requirements cannot use customer-organization roles/permissions.

```ts
blog: {
  siteName: 'Journal',
  basePath: '/blog',
  pages: true, // false for headless/custom app-owned routes
  scope: 'application',
  manageAuthors: 'admin',
  authors: { requireAvatar: true, requireBio: false },
  posts: { manage: 'admin' },
  content: {
    rootDirectory: 'data/zero.blog',
    media: { maxUploadBytes: 256 * 1024 * 1024, maxImagePixels: 16_000_000 },
    metrics: { enabled: false, retentionDays: 90 },
  },
},
```

`content: false` retains author/profile-only operation with a stable disabled
publishing facade and no content workers or files. Blog-off installs no content
plane. Configuration never changes an existing account role, registration mode,
tenancy, trusted properties or public-theme tokens.

The private root cannot overlap app/SYSTEM databases, another Fabric root,
logging, Storage, generated assets or route sources, including filesystem aliases.
Missing retained content or a changed ownership root fails closed: restore the
original state instead of accepting an automatically created empty replacement.
Small ownership, namespace, lease and metrics-signing metadata use additive
SYSTEM migration 048. Articles and analytics never live in SYSTEM.

## Request And Browser APIs

Use `zero.blog` inside a Zero endpoint and `client.blog` in authenticated browser
code. Publishing operations are asynchronous in both. Author profile operations
retain their existing synchronous server contract. No operation accepts an actor,
tenant, database selector, SQL fragment or Storage path.

| Facade | Methods |
| --- | --- |
| `posts` | `capabilities`, `list`, `get`, `create`, `update`, `publish`, `withdraw`, `trash`, `revisions`, `restore` |
| `taxonomies` | `list`, `create`, `update`, `remove` for categories and tags |
| `media` | `list`, `get`, `allocate`, `upload`, `remove`; browser imagePreview uses bounded authenticated bytes |
| `metrics` | `capabilities`, `page`; observations use a separate deliberately public signed-ticket contract |
| Browser `watchPosts` | Authorized, coalesced current-query projections; no raw private row feed |
| Browser `watchPost` / `watchMetrics` | Exact-record revisions and daily aggregates with the same current-authority lifecycle |

Every mutation needs `{ requestId, signal? }`; reuse its exact identity and intent
when reconciling an interrupted operation. The native transport sends it as
`Idempotency-Key`. A new identity is new work, not a retry. Updates, state changes
and restores additionally compare the expected post revision. A conflict must be
reviewed; no automatic last-write-wins merge occurs. Unknown outcomes are returned
as unknown and never relabeled as an uncommitted failure.

```ts
const draft = await client.blog.posts.create(content, {
  requestId: crypto.randomUUID(),
});
const published = await client.blog.posts.publish(draft.id, draft.revision, {
  requestId: crypto.randomUUID(),
});
const stop = client.blog.watchPosts(page => setPosts(page.items), {
  query: { limit: 20, search: 'orchid' },
  onError: showCurrentError,
});
// Call stop() on view retirement. SDK identity/scope replacement also retires it.
```

An active author edits their own created posts; a permitted post manager can
manage others. Publishing requires an eligible explicitly published author
profile. An optional `posts.publish` Guardian requirement restricts publication
further. Native clients need explicitly registered/consented `blog:read`, then
`blog:write`, then `blog:publish`; these do not replace Guardian permissions and
are not added to default native consent. `profile:write` alone cannot publish.

## Documents, Publication And History

`BlogPostContent` contains title, slug, excerpt, opaque author ID, version-1
document, optional featured image, category/tag IDs and ordinary SEO overrides.
The document admits typed paragraph/heading/list/quote/callout/code/image/gallery/
audio/video/embed/divider blocks, stable block IDs and escaped inline marks/links.
Raw HTML, executable URLs, unknown fields/versions, getters, proxies and
oversized structures are rejected. This is not Gutenberg JSON compatibility.

Image placements each require descriptive `alt`, or `decorative: true` with empty
alt. A reusable asset cannot supply a universal accessible description for every
placement. Media and taxonomy references are revalidated in the same actor commit
as the draft/publication; invalid references roll back slugs, history and indexes.

Draft and public snapshots are separate. Editing does not change the live
article. Explicit publication accepts the entire current draft and increments
the independent public revision. Withdrawal removes anonymous reads, search and
public media-reference admission. Trash requires withdrawal first. Restore creates
a new draft revision; it does not publish it or erase history.

Revision history is append-only and paginated under byte/node limits. A page can
contain fewer than the requested count; advance by the actual returned items,
not an assumed fixed count. Retained previously published slugs redirect only
while the same article remains published. Never redirect to a browser-supplied URL.

The public article retains the **approved public name at publication**, not the
private account name. Withdrawing/deleting a profile does not silently rewrite
an old article's historical byline or delete the article. Live profile cards,
social links and photos must still resolve through current public-profile
admission; do not freeze an old account photo into article metadata.

## Media Library

```ts
const allocated = await client.blog.media.allocate({
  kind: 'image', fileName: file.name, mimeType: file.type,
}, { requestId: crypto.randomUUID() });
const asset = await client.blog.media.upload(allocated.id, file, {
  requestId: crypto.randomUUID(), signal,
});
// Place { mediaId: asset.id, alt: 'Meaningful description' } in the document.
```

Uploads use the existing authenticated SDK, canonical private Storage and a
server-owned allocation. No second auth client or browser-selected drive is
needed. The first immutable upload wins; an interrupted allocation can be
reconciled without overwriting bytes already accepted for that identity.

PNG/JPEG/WebP images are decoded under pixel/byte limits, orientation-normalized
and re-encoded as WebP without copying source metadata. Raster source bytes are
additionally capped at 20 MiB. Decoder admission defaults to two running and eight
queued jobs, with bounded queue/native processing deadlines; queued jobs do not
read/buffer their staged bytes before admission. Closed audio/video MIME types use canonical Storage
byte admission and immutable references; this is not a malware-scanning service
or a promise to transcode every codec. SVG/HTML are not accepted upload types.

Per-asset SYSTEM leases fence final Storage publication without holding SQLite
or auth-exclusive locks during I/O. Referenced assets cannot be removed. Failed
or interrupted cleanup retains its state for bounded retry/restart recovery.
An expired allocation is not an accepted public asset. The original temporary
file can be removed without deleting its referenced normalized image.

Preview paths are authenticated. Anonymous media delivery requires the exact
current published article reference; it supports one byte range, `nosniff` and
no-store responses. Withdrawal prevents subsequent delivery requests. Bytes
already released to a visitor or an authorized in-flight public stream cannot
be recalled; do not advertise retroactive erasure of public downloads.

## Search And Observations

Separate SQLite FTS5 indexes cover draft and published title/excerpt/body with
weighted relevance, ordinary-token prefix matching and category/tag/author
filters. Trigger maintenance shares the actual content commit. Public search
never queries drafts; clients cannot inject FTS operators or SQL sort clauses.

Metrics is disabled by default. When enabled, `metricTicket(site, slug)` and
`observe(site, slug, ticket, observation)` on `createPublicBlogClient(origin)`
admit one view and one bounded engagement observation per five-minute signed
ticket. Replaying the same observation does not increment it again. A modified
ticket, conflicting replay, excessive duration, missing publication or expired
ticket is rejected. Current per-process ceilings are 2000 issued tickets and
5000 observation requests per minute, independent of normal article reads.

These are **browser observations**, not unique people, bot detection, verified
attention or compliance evidence. No IP, fingerprint, account ID, raw URL,
document text or prompt enters the aggregate schema. Short replay receipts expire
after ticket validity. Bounded cleanup executes on new observations; an idle
database can retain expired physical rows until subsequent maintenance/ingestion.
This is not a wall-clock secure-erasure guarantee.
Authors can read their own post aggregates; post managers can read the site's.
Metrics does not publish a public analytics dashboard or capture session replay.
The managed reader records a view and, after roughly thirty foreground seconds,
one bounded engagement observation only when metrics is enabled. The private
workspace provides daily counts under current author/manager permissions.

## Audit And Deployment Boundaries

Configured core Logging uses the blog actor's durable transactional record source;
publishing mutations carry the verified user/session attribution. Generic record
events are not semantic-read or human-attention evidence. Required admission is
checked at private request and final release/commit boundaries, with recovery
paths preserved. Public route classification is selected-handler-local, never an
exemption based on a URL prefix supplied by the caller.

The normal server build preserves canonical content migration/schema identity
between bundled parents and matching retained source actors. Explicit actor
launch uses `runBlogActorIfRequested()` before app startup and an empty child
environment unless narrowly configured otherwise. Workers must never boot the
main application or inherit dotenv/provider secrets. Source tests do not qualify
an installed Linux image: use the final release evidence before deployment.
