---
id: zero.guides.upgrade
type: operations
audience: [developer, agent, operator]
owner: zero-documentation
status: draft
visibility: internal
system: cross-system
feature: upgrade
maturity: supported
applies_to: ["2.1.1 source with audited corrections; package qualification pending"]
modes: [single, multi, simple-RBAC, advanced-RBAC, single-topology, Fabric]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Upgrade Code, Data And Contracts Deliberately

[Guides index](./index.md) · [Documentation index](../index.md)

An installed package update and an application migration are different
operations. The normal updater does not rewrite app source, move data, change
secrets or migrate tenants.

## Identify The Starting Point

Record branch/release version, source provenance and archive checksum when
using a saved local release. Inspect app ownership mode, database layout,
source-copied components, SDKs and dependency overrides.

Use [zero update](../cli/tooling/update.md) or the
[saved-archive updater](../cli/tooling/zero-update.md) appropriate to that source.
Dry-run first. Optional check scripts can execute arbitrary app code; inspect
them before enabling them.

## Changes That Need An App Plan

Older combined platform/app databases are not automatically split into the new
managed system plane. Plan canonical authority migration and minimal anchors
separately from application records. Multi-tenancy conversion additionally needs
real organization ownership, memberships, app rows/files and resource policy.

Torrent/database schema and definition-version changes have their own
[legacy compatibility](../backend/torrent/legacy-workflows.md) and
[migration-plane guidance](../backend/migrations/data-planes.md).
A newer package does not prove an old persisted definition can be replayed
with changed activity behavior.

Independently versioned native SDKs and app-copied UI must be checked explicitly.
A core framework version does not update a sibling repository or copied component.

## Validate Before Cutover

### Minimum App Migration Checklist

Use this checklist even if the destination keeps the app's current single-tenant
profile. A new package is not an automatic authority/data conversion tool.

1. **Pin and identify both versions.** Record the current working pin, release
   branch/source commit, archive checksum/provenance and any dependency patches.
   Record the intended destination identity before updating. Keep the previous
   artifact and lockfile/install evidence available; do not rely on a moving
   branch name as the recovery artifact.
2. **Back up the complete state and prove restoration.** Inventory system/app/
   Fabric files, retained storage bytes/metadata, KV state where used, and the
   private credentials/configuration needed to reopen them. Use the target's
   supported consistent snapshot/stopped lifecycle, not a copy of just a live
   SQLite main file that omits WAL state. Restore into an isolated representative
   copy and verify it actually opens before attempting conversion. See
   [backup/restore boundaries](../backend/migrations/backups.md).
3. **Separate canonical authority from app rows.** Identify existing canonical
   users, credential/session state, roles/permissions, organizations/memberships
   and platform-service tables. Plan their system-plane target separately from
   business records. Preserve user/membership identities needed by app foreign
   keys; provision the framework's minimal local anchors rather than recreating
   password/profile/role copies in app tables. See
   [migration planes](../backend/migrations/data-planes.md) and
   [Guardian references](../backend/schema/guardian-references.md).
4. **Map organization ownership and Fabric placement explicitly.** If converting
   to multi-tenancy, assign existing users, business rows, files and workflow
   history to real organizations, including the Administration Organization's
   own app workspace. Decide shared-row versus tenant-file isolation and declare
   the corresponding realms/schema/migrations/readiness. Retain discriminators
   where shared-row isolation still needs them. Moving to an independent file
   does not remove user ownership or row permissions. See
   [organization assembly](./organization-assembly.md) and
   [Fabric placement](../backend/fabric/placement.md).
5. **Reconcile resource boundaries and credentials.** Review declared Resources,
   generated query/CRUD/Sync permissions, field/owner rules, public paths and
   authentication redirects. Reissue or migrate credentials only through the
   appropriate supported lifecycle; test existing API keys' live role scope,
   signing requirements, expiry and revocation. Do not keep a legacy broad route
   or fabricated tenant selector as a workaround for the new boundary. Use
   [Resource policies](../backend/resources/policies.md) and
   [Guardian API keys](../backend/guardian/api-keys.md) for the current contracts.
6. **Keep Torrent's persisted code references replayable.** Inventory legacy
   definitions, handler names, immutable graph/activity versions, waiting/retrying/
   paused runs and retained private state. Register the exact required code before
   recovery, then prove interrupted runs recover in the isolated copy without
   deleting their history. Review payload-redacted progress and any old UI that
   expected raw inputs/results. Package updates do not rewrite old definitions
   or make external effects exactly once. See
   [legacy workflow compatibility](../backend/torrent/legacy-workflows.md),
   [definition versions](../backend/torrent/definitions.md) and
   [recovery](../backend/torrent/recovery.md).
7. **Check separately maintained and copied frontend code.** Review native SDK
   version/provenance, public client/callback registration and local credential
   storage; framework installation does not update a sibling preview SDK. Compare
   app-copied UI with the applicable component/API changes, including auth/scope
   readiness and acknowledged mutations. Apply app-specific changes deliberately
   rather than assuming an updater rewrites them. Check
   [native SDK boundaries](../backend/native-auth/index.md) and
   [source-copied UI](../cli/tooling/source-copy.md).
8. **Validate the converted copy and its rollback path before cutover.** Prove
   ordinary login/registration/account actions, role and API-key revocation,
   owner FKs, scoped reads/writes/realtime, storage and workflow restart behavior
   under the app's actual modes. In multi mode include two customer organizations
   and app-only/mixed-role Administration members. Then test restoring the
   pre-conversion backup with the retained old pin. Record the cutover/restore
   procedure and keep recovery artifacts until the result is accepted.

These are app-specific migration responsibilities, not steps a generic updater
silently performs. Database `down`/package rollback is not automatic restoration
of every converted app effect. Execute any real migration, restore or deployment
only against the explicitly authorized target and lifecycle.

Do not erase live data, run migrations, deploy or regenerate an app as part of a
routine documentation diagnostic. An update rollback protects managed install
state, not every arbitrary application effect.

See [migrations](../backend/migrations/index.md),
[data planes](../concepts/data-planes.md), [mode selection](./choose-modes.md),
[verification](./verification.md) and [release tooling](../cli/tooling/releases.md).
