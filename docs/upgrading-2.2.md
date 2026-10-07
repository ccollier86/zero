# Updating Zero 2.x

Zero 2.2.0 adds the Data Studio workspace/JSON editor improvements and the
source-audit correctness fixes described in the [changelog](../CHANGELOG.md).
This guide applies to existing Zero 2.x applications. It is not the legacy
1.3-to-2.x system-database migration guide.

## 2.5 Documentation And CodeBlock Update

Use the normal `zero-update` from main and rebuild/restart normally. All 2.4.1–2.4.3
corrections remain included. This update adds no database migration and does not
enable a docs route or install Markdown dependencies into existing apps.

The optional [Markdown docs plugin](./plugins/markdown-docs.md) lives in its own
package. The current `@zero/plugin-docs` 0.1.1 preview requires framework
`>=2.6.0 <3`; upgrade/install the optional plugin separately from the normal
framework updater. The original 2.5.0/0.1.0 release pair remains historical.
Source/local
archive installs are qualified separately from any future registry publication.
Register it in the ordinary server-plugin directory and point `contentDir` at
the folder you deliberately want to publish. Internal/draft documents remain
excluded; installing the plugin is not permission to publish the new docs tree.

Existing public `CodeBlock`/`CodeTabs` imports stay behind the same framework
facade. The old private renderer files are removed; code that directly imported
them should use the [public CodeBlock family](./frontend/code-block.md) instead.
Ordinary props do not need a rewrite. Custom server-prepared transformers that
cross a serialization boundary should use an explicit versioned
`transformerIdentity` and supply the same identity to the consuming browser.
Change that identity when the custom configuration changes; it is not a sanitizer.

For docs or other declared plugin build contributions, run the documented
[normal build](./app-build.md) before deploying. The build admits the declared
entry's exact bytes, preserves relative imports/chunks and supplies immutable
public/private artifacts. Source-file app routes keep their existing deployment
requirements; a compiled docs-only deployment does not compile arbitrary app pages.

## 2.4.2 Trigger Production Update

This release includes **all 2.4.1 array-policy fixes** plus the trigger budget
correction and retry-safe Torrent start. Run the normal `zero-update` once and
restart/rebuild the app normally; existing trigger declarations and scalar
policies need no rewrite.

Unrelated origin transactions no longer consume the 256-change automation
budget. Matched changes and all handler-generated writes remain bounded. The
separate public Fabric batch envelope has not changed.

Durable handlers can call `zero.torrent.start(name, input?, options?)` with
delivery-derived idempotency. Ordinary app functions remain supported through
registered durable adapters; Torrent is not required for those calls.
Read [app-function invocation](../docs-next/backend/database-automations/app-functions.md)
and [start/resume integration](../docs-next/backend/database-automations/torrent.md).

Managed system migration `038_workflow_system_start_receipts` runs through the
normal startup migration path. Torrent also ensures its private runtime schema
when workflows initialize, including migration-disabled composition. If the
app disables migrations, explicitly run the normal **system DB** migration
procedure to keep deployment history consistent; runtime initialization is not
a replacement for that history.
Back up system.db and its authority/receipt state together. No application row
conversion is required. Existing non-idempotent `startAsSystem` calls keep
their semantics; opt into [startAsSystemOnce](../docs-next/backend/torrent/system-starts.md)
for retryable trusted jobs. Never call it inside a transaction-mode handler.

## 2.4.1 Exact Array Authorization

Update using the normal saved-main package workflow. This update requires no
Zero migration or change to existing scalar constraints, table components or
unfiltered Fabric `list` calls. Applications choosing the new predicate own
their row projections and trusted membership-grant updates.

`ResourceDataConstraint` and Fabric `DatabaseFindFilter` accept
`operator: 'arrayOverlaps'` with a bounded string-array value. Empty scope matches
nothing; stored malformed/mixed/non-array/oversized values deny the entire row.
Returned row constraints now guard get/update/delete and receipt replay: an
application callback returning `allowed: true` cannot bypass its own constraint.
Read the [complete array-policy guide](../docs-next/backend/resources/array-overlap.md)
before enabling it. New platform/agent work should start in
[`docs-next/start-here.md`](../docs-next/start-here.md).

## 2.4 Button Group And Context Menu

Zero 2.4.0 adds the optional [Button Group](./frontend/button-group.md) and
[Context Menu](./frontend/context-menu.md) families through the root/React and
focused component imports. Their detailed guides cover actions versus selection,
native form behavior, keyboard/touch interaction, portals, checked indicators,
submenus and menu-to-dialog focus handoff.

Existing Button, DropdownMenu, RadialMenu and Data Studio handlers are not
automatically replaced. The release does not change global typography, density
or the theme/motion contract discussed for future work. Existing 2.3.0 apps need
no database migration, app configuration change or component-call-site rewrite.
Use the normal saved-package update below, restart/rebuild normally, then import
the new components where desired.

## 2.3 Component And Storage Update

Zero 2.3.0 adds the optional [Cascader](./frontend/cascader.md) and
[SignaturePad](./frontend/signature-pad.md) families, and includes the
Add Record/temporal-editor and Storage access-panel polish. Existing component
props and application-owned schemas remain supported. The Filters integration
document is still a plan; this release does not ship that component.

The Storage path correction removes the spurious not-found response for
uploaded filenames containing spaces, Unicode or special characters. Pass raw
logical paths (normally `FileInfo.path`) to the official hooks/actions; do not
pre-encode them. The HTTP boundary decodes each URL segment once before
authorization and lookup, keeping `/invoice 1.txt` distinct from a literal
`/invoice%201.txt`. See [file paths and deletion](./storage-studio.md#file-paths-and-deletion).

Updating an existing 2.2.1 app to 2.3.0 requires no system migration, data
conversion or component-call-site rewrite. Refresh the saved main archive,
perform the normal package update below, and restart/rebuild the app normally.
App-specific validation and deployment remain the application's responsibility.

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

The rebuilt `docs-next` tree is included in the framework archive as the primary
package-local feature and agent reference. The approved 2.4.1 handoff already
aligned README, Start Here and the agent documentation entrances with that tree;
each guide's source baseline and qualification status remain explicit.

Packaging classified Markdown is not permission to publish it. Internal working
notes remain internal, and the docs plugin admits only deliberately published
content. A public-only site projection and separate UI/icon packages are still
distinct follow-up work, not automatic effects of a framework update. Existing
public imports remain supported.
