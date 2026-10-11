---
id: zero.guides.application-ui-development
type: how-to
audience: [agent, developer, maintainer]
owner: frontend
status: draft
visibility: internal
system: frontend
feature: application-ui-development
maturity: supported
applies_to: ["2.6.0 working source; application theme default; upgrades unreleased"]
modes: [browser, SSR, Guardian single, Guardian multi, single-database, Fabric]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "335b27372b0b8ef57a1e92cf93cec378923fe50b"
  snapshot: dirty
  date: "2026-10-10"
  evidence_level: source-observed
---

# Application UI Development

[Guides index](./index.md) · [Frontend index](../frontend/index.md) · [Documentation index](../index.md)

Use this workflow for dashboards, administration, settings and authenticated
workspaces—the application UI sometimes called the “backend UI.” It is still
browser presentation, not server service implementation. Compose compact,
readable interfaces through Zero's existing APIs, with one runtime and clear
data owners. Public content follows [Public UI development](./public-ui-development.md).

New theme and interaction options describe working source, not availability in
an older installed package. Read a family's exact manual before using its props;
check the target package during an upgrade.

The [UI reference](../frontend/ui-reference.md) is the canonical starting point
for component facades/parts, tokens, typography and action-to-animation choices.
This guide applies those contracts to an application assembly workflow; it does
not define another set of defaults.

For library maintenance or a deliberate source copy, consult
[source organization](../frontend/components/source-organization.md). It locates
canonical implementations separately from stable application imports and explains
the dependency, customization and documentation checks required for a move.

## Identify The Owners Before Editing

1. Find the existing root layout, provider, router and shell. Reuse them; do not
   mount another client, socket, ModalManager or sidebar provider per feature.
2. Identify the authorized source and scope: complete local data, a complete
   reactive collection, or a server-owned query. A paged cache is not all results.
3. Identify the operation that accepts each action. Return its promise; local
   optimistic paint, a toast or an animation is not an accepted-write receipt.
4. Use supported package facades or deliberate app-owned copies, never `#zero`
   or inferred private `node_modules/src` imports.

[AppProvider](../frontend/runtime/app-provider.md) normally integrates the SDK,
router, Sync and browser modal host. ThemeProvider and NotificationProvider are
optional, not automatically installed. Reuse the chosen composition rather than
adding every provider. [Scope transitions](../frontend/runtime/scope-transitions.md)
retire old rows, drafts, selections and overlays; app-owned async work must also
fence late completions. Guardian and server policies remain the access authority.

## Choose A Facade Or Its Parts

Start with an assembled organism when its workflow fits. Use its public parts
when layout differs, and documented slots/styles for custom presentation. Do not
infer universal `loading`, `size` or action props across unrelated APIs.

| Task | Facade or parts | Full contract |
| --- | --- | --- |
| Application frame | AppShell; public header/sidebar parts only when their prerequisites are intentional | [Shell](../frontend/app-shell/index.md), [configuration](../frontend/app-shell/configuration.md), [presets](../frontend/app-shell/presets.md). |
| Search, sort, filter and paged records | DataTable with the right source adapter, toolbar and action slots | [Sources](../frontend/data-controls/data-table/sources.md), [table API](../frontend/data-controls/data-table/configuration.md), [motion/live updates](../frontend/data-controls/data-table/motion-and-live-updates.md). |
| List beside a selected record | MasterDetailPage or ListDetailLayout and its panel/action parts | [Master-detail](../frontend/data-controls/master-detail.md), [layout parts](../frontend/components/primitives/list-detail.md). |
| Create or edit a resource | Form controllers/renderers or CrudPage, not a new generic mutation wrapper | [Forms](../frontend/forms/index.md), [CRUD](../frontend/data-controls/crud-page.md). |
| Identity with separate trailing controls | DenseList; related settings use SettingsMatrix or IntegrationSettingsList | [Rows](../frontend/components/dense-list.md), [matrix](../frontend/components/settings-matrix.md), [integrations](../frontend/components/integration-settings-list.md). |
| Single, searched or hierarchical choice | Select parts, Combobox facade or Cascader facade | [Select API](../frontend/components/controls/select.md), [other choices](../frontend/components/primitives/choices.md), [Cascader](../frontend/components/cascader.md). |
| Actions versus a small editor | DropdownMenu parts for commands; Popover parts for ordinary interactive content | [Dropdown](../frontend/components/overlays/dropdown-menu.md), [Popover](../frontend/components/overlays/popover.md). |
| Calendar, date or time input | Existing date/time facade and declared calendar parts | [Dates and time](../frontend/components/primitives/dates-and-time.md). |
| Summary or managed quick look | Composable Card parts; ContentCard facade with deliberate details body | [Card anatomy and API](../frontend/components/surfaces/card.md). |
| Workflow or dangerous decision | `modals.show`, confirm/alert/prompt facade and managed body/actions | [Modals](../frontend/modals/index.md), [options](../frontend/modals/configuration.md), [hold confirmation](../frontend/modals/confirm.md). |
| Noninteractive explanation | Tooltip parts or grouped facade; use Popover for controls | [Tooltip](../frontend/components/overlays/tooltip.md). |

The [component index](../frontend/components/index.md),
[primitive manuals](../frontend/components/primitives/index.md) and
[overlay manuals](../frontend/components/overlays/index.md) route the remaining
public building blocks and exact configuration. Domain interfaces—
[Guardian](../frontend/guardian/index.md), [Data Studio](../frontend/data-studio/index.md),
[Storage](../frontend/storage/index.md), [Notifications](../frontend/notifications/index.md)
and [Torrent](../frontend/torrent/index.md)—retain their dedicated manuals.
A private layout/helper block is documented with its parent family, not presented
as a standalone public API merely because it lives in a separate source file.
Every new reusable public part needs a full reference and an index route before
its adoption is called documented.

## Keep The Workspace Compact And Truthful

Preserve AppShell's polished sidebar, magnetic navigation, animated icons and
collapse behavior. Use its header/action slots and coherent sections rather
than oversized, mostly empty cards around each operation. Dashboard-style presets
default to bounded `contentMode="workspace"`; choose `document` for a genuinely
growing page. Preserve `min-h-0 min-w-0 flex-1` through extra wrappers and let the
chosen table/list/detail family own scrolling. [File routes](../frontend/router/file-routes.md)
own layout/access boundaries, not the visual shell.

Prefer the accepted SDK/resource/form contracts. [Mutation receipts](../frontend/sdk/acknowledged-mutations.md)
settle the exact operation; callback notification failure after acceptance must
not repeat the write. Controlled open state closes an editor only after its save
contract admits success. Browser abort/timeout does not prove server rollback.
[Reactive control plane guide](./reactive-control-plane.md) explains source, selection,
detail and action composition without duplicating query or permission owners.

## Apply Tokens And Typography At Their Boundary

Import `@zero/framework/styles.css` once in an app-owned CSS pipeline, or use the
[managed style build](../frontend/design-system/style-build.md). AppShell defaults
to the scoped next foundation and compact density; custom frames need an explicit
[next boundary](../frontend/design-system/foundation-next.md#activate-an-explicit-boundary).
Do not move that marker to the document root to restyle unrelated public pages.
Light/dark/system selection stays with the existing theme owner.

Use semantic surface, text, border and state roles, not a palette per page.
`@zero/framework/design-system` is a pure token/recipe facade; it does not load
CSS, fonts, providers or services. Consult [tokens](../frontend/design-system/tokens.md),
[lanes](../frontend/design-system/lanes.md) and [typography](../frontend/design-system/typography.md).

Choose page/section, ordinary/support, control, metric or specialized analytical
roles according to the content's job. Semantic heading level follows the document
outline, not visual size. Text/Heading are optional native consumers, not wrappers
required around controls. Use declared slots, classes/styles or role variables
for local tuning; avoid deep
private-DOM selectors. Fonts/custom contrast need actual qualification. Original
theme files stay until the [retirement gates](../frontend/design-system/foundation-next.md#retire-the-original-theme-safely)
are met; activating next does not authorize deleting `globals.css`.

## Preserve Task Specific Motion And Native Scrolling

Apply the [UI reference's action-to-animation rules](../frontend/ui-reference.md),
not a blanket spring around every component. Select's list morph, ordinary
anchored entrance, managed dialog/Card details and Tooltip/chart inspection are
deliberately different recipes. Preserve each family's owner and explicit approved
override. Magnetic material moves beneath stationary labels; it does not create
another selected-value state. Native focus/value updates and accepted actions
must not wait for decorative presentation. [Modal motion](../frontend/modals/motion.md)
also distinguishes the duration multiplier from real safety/request timing.

Use [Arc-style ScrollArea](../frontend/components/primitives/scroll-area.md) for
ordinary bounded bodies. Long generic Popovers use explicit
[PopoverViewport](../frontend/components/overlays/popover.md#long-content-without-nested-scrolling),
with fixed chrome outside. Select, DropdownMenu, CommandList and pickers already decorate
their actual viewport: never wrap them again. Tables, bottom-following streams
and chart progress retain separate contracts. Reduced motion removes decorative
travel, not real hold-confirm safety or operation timing. An explicit approved
component motion override stays authoritative; do not layer another animator.

Older ContextMenu and custom-calendar surfaces need their own presentation
qualification; the shared recipe is not evidence that every override has migrated.

## Choose Charts By The Measurement

Start with the [Zero Charts subsystem guide](../frontend/charts/index.md) for the
shared API, reactive bridge and complete family/manual index. Choose Sankey for
aggregate flow, Race Bar for ordered ranking history, Funnel for conversion
cohorts, Arc for its focused analytical organisms, or handmade/native charts for
quantitative, mixed, statistical, polar, financial and observed-time geometry.
The selected family's full manual owns its exact data and settings contract.

`/components/charts` owns presentation, `/charts` pure models and `/charts/react`
the existing authorized `useChartQuery` bridge, all beneath `@zero/framework`.
ZeroChart dispatches a typed organism, not a universal source. Use bounded complete
aggregates, stable IDs, units and a measurement window; readable cache or connection
does not prove baseline completeness. ReactiveDB, Fabric and database automations
own reads/aggregate maintenance. Preserve missing values, exact-data companions
and freshness labels. [Existing Recharts](../frontend/components/primitives/charts.md)
remains supported; replacement is an explicit consumer choice.

[Vector/ingestion visualizations](../frontend/components/vector-visualization.md)
observe an actual operation ID. Dots, stages and receipts come from accepted state;
particles or paused motion do not acknowledge ingestion.

## Review The Actual Consumer

- Check SSR/hydration, focus return, keyboard/touch/RTL, light/dark, reduced motion,
  narrow/zoomed layouts, empty/loading/error and genuine overflow in the target app.
- Exercise pending/rejected/accepted writes and tenant replacement with open
  editors, menus and child dialogs; never automatically repeat an uncertain effect.
- Check installed exports and copied CSS/helper closure using
  [source ownership](../cli/tooling/source-copy.md) and
  [Doctor upgrade auditing](../cli/doctor/source-audit.md#upgrade-auditing).
- Preserve customized copies, explicit motion and legacy compatibility until
  reviewed. Folder cleanup must not break supported imports or context identity.
- Record remaining visual/accessibility gaps and follow [verification](./verification.md);
  static checks alone do not certify a real screen.
