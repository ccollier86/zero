---
id: zero.blog
type: index
audience: [developer, agent, operator]
owner: blog
status: in-review
visibility: internal
system: blog
feature: author-foundation
maturity: experimental
applies_to: ["2.7.0 source/local package; use the qualified selected commit/archive"]
modes: [managed-server, single-simple, single-advanced, multi-simple, multi-advanced]
---

# Blogging And Publishing

[Backend index](../index.md) · [Blog UI](../../frontend/components/public-pages/blog/index.md)

## Native Publishing

The 2.7.0 implementation includes private Fabric
posts, revisions, explicit publication, taxonomy, Storage media, indexed search,
optional aggregate observations, managed Magazine/article routes and a native
authoring workspace. See the [publishing API](./publishing-api.md),
[workspace and reader](../../frontend/components/public-pages/blog/publishing-workspace.md)
and [execution checkpoint](../../_work/blog-publishing-implementation.md).
Source and real-browser checks alone are not installed release qualification.
Use the qualified main archive identified by `zero-release --status`; the
[combined release record](../../_work/combined-blog-messaging-logging-release.md)
retains pending gates and historical failures instead of hiding them.

## Earlier Qualified Author Foundation

The retained author-only preview and its package evidence remain historical.
See the [continuation qualification](../../_work/audits/blog-author-foundation.md#resumed-continuation-2026-10-26)
and [preview migration boundary](./upgrade.md#earlier-feature-branch-preview).
The normal updater selects committed main, never an unqualified blog branch.

Enable `blog: true` in managed app configuration to add user-backed author
enrollment, separate draft/public bylines and Guardian-scoped management. It
reuses the accounts, permissions, profile editor, Storage and audit capture that
the app already has. It does not replace an existing account role with an
"author" role or make every account a public profile.

One application-owned blog is the default for both single- and multi-tenant
apps; customer organization management does not grant platform-blog access.
The existing `@zero/framework/blog` presentation parts remain usable without
enabling persistence or routes. Scheduled publication, translations and
Gutenberg interchange are not implemented or implied by the block editor.

## Choose An Entry Point

- [Configuration](./configuration.md): one-switch defaults, explicit policy
  overrides, and expanded profiles without blogging.
- [Authors and public profiles](./authors.md): server/browser facades, enrollment,
  publication, permissions, organization isolation, realtime and audit behavior.
- [Existing-project upgrade](./upgrade.md): additive migrations, safe rollout,
  Doctor findings, preservation checks and disabling without deleting data.
- [Publishing API](./publishing-api.md): posts, media, taxonomy, search, observations and worker ownership.
- [Operations and recovery](./operations.md): supervised workers, retained state, failed writes, media and consistent recovery.
- [Roadmap](./roadmap.md): remaining release gates and optional later extensions.
- [Publishing implementation plan](./publishing-plan.md): design rationale and the retained safety/acceptance requirements.

## What Zero Handles

| Concern | Owner and behavior |
| --- | --- |
| Identity and login | Existing Guardian account, credentials and session authority; no second author account. |
| Author enrollment | Blog-scoped metadata referencing an existing user; managed per application or selected organization. |
| Private profile | Existing own-profile service and adaptive settings UI; additional fields are opt-in outside blogging. |
| Public byline | Explicit draft and publication, with an allowlisted anonymous projection. Private email/roles never supply public fallbacks. |
| Photos | Existing normalized private avatar pipeline, plus an explicit optional public publication pointer. The Storage drive stays private. |
| Author metadata | Small identity-adjacent metadata in SYSTEM; existing account/role and customer tables are not replaced. |
| Content storage | One separate private, file/WAL Fabric database owned by the blog runtime. Drafts, revisions, publication, taxonomy and aggregates stay out of customer tables. |
| Changes | Authorized coalesced SSE projections, supported SDK scope retirement and accepted snapshots. |
| Audit | Guardian audit appended inside the author/privacy transaction; configured core Logging captures through its existing durable source bridge. |

Blog defaults fill **omitted** profile options. An app's explicit disabled or
read-only policies remain authoritative. Impossible combinations reject with
an actionable configuration error, rather than silently widening privacy.

For a profile-only upgrade, use `auth.userProfile` directly. There is no need to
turn on blogging, enroll authors, change tenancy or add custom SQL.

## Qualification And Related Contracts

The [qualification record](../../_work/audits/blog-author-foundation.md) identifies
the tested source and candidate package. An older installed `2.6.0` does not
gain these changes from its version label; use the identified source/archive.
No existing application or live database is modified by framework tests.

- [Guardian profiles](../guardian/user-profiles.md) own private account details.
- [Guardian avatars](../guardian/avatars.md) own media admission and public-photo opt-in.
- [RBAC](../guardian/rbac.md) owns role/permission semantics.
- [Logging](../logging/index.md) owns durable capture and investigation.
- [Blog UI](../../frontend/components/public-pages/blog/index.md) owns presentation, not publication authority.
