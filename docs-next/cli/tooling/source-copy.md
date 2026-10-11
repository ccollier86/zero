---
id: zero.cli.tooling.source-copy
type: reference
audience: [developer, agent, operator]
owner: cli-tooling
status: draft
visibility: internal
system: cli-tooling
feature: source-copy
maturity: supported
applies_to: ["2.6.0 working source; next-theme target opt-in; publication qualification pending"]
modes: ["Bun package-mode applications", "trusted local development"]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "335b27372b0b8ef57a1e92cf93cec378923fe50b"
  snapshot: dirty
  date: "2026-10-10"
  evidence_level: source-observed
---

# Source-Copy Registry And Ownership

[Tooling index](./index.md) · [Documentation index](../../index.md)

The static addable registry includes these source families:

| Target group | Targets |
| --- | --- |
| Auth and data controls | components/auth, components/data-table, components/master-detail, components/storage, components/secret-field |
| Page/public presentation | components/animated-list, components/bento-grid, components/code-block, components/cta, components/expandable-card, components/faq, components/features, components/footer, components/hero, components/kanban, components/navbar, components/text-effects, components/streaming-text |
| Shared utilities | hooks, modals |
| Anchored controls | components/popover, components/dropdown-menu; Select/Command/ScrollArea remain dynamic components/ui targets |
| Experimental next theme | theme-foundation: pure design-system source plus scoped supplemental CSS, with no automatic activation |

The installed source registry is authoritative; do not infer a copy target from
every package export. The dynamic form `components/ui/<name>` chooses an
existing primitive under that source directory. `--list` is the discovery
surface, not a capability-query service.

Copy planning recursively follows eligible `components`, `hooks`, `lib`,
`modals` and `design-system` source imports. Public framework service/schema/runtime imports
stay package-owned after rewriting; source-local implementation symbols do not
become supported app APIs simply because the source is visible.

Family organization retains historical import paths as thin forwards. The
copy queue also follows a bounded manifest of former helper/CSS dependencies
whenever it encounters those files, including transitively through another
component. For example, copying DataTable preserves old Select helper destinations
without a separate Select request. Fresh canonical implementations are included
as required, but customized old files remain untouched by default. See
[source organization](../../frontend/components/source-organization.md) for
current owners and the migration rules; new folder names are not new addable IDs.

`theme-foundation` additionally copies `frontend/styles/theme-next.css` through
an explicit companion-asset declaration. It does not copy or replace legacy
`globals.css`, activate a theme boundary, edit CSS imports or execute app config.
Existing files are skipped unless `--force` is supplied. Follow the
[next-foundation guide](../../frontend/design-system/foundation-next.md) for
manual activation; copying source alone does not change presentation.

Anchored controls recursively copy their component-owned motion/highlight/scroll
CSS sidecars through relative imports. A browser bundler emits those assets;
include the emitted CSS as well as JavaScript in an app-owned pipeline. This
does not copy legacy `globals.css` or turn source-local helpers into public APIs.
The app still supplies its semantic token/Tailwind stylesheet. Existing copied
files remain app-owned and are skipped rather than silently overwritten.

The supported `components/context-menu` target copies the standard Arc content
adapter, explicit viewport, owner bridge, CSS and shared internal dependencies
alongside the retained original menu engine. `components/ui/date-picker` copies
its new facade and the unchanged picker/Calendar owners; the same dependencies
are included when DatePicker is reached transitively through DataTable. There is
no inferred `components/ui/context-menu` target or focused public date-time
family entry. Inspect the actual registry/plan rather than constructing a route
from a physical folder name. Repeat copies still skip customized originals by
default; neither adoption authorizes `--force` or application-config changes.

For copied DataTable source, the pure query helpers remain package-owned through
`@zero/framework/react/query-params`. The copy engine uses this focused public
subpath for `stableValueKey`, filter encoding and their data-query types; it does
not copy frontend client internals or assume every helper is on the broad React
facade. The module encodes query state only: it does not fetch data or grant
authority. See [server-driven tables](../../frontend/data-controls/data-table/server-sources.md)
for the authenticated adapter and query contract.

Copied `InlineEditText` and form/save hooks retain live authorization checks
through `@zero/framework/react/authorization-scope`. The exact module rewrite
preserves scope/readiness helpers without copying the client implementation or
assuming those lower-level helpers are exported by the broad React facade.
Keep the matching framework package installed. These are UI admission/result
fences, not permission decisions; [scope boundaries](../../frontend/runtime/authorization-scope-boundary.md)
describe their opaque keys and retirement behavior.

## Choosing Package Or Source Ownership

A maintained package import inherits future platform corrections and style
contracts. A copied component permits deliberate deep customization but needs
app-owned verification and upgrades. Do not copy auth/service enforcement to
bypass the canonical backend. UI visibility is not authorization.

For specific target use [add](./add.md), inspect the installed registry before
copying and review [package updates](./update.md) separately. The
[design system](../../frontend/design-system/index.md) owns component/style
conventions; a copied component must still use the same semantic tokens.
