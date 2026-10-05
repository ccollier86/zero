# Updating Zero 2.1 To 2.2

Zero 2.2.0 adds the Data Studio workspace/JSON editor improvements and the
source-audit correctness fixes described in the [changelog](../CHANGELOG.md).
This guide applies to existing Zero 2.x applications. It is not the legacy
1.3-to-2.x system-database migration guide.

## 2.2.1 Release-Blocker Corrections

Use 2.2.1 rather than 2.2.0 for schema-driven Fabric apps. The 2.2.0 schema
builder retained loading intent on server projections, but Fabric rejected its
new framework-owned symbol. The correction validates and preserves explicit
full/lazy/auto modes across direct/composed realms and actor startup, without
removing Guardian references/mutation validators or accepting arbitrary symbols.
SQL columns, checksums, realm fingerprints and durable namespaces are unchanged;
no data conversion or new migration is required for this fix.

The matching-root-override/workspace-peer updater correction stages both archive
references consistently and restores the original root manifest bytes. Keep the
app's matching override and workspace peers in place; the temporary workaround
of removing them is not needed for this supported update path. Existing managed
filesystem/symlink guards and install-state rollback remain enforced.

## Normal Saved-Package Update

On the Zero development workstation, select committed main and inspect it:

```sh
zero-release main
zero-release --status
```

The report must identify Zero 2.2.1 or newer and the intended main commit. Then,
inside the consuming application:

```sh
zero-update --dry-run
zero-update
```

The updater preserves app-owned source/configuration and runtime data. It
refreshes the framework archive and its dependency graph, writes release
provenance, and retains the established install-state rollback boundary.
It does not regenerate application UI, convert tenancy, or run a database
migration. Restart/rebuild the app using its normal development or deployment
process after updating. A registry install needs its actual registry release;
the saved local archive flow does not depend on npm publication.

## Database And API Compatibility

There is no new system migration or logical-table data rewrite between 2.1.1
and 2.2.1. Guardian/Fabric installation fragments, permissions, schemas, stable
column IDs, operation IDs and revisioned write endpoints remain in use.
Data Studio row pages add optional `readSequence` metadata from their strong
Fabric read; existing paged consumers still parse older payloads.

The connected `DataStudio` component defaults to progressive bounded batches
and no longer presents page buttons beneath the editor. The standalone
`useDataStudio()` hook remains paged by default. When composing the new workspace
directly, use `useDataStudio({ rowLoading: 'progressive' })`; ordinary DataTable
pagination is unchanged. Progressive continuations need the matching updated
server so shifted offsets cannot be silently joined after concurrent writes.

## Workspace Height And Controls

The inspector is optional and hidden on desktop by default. Use
`defaultDetailsOpen`, or controlled `detailsOpen`/`onDetailsOpenChange`, to open
it initially. `resizableDetails` defaults true. Full record values and compact
table metadata belong in this pane; schema authoring belongs in headers or the
Visual/JSON dialog.

Workspace layouts need a bounded parent. AppShell's workspace content mode
provides the height chain; custom wrappers must retain
`min-h-0 min-w-0 flex-1` instead of allowing long children to stretch the page.
Use `contentMode="document"` for intentional page-level document scrolling.
Shared master/detail actions remain anchored below independently scrolling panes.
See [master/detail](./frontend/master-detail.md) and [Data Studio](./data-studio.md).

The new [JSON editor](./frontend/json-editor.md) uses local controlled drafts.
Its `commit()` result is validation, not server persistence; await the appropriate
domain mutation before reporting saved. No code-editor migration is required.

## Configuration Corrections To Check

- MFA `rememberDevice: true` and `recoveryCodes: true` now fail with
  `AUTH_CONFIG_UNSUPPORTED_FEATURE`. They were reserved/unimplemented settings;
  remove them or keep them false. This does not disable implemented MFA methods.
- Migrations and synchronous SQL transaction callbacks must be synchronous.
  Async/generator handlers and thenable results no longer report premature
  success. Put asynchronous preparation outside the transaction boundary.
- Previously invalid defaults, capacities, token lifetimes, retention limits,
  storage byte drafts and vector options now receive deliberate validation.
  Correct invalid input rather than depending on a silent fallback.
- Scheduler `catchErrors: false` now really reports and rethrows job failures.
  Keep the default true policy when the runtime should contain callback errors.

After updating, typecheck/build the app and exercise its own login/bootstrap,
organization switching, read/write permissions, Data Studio and Storage views.
Platform tests use isolated fixtures; they do not replace verification of an
application's custom handlers or deployment. Keep the prior framework pin and
runtime backups until the application checks succeed.

## Documentation And Future Packages

The rebuilt `docs-next` tree is committed separately from the packaged docs; its
source baselines and qualification status remain explicit. This release does
not automatically publish the new site, replace agent entrypoints, or split UI
and icons into separate packages. Existing public imports remain supported.
