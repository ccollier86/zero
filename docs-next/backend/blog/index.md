---
id: zero.blog
type: index
audience: [developer, agent, operator]
owner: blog
status: in-review
visibility: internal
system: blog
feature: author-foundation
maturity: preview
applies_to: ["2.6.0 feature/blog-foundation preview; not the selected main archive"]
modes: [managed-server, single-simple, single-advanced, multi-simple, multi-advanced]
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

# Blog Author Foundation

[Backend index](../index.md) · [Blog UI](../../frontend/components/public-pages/blog/index.md)

Enable `blog: true` in managed app configuration to add user-backed author
enrollment, separate draft/public bylines and Guardian-scoped management. It
reuses the accounts, permissions, profile editor, Storage and audit capture that
the app already has. It does not replace an existing account role with an
"author" role or make every account a public profile.

This feature-branch preview is the **author foundation**, not a post CMS.
Post storage, block editing, publication scheduling, automatic article SEO and
automatic route assembly are separate [next steps](./roadmap.md). The existing
`@zero/framework/blog` presentation components remain usable without this backend.

## Choose An Entry Point

- [Configuration](./configuration.md): one-switch defaults, explicit policy
  overrides, and expanded profiles without blogging.
- [Authors and public profiles](./authors.md): server/browser facades, enrollment,
  publication, permissions, organization isolation, realtime and audit behavior.
- [Existing-project upgrade](./upgrade.md): additive migrations, safe rollout,
  Doctor findings, preservation checks and disabling without deleting data.
- [Roadmap](./roadmap.md): the boundary between this foundation and the future CMS.

## What Zero Handles

| Concern | Owner and behavior |
| --- | --- |
| Identity and login | Existing Guardian account, credentials and session authority; no second author account. |
| Author enrollment | Blog-scoped metadata referencing an existing user; managed per application or selected organization. |
| Private profile | Existing own-profile service and adaptive settings UI; additional fields are opt-in outside blogging. |
| Public byline | Explicit draft and publication, with an allowlisted anonymous projection. Private email/roles never supply public fallbacks. |
| Photos | Existing normalized private avatar pipeline, plus an explicit optional public publication pointer. The Storage drive stays private. |
| Storage location | Small identity-adjacent metadata in SYSTEM; no new customer tables, Fabric realm contributions or database placement changes. |
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
