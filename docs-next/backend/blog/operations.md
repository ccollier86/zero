---
id: zero.blog.operations
type: how-to
audience: [developer, agent, operator]
owner: blog
status: in-review
visibility: internal
system: blog
feature: operations
maturity: supported
applies_to: ["2.6.0 source/local builds containing c9c5fb9; older 2.6.0 archives differ"]
modes: [managed-server, single-simple, single-advanced, multi-simple, multi-advanced]
---

# Operate And Recover Managed Blogging

[Blog index](./index.md) · [Publishing API](./publishing-api.md) · [Upgrade procedure](./upgrade.md)

The managed runtime owns the blog's Fabric database, native media integration,
supervised actors and authorized live projections. Applications own their
deployment, approved configuration, consistent backups and protected workspace
route. Do not replace the managed runtime with app-owned SQLite files or raw SQL.

## What Must Survive A Restart

Keep these owners together:

| Retained state | Purpose |
| --- | --- |
| SYSTEM and Guardian authority state | Existing users/roles, author and public-avatar consent, site/policy clocks, blog ownership receipts, media namespace/leases and optional metrics signing identity. |
| Private blog Fabric root | Content realm, drafts, immutable revisions, public snapshots, taxonomy, full-text indexes, idempotency receipts and enabled aggregates. The default root is `data/zero.blog` relative to the trusted project root. |
| Existing private Storage root and Storage metadata | Admitted image/audio/video assets and their identities. A database reference is not a substitute for the object bytes. |
| Configured Logging roots and custody state | Independent retained audit evidence. Restoring content must not silently discard or rewrite its historical evidence. |

The SYSTEM owner binds the retained content identity, physical root and realm
fingerprint. Missing established content, an unexplained root change or an
unowned preexisting content file rejects startup instead of creating an empty
replacement. Do not clear ownership rows, edit migration receipts or rename
Fabric files to get past this safeguard.

Use the application's supported consistent-backup procedure across these
owners. A live copy of only the main `.db` file is not a consistent SQLite/WAL
backup. If the deployment has no qualified coordinated snapshot facility,
quiesce writes and stop/drain the managed app before taking a filesystem backup.
Rehearse restore on separate paths with providers/delivery disabled or synthetic.
Changing a retained content root requires deliberate recovery review, not an
automatic startup adoption. This feature does not implement nightly backup,
cross-file point-in-time restore or repair arbitrary damaged databases.

## Build And Worker Deployment

Use the normal Zero build. Blog and core migrations keep canonical source
identities through bundling; never bypass checksum/fingerprint validation.
The default blog worker resolves the matching retained framework source package
from the deployment. Keep that package, its dependencies and required native
image-processing payloads with a bundled-server deployment.

An explicit `blog.content.actors` launch is available for a deliberate alternate
source/bundle deployment. Its entry must run the blog actor bootstrap and never
boot the main app. The configured child environment is a complete allowlist;
provider secrets and dotenv contents are not implicitly inherited. Use the
existing Logging actor launch separately—blog actors do not replace it.

Fabric admits one writer for this content file and independent reader work;
other database owners retain their own admission. Actor queues and image work
are bounded. Publication/metadata transactions do not hold an authority lease
while waiting on uploads, decoding, providers or other network operations.
Content change hints coalesce authorized rereads instead of polling an idle
database. Stop the managed app through its normal lifecycle so admitted work,
source delivery and actor owners drain before files are retired.

## Investigate A Failure Without Losing Work

Start with current-authority capabilities through `client.blog.capabilities()`
and `client.blog.posts.capabilities()`, then the native workspace and supported
Logging investigation APIs. A public health response is not proof of author
permission, strict audit admission, worker readiness or successful publication.
Do not mint privileged credentials or bypass the request-scoped facade to
inspect another user's drafts.

| Symptom | Safe response |
| --- | --- |
| Feature unavailable after enabling | Review the normal migration/Doctor plan, retained root identity and actor deployment. With `migrate:false`, apply reviewed migrations explicitly; requests never repair the schema. |
| Revision conflict | Preserve the local draft and review the accepted revision. Reload/discard is explicit. Do not replace the expected revision with whatever is newest and replay blindly. |
| Unknown mutation outcome | Keep the exact original request ID, body and expected revision. Reconcile or retry that same command; do not assign a new identity and risk repeating accepted work. |
| Lost access or rejected live reread | Mask stale private content. Reauthenticate/revalidate through normal Guardian/audit recovery. Reconnect is not permission to show a previous actor's snapshot. |
| Upload or normalization failure | Preserve the post draft. Check admitted type/size/pixel policy and private Storage readiness. Retry through the native media API, never manufacture an asset reference. |
| Referenced media cannot be deleted | Retained draft/public/history references intentionally protect it. Review the references; do not delete private object bytes behind the service. |
| Public page/search/sitemap differs from a private edit | Draft changes do not alter the accepted public revision. Publish deliberately, then verify anonymous HTML, search and discovery. |
| Public article unavailable after consent withdrawal/suspension | Review current author/site/photo authority. Do not restore visibility with private account-name/photo fallbacks. |

Retain stable error codes and safe static operation names in diagnostics. Do
not log article bodies, private biographies, object paths, capability URLs,
tokens or upload bytes. Database mutation evidence does not prove public
delivery or human attention.

## Metrics, Retention And Limits

Optional observations are disabled by default. Signed/replay-deduplicated
view/foreground-time aggregates are not unique-person counts, proof of reading
or compliance evidence. Read-time retention excludes expired aggregates even
without a new write. Physical aggregate cleanup occurs in bounded work during
new observations; that is not a timed secure-erasure guarantee.

Immutable editorial history and referenced assets have no automatic general
content-retention cutoff in this release. There is no archive-import UI, legal
hold manager or erasure automation for posts. Set an application retention and
account-removal policy before relying on such behavior.

## Release And App Acceptance

Use the exact qualified source/archive selected by normal Zero update, not
just the `2.6.0` label. The [execution checkpoint](../../_work/blog-publishing-implementation.md)
distinguishes focused evidence from the complete release gates.

Rehearse existing-project enable/disable and a real browser flow on isolated
state: author readiness → private upload → draft/save → publish → anonymous
reader/search/SEO → later private edit → withdrawal → restart. Check strict
audit admission, current-scope masking, provider isolation and recovery too.
The application owner—not a framework qualification script—approves deployment.
