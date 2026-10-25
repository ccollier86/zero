---
id: zero.blog.authors
type: reference
audience: [developer, agent]
owner: blog
status: in-review
visibility: internal
system: blog
feature: author-profiles
maturity: preview
applies_to: ["2.6.0 feature/blog-foundation preview; not the selected main archive"]
modes: [managed-server, single-simple, single-advanced, multi-simple, multi-advanced, native]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "c7011c7dd9dc8561b767752be51029a31ac327cf"
  snapshot: clean
  date: "2026-10-25"
  evidence_level: package-qualified
  artifact:
    version: "2.6.0"
    commit: "c7011c7dd9dc8561b767752be51029a31ac327cf"
    sha256: "98d564817e4b659d7327d1e11f7206e88cf2c9eb4a25b60e251dde294e4e8b25"
---

# Author Enrollment And Public Bylines

[Blog index](./index.md) · [Configuration](./configuration.md) · [Upgrade](./upgrade.md)

## Use The Existing Zero Facades

Authenticated browser code uses `client.blog`. Zero-native endpoint handlers
use `zero.blog` from the request context. The server methods are synchronous
under the existing short SYSTEM transaction; browser methods return promises.
Optional services are null server-side when disabled or without an admitted
request authority. A manually constructed second auth client or raw SQL writer
is unnecessary.

| Operation under `.blog` | Contract |
| --- | --- |
| `capabilities()` | State, effective management/edit flags, name/photo/bio requirements, current scoped site and own enrollment. |
| `authors.list({ limit?, after? })` | Manager-only page; default 50, maximum 100. Returns items and opaque nextCursor. |
| `authors.get(userId)` | Own enrollment or permitted manager read, within the current scope. |
| `authors.assign({ userId, expectedRevision, status? })` | Manager enrolls/changes status. New expectedRevision is 0; active is default. Existing assignments require their current revision. |
| `authors.updateProfile(userId, { expectedRevision, changes })` | Current active author edits their draft, or permitted manager edits an eligible active author. |
| `authors.publishProfile(userId, expectedRevision)` | Checks current requirements and explicitly accepts the draft as public. |
| `authors.withdrawProfile(userId, expectedRevision)` | Clears publication; a manager can withdraw a suspended author's retained data without reactivating the account. |

Browser calls additionally accept a final `{ signal }` options object. Do not
use these profile methods as proof of post publication rights; a post CMS is
not part of this foundation.

```ts
// In a permitted signed-in browser context:
const author = await client.blog.authors.assign({
  userId: selectedUserId,
  expectedRevision: 0,
});
const draft = await client.blog.authors.updateProfile(selectedUserId, {
  expectedRevision: author.revision,
  changes: {
    displayName: 'Avery Brooks',
    slug: 'avery-brooks',
    byline: 'Product engineer',
    bio: 'Writes about building reliable systems.',
    avatar: 'account',
    socialLinks: [{ label: 'Website', url: 'https://example.com/' }],
  },
});
// Complete the explicit public photo ceremony before this call when required.
const published = await client.blog.authors.publishProfile(
  selectedUserId, draft.revision,
);
```

An existing user's normal account role stays unchanged. Author status is active,
suspended or revoked in this blog scope. Managers can suspend/revoke an existing
assignment even if its account is no longer eligible, but cannot newly enroll
or reactivate an ineligible user. A user can be an author in one organization
and not another.

## Draft, Readiness And Public Data

The draft has exactly these fields: `displayName` (120), `slug` (100), nullable
`byline` (160), nullable `bio` (2000), nullable HTTP(S) `website` (2048), up to
12 `{ label, url }` social links (label 80), and `avatar: 'account' | null`.
Lengths are upper bounds, not required text. Slugs are lowercase words separated
by hyphens. Empty optional sections are omitted by consumers; there are no
invented handles/social URLs. Scripts, credential-bearing links, arbitrary
avatar URLs, unknown fields and authority selectors are rejected.

New authors start with an empty draft and missing requirements. Zero does not
copy a private account bio/email into a public byline. `readiness` reports
`ready` and missing displayName/avatar/bio, independently of ordinary login.
`published` means a saved public revision exists, not that an ineligible or
suspended author is currently visible.

Draft edits do not alter the published profile. Publish deliberately replaces
that snapshot; withdraw removes it. Draft and retained public slugs are reserved
within their site to avoid another author taking the live URL before a draft
rename is published. A rename does not yet create an automatic redirect.

Public reads require an active canonical user, active scoped assignment and,
in multi mode, current active membership in an active organization. Required
public-photo withdrawal/replacement also makes the byline unavailable until
the requirement is satisfied again. Account deletion retains historical author
identity with a null user reference, but does not serve it publicly. This is not
a legal-retention or full post-attribution policy; the CMS must define that next.

## Public Projection And Photos

```ts
import { createPublicBlogClient } from '@zero/framework/blog/client';

const publicBlog = createPublicBlogClient('https://app.example.com');
const byline = await publicBlog.author('blog', 'avery-brooks');
```

Public reads send no cookies or bearer credentials. The allowlist contains
opaque author/site IDs, name, slug, supplied byline/bio/website/social links and
an optional explicitly public avatar descriptor. It excludes user IDs, account
emails/usernames, roles, private profile data, organization membership and
drafts. Public responses and photos are no-store.

Single-mode sites use public selector `blog`. Multi-mode sites get a retained
opaque `site-…` slug on first enrollment; obtain it from admitted capabilities.
It identifies intentionally public content, not a tenant DB or grant. The
current foundation does not add a public all-authors/org directory, custom-domain
mapping, site renaming or general site-admin UI.

Photos use the account's **current explicitly published** Guardian image, not a
frozen copy of an old photo. Only the account owner can publish/withdraw their
photo through `client.userAvatar`; author managers cannot turn another user's
private photo public. See [public avatars](../guardian/avatars.md#optional-public-avatar-publication).

## Scope And Live Authority

Private operations never accept `tenantId`, scope, role or database selectors.
Web sessions use their live application/selected-organization authority. Native
sessions need `profile` to read and `profile:write` to mutate, plus the same
Guardian management requirement for administrative operations. API keys cannot
use account-author operations. Ownership alone does not bypass a revoked session.

Every mutation rechecks policy/session/organization authority inside the same
transaction and immediately before commit. Author revisions prevent overwriting
concurrent changes. Private author CAS is separate from the Guardian profile/
avatar CAS: use the revision returned by the relevant service, not one shared
counter guessed across both domains.

## Realtime And Audit

`client.blog.watch(listener, { signal?, onError? })` observes authorized
`{ capabilities, authors? }` snapshots. Managers receive a first page of at most
20 authors; other callers receive only their own capability/enrollment view.
The author list is not an unlimited stream or a replacement for paginated reads.
Use a fresh list query for later pages after accepted actions.

The server coalesces changes with one queued projection, bounds concurrent
connections, checks authority again while projecting and reconnects bounded
SSE sessions. Account, organization and SDK disposal transitions retire pending
calls/readers so late data cannot replace the next account's state. No raw
SYSTEM table subscription or fabricated INSERT/UPDATE notification is needed.

Author assignments, draft edits, publish and withdraw append secret-free
`blog.author-*` Guardian audit events inside the mutation transaction. Public
photo publish/withdraw use `profile.avatar.published` / `.withdrawn`. A failed
final fence rolls back both data and audit. Configured core Logging uses its
existing same-transaction durable capture; no new worker or independent log DB
is invented by blogging. Profile text, image bytes and private account emails
are not included in these event payloads.

## HTTP And Errors

The managed API base is `/api/blog`: GET `/config`, GET/POST `/authors`,
GET `/authors/:userId`, PATCH `/authors/:userId/profile`, POST/DELETE
`/authors/:userId/publication`, GET `/live`, and anonymous GET
`/public/:siteSlug/authors/:authorSlug`. Mutation JSON is bounded to 64 KiB;
unknown keys/query selectors are rejected. Prefer the facade over assembling
these requests manually.

`BLOG_REVISION_CONFLICT` (409) means reload/review; `BLOG_SLUG_CONFLICT` (409)
requires another public address; `BLOG_AUTHOR_INCOMPLETE` (422) requires the
reported profile fields. Permission denial is 403, unavailable/private authors
are 404. `BLOG_NOT_READY` (503) means inspect schema/readiness;
`BLOG_POLICY_CHANGED` (409) means use the current runtime. Do not retry
non-idempotent writes blindly or use private SQL to bypass these checks.

## Related Guides And Next Steps

- [Existing-project rollout](./upgrade.md) lists deployment checks.
- [Blog UI](../../frontend/components/public-pages/blog/index.md) accepts explicit display data.
- [Roadmap](./roadmap.md) records post/editor/SEO integration still to implement.
