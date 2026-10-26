---
id: zero.blog.upgrade
type: how-to
audience: [developer, agent, operator]
owner: blog
status: in-review
visibility: internal
system: blog
feature: existing-project-upgrade
maturity: experimental
applies_to: ["feature/blog-publishing-backend working implementation; not a selected release"]
modes: [managed-server, single-simple, single-advanced, multi-simple, multi-advanced]
---

# Add Blogging To An Existing Project Safely

[Blog index](./index.md) · [Configuration](./configuration.md) · [Migration procedures](../migrations/index.md)

The supported path is a package upgrade plus additive managed SYSTEM migrations
and configuration. Do not rebuild users through public create APIs, copy hashes
into a new account, patch SQL in app startup, or apply a fresh scaffold over an
existing project. Enabling profile fields alone is also supported.

## Prepare A Rehearsal

1. Use an application feature branch and the exact qualified candidate commit
   and archive recorded in the [implementation checkpoint](../../_work/blog-publishing-implementation.md).
   The historical author-only preview does not qualify the new publishing code.
   The version string alone does not identify an update.
2. Back up SYSTEM, the app DB, any Fabric files and Storage with the project's
   normal consistent-backup procedure. Rehearse on isolated copies, using
   separate paths and local delivery/provider settings. Never let the rehearsal
   send real account emails or reuse a live Storage root.
3. Run normal update/migration planning and Doctor before startup; review the
   installed ledger/checksums and exact schema collisions. Very old combined
   installations must first use the [supported legacy-state boundary](../migrations/legacy-state.md),
   not pretend this small feature migration is the whole platform upgrade.
4. Add only `blog: true`, or the selected `auth.userProfile` fields for a
   profile-only change. Preserve existing tenancy, RBAC registries/versions,
   bootstrap/registration, table/resource declarations and custom public theme.

## What Changes In Storage

| Migration | Purpose | Does not do |
| --- | --- | --- |
| 039, if not already present | Fixed nullable private profiles, shared profile CAS/policy clock. | Does not require every user to fill new fields or create a new account. |
| 042, if needed | Existing private normalized avatar receipts/assets/pointers. | Does not make a bucket or photo public. |
| 045, if not already present | Released private Storage artifact references, including logging evidence. | Does not move or replace existing Storage objects or logging files. |
| 046 | Explicit public-avatar publication pointers to current normalized private assets. | Does not publish existing images, rewrite Storage grants or copy photo bytes. |
| 047 | Scoped blog site/author metadata and installed policy clock in SYSTEM. | Does not enroll users, change roles, add post tables or modify customer/Fabric schemas. |
| 048 | Private blog Fabric owner, media namespace/leases and optional metrics signing metadata. | Does not put article bodies in SYSTEM, move an existing content root or recreate lost retained content. |

These are append-only framework migrations. Previous migration definitions and
checksums stay unchanged. The normal full upgrade can include other intervening
migrations too; inspect its actual plan rather than running just this table's
numbers out of order. Empty new framework tables may exist while a feature is
off; that is not enrollment or public exposure.

### Earlier Feature-Branch Preview

The retained `c7011c7` / `56bbb66` author preview used **045 for public avatars
and 046 for authors** before main released a different 045 for private Storage
artifacts. The continuation on `feature/blog-foundation-current` preserves
released main's 001–045 byte-for-byte and appends public avatars/authors as
046/047. The earlier branch and archive remain unchanged for reference.

A database initialized by that earlier author preview is **not** a released-main
database. Normal startup deliberately rejects its conflicting migration 045;
it does not renumber its receipts, clear its ledger, pretend the old 045 was the
Storage migration, or discard author/photo data. Keep that preview and its
consistent backup pinned. Use a fresh disposable database for a new rehearsal,
or request an explicitly reviewed preview-state conversion before carrying
valuable preview writes forward. There is no automatic preview-ledger repair.

The older preview archive remains historical evidence, not qualification of
this merged continuation. Review the updated
[qualification record](../../_work/audits/blog-author-foundation.md) for the
current source/test boundary before installing it.

With `migrate: false`, missing/incompatible feature schema remains blocked;
requests do not opportunistically create it. Apply reviewed migrations through
the normal migration mechanism, then restart. Standalone ephemeral tests have
their own admitted bootstrap path; that does not authorize production repair.

Normal startup adopts the resolved feature policy and provisions the existing
private Guardian media namespace when permitted. A name collision fails closed
instead of overwriting an app table. Doctor is read-only: `blog.authors.schema_*`,
`blog.authors.policy_*`, `blog.content.*` and `auth.user_profile.public_avatars.schema_*` distinguish
missing/invalid schema from policy awaiting startup. A schema-ready finding is
not proof of provider, authorization or public-photo readiness.

## Verify Before Deployment

- Existing users keep IDs, credential hashes, trusted properties, memberships,
  role assignments and normal login/refresh behavior. Unrelated application
  rows and theme/config files stay unchanged.
- Previously minimal profiles expose only the newly enabled fields. Existing
  values remain, disabled/read-only options stay authoritative, and no account
  is forced through new login completion by blog enablement.
- Existing author list is empty on first enablement. An unauthorized user
  cannot enroll themselves; a manager can enroll an existing user without
  changing their role.
- A new author cannot publish until the required public name/photo/bio is
  complete. Uploading a private photo is not publication. The owner deliberately
  publishes it, then the author deliberately publishes the byline.
- Anonymous output contains only the allowlisted public fields. Test draft
  isolation, photo replacement/withdrawal, suspension, membership loss and
  author withdrawal. Cross-org private reads/writes remain denied.
- Conflicting edits return CAS conflicts; a final authority failure leaves no
  accepted row or audit event. Configured Logging receives accepted events
  through its normal durable bridge.
- Use the normal Zero build after enabling managed blog pages. A conflicting
  app-owned blog route must be deliberately preserved with pages:false or moved
  by the application; the build will not replace it. Mount the protected
  [BlogWorkspace](../../frontend/components/public-pages/blog/publishing-workspace.md)
  separately inside existing navigation. Test no-JS public rendering, media,
  draft privacy, search, redirects, SEO and sitemap withdrawal on the candidate.
- Retain and consistently back up the new private blog Fabric root together
  with its SYSTEM owner receipts and private Storage namespace. Never restore
  just a newly empty blog file against old ownership metadata.

Framework qualification uses disposable loopback/SQLite/Storage fixtures. The
application agent still needs to rehearse the project's actual backup and
deployment lifecycle; no universal zero-risk migration claim replaces that.

## Disable And Rollback

Prefer rolling back application configuration on the current qualified package:
set `blog: false`, and deliberately restore the prior own-profile/public-avatar
policy if desired. Managed blog routes/facade are removed, public delivery stops
when its policy is off, and retained data is not deleted.

Disabling is **not permanent withdrawal**. If a retained published profile/photo
is later re-enabled and still satisfies its authority/visibility checks, it can
become available again. Use explicit author/photo withdrawal before disabling
when the intent is to remove publication, not temporarily turn the feature off.
Re-enabling does not automatically publish replacement photos.

Do not drop appended tables or rewrite migration receipts to roll back. Older
framework binaries are not automatically qualified against a newer migration
ledger/profile policy. A full binary/data restore requires the application's
tested consistent restore and an assessment of writes accepted since backup.
Keep backups and evidence until approval; do not delete the old theme/source.

## Related Guides And Next Steps

- [Configuration](./configuration.md) distinguishes omitted defaults from explicit opt-outs.
- [Author facade](./authors.md) is the supported enrollment/publication boundary.
- [Public avatars](../guardian/avatars.md#optional-public-avatar-publication) explains privacy limitations.
