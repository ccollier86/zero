---
id: zero.guides.ui-upgrade
type: operations
audience: [developer, agent, maintainer]
owner: frontend-components
status: draft
visibility: internal
system: frontend
feature: ui-upgrade
maturity: experimental
applies_to: ["2.6.0 source on feature/ui-next-upgrade; unreleased application UI migration"]
modes: [browser, SSR, application, public-pages, package-imports, source-copy]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "645295dd1300164d31df52e80509eaff9f6903ee"
  snapshot: dirty
  date: "2026-10-13"
  evidence_level: source-observed
---

# Zero UI Upgrade and Migration Handoff

[Guides index](./index.md) · [UI reference](../frontend/ui-reference.md) · [General upgrade guide](./upgrade.md)

Upgrade an existing application to the new Zero presentation system on an
application feature branch. Install a pinned framework snapshot, inventory the
application's actual consumers, then migrate and test one family at a time.
Keep the original implementations and theme available until the application
comparison is approved. Pantheon is the intended first representative app;
this handoff does not mean that Pantheon has already been upgraded.

The framework source branch is **`feature/ui-next-upgrade`** in
`ccollier86/zero` (`origin` in the Zero workspace). It carries the existing
modal, Tooltip and DataTable commits plus the newer theme, typography, chart,
control, scroll, vector-visualization and document-editor work. It is a source
checkpoint, not a new registry release. The package version remains `2.6.0`;
that version alone cannot identify these changes. Record the resolved branch
commit and archive checksum before installing it.

## Read These References First

| Reference | What it owns |
| --- | --- |
| [UI reference](../frontend/ui-reference.md) | Canonical token, typography and action-to-animation rules; system and primitive index. |
| [Application UI development](./application-ui-development.md) | Compact dashboards, AppShell, service-backed composition and agent development rules. |
| [Public UI development](./public-ui-development.md) | Public pages, reading hierarchy and deliberate visual stories; not blanket dashboard restyling. |
| [Source organization](../frontend/components/source-organization.md) | Current physical owners, stable public facades and copied-source compatibility. |
| [Doctor source and upgrade audit](../cli/doctor/source-audit.md) | Actual static coverage, target inspection, findings and limitations. |
| [General upgrade guide](./upgrade.md) | Package provenance, rollback and separate authority/data migrations when upgrading an older platform baseline. |

Use a system's assembled component or API for ordinary tasks. Read its focused
manual before using exported parts or overrides. A folder location is not a
public import contract: application code must not import `#zero` aliases,
private helpers, the modal store or internal animation controllers.

## Component and Documentation Map

### Foundation and Application Frame

| Changed area | Supported entry and implementation location | Full documentation and adoption |
| --- | --- | --- |
| Next theme foundation | `@zero/framework/design-system`; [source facade](../../src/design-system/index.ts). Styles live in `src/frontend/styles/`. | [Next foundation](../frontend/design-system/foundation-next.md), [style build](../frontend/design-system/style-build.md), [token reference](../frontend/design-system/tokens.md). AppShell and managed builds default to next; the original foundation remains. |
| Typography and native text consumers | `@zero/framework/components/typography`; [Text and Heading facade](../../src/components/typography/index.ts). Recipes: [theme-typography.ts](../../src/design-system/theme-typography.ts). | [Typography](../frontend/design-system/typography.md). Apply page, section, support, control, metric and analytical roles. Semantic heading level follows the outline. Text/Heading are optional; do not wrap every control. |
| AppShell and Sidebar | `@zero/framework/components/app-shell`; [AppShell](../../src/components/app-shell/app-shell.tsx), [Sidebar](../../src/components/animate-ui/components/radix/sidebar.tsx). | [AppShell](../frontend/app-shell/index.md), [configuration](../frontend/app-shell/configuration.md), [Sidebar](../frontend/components/overlays/sidebar.md). Preserve magnetic navigation, animated icons and collapse/icon-only behavior; adopt compact layout without rebuilding the shell. |

### Dialogs, Floating Surfaces and Controls

| Changed area | Supported entry and implementation location | Full documentation and adoption |
| --- | --- | --- |
| Modal and dialog system | `@zero/framework/modals`; [facade](../../src/modals/modal-events.ts), [host](../../src/modals/modal-manager.tsx), [public contracts](../../src/modals/modal-system.types.ts). | [System overview](../frontend/modals/index.md), [migration](../frontend/modals/migration.md), [manager](../frontend/modals/modal-manager.md), [configuration](../frontend/modals/configuration.md), [layouts](../frontend/modals/layouts.md). Prefer `modals.show`, or `ControlledModal` for an existing controlled owner. Feature code supplies content/actions, not a copied frame. |
| Modal forms, decisions and progress | Same modal facade; existing form, record and workflow adapters. | [Forms](../frontend/modals/forms.md), [confirm](../frontend/modals/confirm.md), [prompt](../frontend/modals/prompt.md), [hold button](../frontend/modals/hold-button.md), [workflow progress](../frontend/modals/workflow-progress.md), [scope transitions](../frontend/modals/scope-transitions.md). Preserve accepted writes, dirty guards and exact ownership. |
| Tooltip | `@zero/framework/components/tooltip`; [family facade](../../src/components/tooltip/index.ts) and its existing styled/primitive adapters. | [Tooltip manual](../frontend/components/overlays/tooltip.md). Grow/400ms and arrow-on defaults; rich descriptions/shortcuts, groups, overflow-only hints, collision handling and owner-aware portals. Do not put interactive controls inside a tooltip. |
| Morph Select | `@zero/framework/components/ui/select`; [canonical Select family](../../src/components/controls/select/index.ts), with the retained `ui/select.tsx` forward. | [Select manual](../frontend/components/controls/select.md). Existing controlled value and item contracts remain. Use the documented groups, labels, separators and custom rows rather than native selects styled independently. |
| Popover | `@zero/framework/components/popover`; [canonical family](../../src/components/surfaces/popover/index.ts). | [Popover manual](../frontend/components/overlays/popover.md). Trigger-facing motion, owner-aware portal/theme and explicit `PopoverViewport` for long generic bodies. Fixed chrome stays outside the viewport. |
| DropdownMenu and ContextMenu | `@zero/framework/components/dropdown-menu`, `@zero/framework/components/context-menu`; [Dropdown family](../../src/components/dropdown-menu/index.ts), [ContextMenu family](../../src/components/context-menu/index.ts). | [DropdownMenu](../frontend/components/overlays/dropdown-menu.md), [ContextMenu](../frontend/components/overlays/context-menu.md). Preserve native item/submenu semantics, magnetic material and the declared animation recipe. Scroll operations belong to the actual viewport, not the semantic content ref. |
| Calendar and date/time pickers | Stable `@zero/framework/components/ui/*` entries; [canonical date/time family](../../src/components/controls/date-time/index.ts). | [Dates and time](../frontend/components/primitives/dates-and-time.md). Preserve native selection, caption/date rolls and magnetic date paint. Days/months and the virtual year list have different scroll owners. |
| Card composition and expanding detail | `@zero/framework/components/ui/card` and `@zero/framework/components/ui/content-card`; [canonical Card family](../../src/components/surfaces/card/index.ts). | [Card manual](../frontend/components/surfaces/card.md). Existing parts remain; media, byline, metadata, status, section and action parts standardize assembly. `ContentCard` uses managed details; do not duplicate live forms in its thumbnail and expanded body. |
| Arc scroll treatment | `@zero/framework/components/ui/scroll-area`; [public facade](../../src/components/ui/scroll-area.tsx), private geometry in `src/components/_internal/scroll-viewport/`. | [ScrollArea](../frontend/components/primitives/scroll-area.md). Native scrolling with intelligent edge fades and overlay rails. Already-owned picker/menu/command viewports must not be wrapped in another ScrollArea. |
| FloatingButtonGroup | `@zero/framework/components/floating-button-group`; [canonical family](../../src/components/controls/floating-button-group/index.ts). | [Full manual](../frontend/components/controls/floating-button-group.md). Compact commands with magnetic material, native keyboard navigation and shared tooltips. `variant="floating"` selects material; it does not position or portal the tray. |
| Structured document editor | `@zero/framework/components/json-editor`; [facade](../../src/components/json-editor/index.ts), [Tree/Code organism](../../src/components/json-editor/json-document-editor.tsx). | [Editor manual](../frontend/components/json-editor.md). Adopt `DocumentEditor` for JSON/YAML/TOML/literal `.env`, or `JsonDocumentEditor` for JSON-facing consumers. Retained `JsonEditor` is not silently replaced. |

### Charts and Reactive Visualization

| Changed area | Supported entry and implementation location | Full documentation and adoption |
| --- | --- | --- |
| Chart system and typed dispatcher | `@zero/framework/components/charts`; [component facade](../../src/components/charts/index.ts), [ZeroChart](../../src/components/charts/zero-chart.tsx). | [Zero Charts API and family index](../frontend/charts/index.md). `kind` selects a typed organism, not a universal fetcher or data shape. |
| Sankey | Same component entry; `src/components/charts/sankey/`. | [Sankey](../frontend/charts/sankey.md): weighted ribbons, particles, node/link inspection, source mixing and exact data companion. Aggregate traces assume proportional mixing, not per-person paths. |
| Race Bar | Same component entry; `src/components/charts/race-bar/`. | [Race Bar](../frontend/charts/race-bar.md): rankings, overtakes, period playback and scrubbing. Playback is not a stream of new records. |
| Funnel | Same component entry; `src/components/charts/funnel/`. | [Funnel](../frontend/charts/funnel.md): consistent-cohort counts, segment views, inspection and particles. |
| Arc chart family | `@zero/framework/components/charts/arc`; [family facade](../../src/components/charts/arc/index.ts). | [Arc manual](../frontend/charts/arc.md): Line, Bar, Donut, Streamgraph, Brush, Waffle, Slope, Sparkline, Gauge, Activity Heatmap, Ridgeline and Treemap. |
| Native analytical family | `@zero/framework/components/charts/native`; [family facade](../../src/components/charts/native/index.ts). | [Native manual](../frontend/charts/native.md): Cartesian/composed, statistical, financial, matrix, polar and observed-time charts. Choose geometry by the measurement, not by a similar-looking name. |
| Pure chart models and reactive query bridge | `@zero/framework/charts`, `@zero/framework/charts/arc`, `@zero/framework/charts/native`, `@zero/framework/charts/react`; [pure facade](../../src/charts/index.ts), [query bridge](../../src/frontend/client/chart-query.ts). | [Charts data contract](../frontend/charts/index.md). Use authorized, bounded complete aggregates; one table page or a partial cache is not a complete chart source. Triggers/functions/Fabric retain data and acceptance ownership. |
| Ingestion and vector search | `@zero/framework/components/vector-visualization`; [organisms](../../src/components/vector-visualization/index.ts). Backend: `@zero/framework/vector/visualization`, [facade](../../src/vector/visualization.ts). | [Component manual](../frontend/components/vector-visualization.md), [backend integration](../backend/vector/visualizations.md). Observe actual operations with explicit configuration/permissions. Do not enable this service just to change the theme, or fabricate completion from an animation. |
| DataTable live presentation | `@zero/framework/components/data-table`; [family facade](../../src/components/data-table/index.ts). | [DataTable](../frontend/data-controls/data-table/index.md), [footer/progress](../frontend/data-controls/data-table/controls.md), [motion/live updates](../frontend/data-controls/data-table/motion-and-live-updates.md), [server sources](../frontend/data-controls/data-table/server-sources.md). Reactive totals/page counts, initial reveal/overflow fixes and sort-aware new-record navigation are part of this branch's history. |
| Table management / Data Studio | `@zero/framework/components/data-studio`; [workspace](../../src/components/data-studio/data-studio-workspace.tsx), internal catalog in the same family. Connected `DataStudio` is also at `@zero/framework/react`. | [Workspace/catalog](../frontend/data-studio/workspace.md), [options](../frontend/data-studio/configuration.md), [managed dialogs](../frontend/data-studio/dialogs.md). Catalog-first entry, empty-start create flow, direct initial-table option, and retained in-table dropdown. |
| Storage management | `@zero/framework/components/storage`; [workspace](../../src/components/storage/storage-studio-workspace.tsx), native and retained legacy adapters in `src/components/storage/`. | [Workspace](../frontend/storage/storage-studio-workspace.md), [controller contract](../frontend/storage/controller-contract.md). Standard manager forms/prompts/hold-confirmations now carry real triggers; standalone workspace gets a single-scene fallback host. No backend storage migration is required for the presentation fix. |

Broader public React imports remain at `@zero/framework/react` and the framework
root where documented. Prefer focused entries during migration to make family
and name ownership clear. Arc `LineChart` is distinct from native `XYLineChart`;
retained Recharts `LineChart` is a different renderer and input contract again.

## Defaults and Behavior to Preserve

The application foundation uses compact dashboard roles, not oversized empty
cards or a global density rewrite. Keep AppShell's existing navigation behavior.
Use semantic token roles instead of copying reference hex values into each page.
The pure design-system API does not load CSS, download fonts or install services.

Motion follows the task, as specified in the [UI reference](../frontend/ui-reference.md):

- Managed dialogs default to From Button, reverse entrance, dim plus blur,
  page recession and `durationMultiplier: 1.5`. A valid initiating trigger enables
  origin motion; otherwise the default fallback is Rise. The multiplier stretches
  timings; it does not mean 1.5 times faster.
- Select uses its own trigger-to-list morphology and magnetic row material.
  Ordinary trigger-anchored Popovers/pickers use their established anchored recipe.
  ContextMenu's explicit pointer-anchored recipe is not replaced by modal motion.
- Ordinary Tooltips keep Grow/400ms and arrow-on defaults. Chart inspectors keep
  their analytical feedback and shared overlay integration, not the ordinary
  tooltip's full entrance on every pointer move.
- Card details, chart transitions, number changes and Sidebar navigation keep
  their family-owned recipes. Explicit approved overrides remain authoritative.
- Reduced motion removes decorative travel/blur/particles. It must not shorten
  hold-to-confirm safety, invent completion or bypass accepted-write admission.

Ordinary bounded surfaces use the Arc scroll treatment on their real native
viewport. Header, footer, borders and stationary actions remain outside its mask.
Tables, virtual lists, bottom-following streams and chart progress retain their
specialized contracts. A second scroll wrapper is not a fix for a partial item.

### Live-Test Refinements (October 13)

These fixes belong to the same framework feature branch; include them when
resolving/pinning the snapshot instead of installing an earlier archive solely
because it also says `2.6.0`:

- DataTable's existing native viewport now chains to the nearest page/ancestor
  scroller at its top/bottom, and a fitting table does not trap page gestures.
  Both axes get overflow-aware fades; horizontal scrollbar chrome stays opt-in.
  Footer Next/Previous uses directional whole-page motion, including delayed
  server/cached pages, without replaying initial reveal.
- Resting Select uses the expanded popover material and a dedicated
  `--zero-theme-picker-trigger-radius` (18px); the global compact input radius
  stays 6px. Its shrink calibration is unchanged, but the paint/selected-label
  handoff completes at visual landing rather than waiting for invisible spring
  residuals. Table-search focus has a thin cue instead of a thick offset ring;
  keyboard and forced-colors focus remain available.
- Connected DataStudio starts at a searchable table catalog. `initialTableId`
  enters an admitted table directly; `autoSelectFirstTable: true` retains former
  initial auto-entry. Custom `useDataStudio` workspace owners can set it false.
  `selectTable(null)` returns to the catalog, and the dropdown stays in the editor.
- DataStudio/Storage already used the manager. The correction is trigger
  provenance and standalone host/label wiring, not a new modal API or write path.
  Keep controller authority, revisions, dirty/receipt ownership and hold-to-delete.

Apps consuming packaged controls receive these changes when their pinned package
is replaced. Apps with copied controls must review/update the corresponding
source closures, not wrap an old viewport or duplicate a new modal frame. No
original theme, shell or retained implementation is deleted by this refinement.

The new-record indicator is actionable only when admitted arrivals belong before
the current leading row under the table's actual sort contract. Then it can return
to page one/top. Otherwise it reports the arrival count without implying that
navigation would reveal those records. Keep exact/reactive totals and the
pagination percentage honest when another page is added.

## Planned Work Is Not an Upgrade Prerequisite

| Area | Status and instruction |
| --- | --- |
| Managed drawer and BottomSheet with detents | [Planned separately](../_work/drawer-bottom-sheet-system-plan.md). Existing Sheet remains; do not invent a new drawer facade or call a bottom-positioned modal a detent sheet. |
| Arc TagInput, PhoneInput, MentionInput and InlineEdit refresh | [Documentation-only modernization plan](../_work/arc-input-modernization-plan.md). Existing TagInput, PhoneInput and InlineEditText remain usable. A new MentionInput integration is not shipped by this checkpoint. |
| Universal NumberField and reusable rolling-number facade | [Planned numeric work](../_work/number-field-rolling-number-plan.md). Existing table/number presentation does not prove these proposed exports exist. |
| Further file/folder organization | [Explicitly deferred](../_work/frontend-component-organization-plan.md#current-scope-hold). Preserve qualified moves and compatibility forwards already present; do not resume the larger cleanup during an app upgrade. |
| Original implementation/theme removal | Requires replacement testing and explicit approval under the [retirement gates](../frontend/design-system/foundation-next.md#retire-the-original-theme-safely). |

These entries prevent a migration agent from turning a working-source handoff
into a larger component implementation project. Arc provenance and license
review also remain explicit in the [Arc manual](../frontend/charts/arc.md); free
availability is not permission to discard attribution requirements.

## Obtain and Pin the Framework Branch

Framework and application Git repositories are different ownership boundaries.
**Do not merge the Zero framework branch into the Pantheon application repo.**
Fetch/check out the framework, then update the application's dependency or
deliberately adopted source copies.

From the existing Zero repository, first inspect both worktrees and local changes:

```sh
git status --short
git worktree list
git fetch --no-tags origin feature/ui-next-upgrade
UI_NEXT_COMMIT="$(git rev-parse origin/feature/ui-next-upgrade)"
git show --no-patch --format='%H %s' "$UI_NEXT_COMMIT"
git log --oneline origin/main.."$UI_NEXT_COMMIT"
```

Record the full resolved commit and keep the same shell for the next command.
Use a clean isolated checkout rather than packing a busy shared worktree.
The following example uses a new external-volume
directory; if it already exists, inspect it and choose another unused path:

```sh
git worktree add --detach \
  /Volumes/code-bank/code/ai-servers/zero-platform-ui-next \
  "$UI_NEXT_COMMIT"
```

In that checkout:

```sh
git status --short
git rev-parse HEAD
bun --no-env-file install --frozen-lockfile --ignore-scripts
mkdir -p /Volumes/code-bank/artifacts/zero-platform/dev/ui-next-upgrade
bun --no-env-file pm pack --ignore-scripts \
  --filename /Volumes/code-bank/artifacts/zero-platform/dev/ui-next-upgrade/zero-framework.tgz
shasum -a 256 /Volumes/code-bank/artifacts/zero-platform/dev/ui-next-upgrade/zero-framework.tgz
```

Only pack a clean source checkout. Preserve the artifact together with its
commit/checksum; use a distinct output path for later snapshots rather than
overwriting the rollback artifact. Do not run lifecycle scripts, publish a
registry release or merge framework `main` as an implicit part of this procedure.

## Create the Application Feature Branch and Baseline

In the actual application repository, record the current branch/commit,
framework binding/version, lockfile, dependency overrides and source-copy owners.
Record the actual startup/build/test scripts before running them. Existing
configuration, secrets, databases and runtime state are not migration scratch.

```sh
git status --short
git branch --show-current
git rev-parse HEAD
git switch -c feature/ui-next-adoption
```

Proceed from a clean reviewed baseline. If there are unrelated changes, preserve
them and coordinate ownership or create an application worktree; do not reset,
auto-stash, delete runtime data or commit other work to clear the way.

Capture representative screenshots and behavior for the current app: AppShell,
light/dark, tables, settings/forms, menus, open/stacked dialogs and charts. Keep
the old package/archive and lockfile so both code and visual comparison are
reproducible. An older platform baseline may need the [general upgrade](./upgrade.md)
and separate schema/authority work; do not hide that inside a UI-only task.

## Run Doctor Before and After Installation

Use the new framework's Doctor even when the application's older installation
does not understand upgrade flags. From the pinned framework checkout:

```sh
bun --no-env-file src/cli/run.ts doctor \
  --source-only --project-root /explicit/application-directory \
  --upgrade --upgrade-target-root /Volumes/code-bank/code/ai-servers/zero-platform-ui-next \
  --theme-foundation --json
```

Record the report outside runtime/configuration files. Add explicit
`--usage-include` roots for app-owned source outside the default `app`, `src`,
`components`, `hooks`, `lib` and `server` directories. The source-only path does
not import app configuration, connect services, inspect databases, install a
dependency or rewrite code. Review incomplete scan/parse/target coverage before
calling the inventory complete.

After installation, from the application repo:

```sh
bun --no-env-file ./node_modules/@zero/framework/src/cli/run.ts doctor \
  --source-only --project-root . --upgrade --theme-foundation --json
```

Repeat with `--strict` as the static gate after triage. Required errors and strict
warnings must be resolved; manual-review findings need a documented decision.
Recharts inventory is informational by default and does not fail strict mode.
Doctor checks recognizable imports, assets, modal descriptors, theme aliases and
specific scrolling/chart patterns. It does **not** detect every custom wrapper,
infer an unrecorded source-copy baseline, convert chart data, certify visual
layout or make a future upgrade universally safe. Do not silence an entire
family merely to obtain a clean result.

Pay particular attention to [managed close lifecycle findings](../cli/doctor/source-audit.md#managed-close-lifecycle):
an owner-state shortcut can make a dialog open from its trigger but retire before
the reverse exit. Direct local bypasses warn; unresolved delegated guards need
manual review. First-party Data Studio table/record dialogs now use admitted
manager cancellation and acknowledged save actions, including standalone exit
paint. These checks are source-only and do not require the opt-in upgrade catalog.

## Update the Dependency Without Regenerating the App

Choose the application's existing installation model, then keep it consistent.

| Current model | Upgrade procedure |
| --- | --- |
| Managed `file:./.zero/framework/zero-framework.tgz` binding with text `bun.lock` | Use [saved-archive update](../cli/tooling/zero-update.md) after explicitly selecting the recorded artifact, or the verified local-checkout procedure below. Respect updater preflight, lock and rollback reports. |
| Registry or Git dependency | Deliberately pin the reviewed source commit or archive using the existing package-manager/workspace policy. `--latest` cannot select this unreleased branch. Keep overrides and resolved provenance aligned. |
| Copied components or mixed ownership | Update the package where needed, then compare each owned copy separately. An installed package does not refresh app-local files. |

For a managed local-archive app, the new CLI supports a script-free preview and
update from the clean pinned checkout:

```sh
bun --no-env-file /Volumes/code-bank/code/ai-servers/zero-platform-ui-next/src/cli/run.ts update \
  --project /explicit/application-directory \
  --local /Volumes/code-bank/code/ai-servers/zero-platform-ui-next --dry-run
```

After reviewing preflight, repeat without `--dry-run`. The updater preserves its
managed archive/dependency/lock contract; it does not regenerate app source,
change secrets or run a database migration. `--local` includes eligible working
files, which is why the framework checkout must be clean. Do not enable `--check`
until the app-owned scripts it executes have been reviewed. See the complete
[updater contract](../cli/tooling/update.md).

For owned component copies, preview supported targets with the new CLI's
`add <item> --target <directory> --dry-run`. Common targets are `theme-foundation`,
`modals`, `components/charts`, `components/charts/arc`,
`components/charts/native`, `components/typography`,
`components/floating-button-group`, `components/json-editor` and
`components/vector-visualization`. Use the [copy guide](../cli/tooling/source-copy.md)
and [registry](../../src/add/registry.ts) for exact targets and companion files.
Compare candidates in an isolated directory before manually merging a customized
copy. Never run `--force` across a component tree to make imports disappear.
Include the family's CSS and helper closure, not just its top-level JSX file.

## Migrate in Reviewable Slices

### Activate the Theme and Typography

Use the existing managed style build, or import the application stylesheet once:

```css
@import "@zero/framework/styles.css";
```

AppShell supplies the scoped `data-zero-theme="next"` boundary and compact
density. A custom frame needs its own explicit next boundary. Keep public-page
siblings unmarked unless separately approved. Preserve the existing theme owner
and its light/dark/system preference; do not add another provider or mark the
whole document merely to restyle an authenticated screen.

Rebuild frontend artifacts after changing the foundation. An older build without
foundation metadata represents legacy; configuration and compiled assets must
agree. Remove obsolete page-level overrides only after comparing their purpose
with the new roles. Font loading stays with the application.

### Replace Copied Dialog Frames with the Manager

Supply title, description/meta/icon, layout, body, footer and actions through the
descriptor. Remove duplicate app headers, oversized Close buttons, overlapping
X controls and manual portal/z-index/focus code after the owned shell is wired.
Use `context.show` for children. Keep native form targeting and the actual
accepted writer; successful decorative exit is not a persistence receipt.

A complete action-based rename example:

```tsx
import { modals } from '@zero/framework/modals';
import { Input } from '@zero/framework/components/ui/input';

export function openRename({ name, trigger, save }: {
  name: string;
  trigger?: Element;
  save: (name: string, signal: AbortSignal) => Promise<{ accepted: boolean; name: string }>;
}) {
  let draft = name;
  return modals.show<string>({
    title: 'Rename project', size: 'sm', trigger,
    body: context => <label>Project name<Input defaultValue={name}
      onChange={event => { draft = event.target.value; context.setDirty(true); }} /></label>,
    actions: [
      { id: 'cancel', label: 'Cancel', role: 'cancel' },
      { id: 'save', label: 'Save', variant: 'primary', onClick: async context => {
        const next = draft.trim();
        if (!next) { context.setError('Enter a project name.'); return false; }
        const receipt = await save(next, context.signal);
        if (receipt.accepted !== true) { context.setError('The change was not accepted.'); return false; }
        return receipt.name;
      } },
    ],
  });
}
```

Handle `accepted`, `dismissed` and `retired` outcomes explicitly. Adopt
`ControlledModal` when the application's controlled state should retain
ownership. Use the full [form](../frontend/modals/forms.md) and
[migration](../frontend/modals/migration.md) contracts for actual form editors;
do not rename legacy `open` to `show` mechanically. Important deletion decisions
can use the existing hold-confirm options; animation pace never scales the hold.

### Adopt Controls and Real Viewports

Keep current value, native ref, validation and menu selection semantics while
adopting Morph Select, owned Popovers/menus, Card parts and FloatingButtonGroup.
Use documented headers/dividers/icons/trailing controls, with separate native
hit targets rather than a button wrapped around a select or another button.

Review app code reading `scrollTop`, attaching `onScroll` or measuring overflow
on menu Content refs. Focus/dimension access can remain on Content; scrolling
uses the component's actual viewport API. Use `PopoverViewport` for a long generic
panel. Do not wrap Select, CommandList, Cascader or a virtual calendar owner again.
Preserve deliberate custom animations and custom renderers until qualified.

### Migrate Charts by Meaning and Data Contract

Inventory every rendered chart and dependency before changing imports. Pick the
new family and map stable IDs, units, measurement window, missing values, domain,
stacking, controlled selection, inspection and accessible exact values. Native
and Arc names that look similar are not interchangeable prop contracts.

Use `useChartQuery` for a bounded, complete, authorized aggregate collection.
Keep transport, permissions, reactive rollups and accepted mutation state in the
existing Zero SDK/backend owners. Do not add chart-owned polling or treat a table
page as the population. Real vector/ingestion displays additionally require
their explicit service/index/permission configuration and persistence review.

Leave a Recharts consumer intact if its semantics or feature parity have not
been reviewed. Supported legacy charts are not removed APIs. Chart inspectors
must keep the shared Tooltip/overlay integration; interactive drilldowns use a
Popover or managed modal instead of a second chart-specific popup engine.

### Adopt the Source Aware Document Editor

For configuration files use `DocumentEditor`; preserve the retained `JsonEditor`
until its consumers deliberately adopt the new contract. File writers must use
`context.text` and `context.format`, not serialize the JavaScript projection.

```tsx
import * as React from 'react';
import { DocumentEditor, type DocumentFormat } from '@zero/framework/components/json-editor';

export function ConfigEditor({ documentId, initialText, write }: {
  documentId: string;
  initialText: string;
  write: (request: { documentId: string; format: DocumentFormat; text: string;
    signal: AbortSignal }) => Promise<{ accepted: boolean }>;
}) {
  // Mount this owner with key={documentId} when changing document identity.
  const [source, setSource] = React.useState({ format: 'yaml' as DocumentFormat, text: initialText });
  const [raw, setRaw] = React.useState<string | null>(null);
  return <DocumentEditor documentKey={documentId} label="Function configuration"
    format={source.format} sourceText={source.text}
    onSourceChange={({ format, text }) => setSource({ format, text })}
    rawTextDraft={raw} onRawTextDraftChange={setRaw}
    onSave={async (_projection, _patch, { format, text, signal }) => {
      const receipt = await write({ documentId, format, text, signal });
      if (receipt.accepted !== true) throw new Error('The file was not accepted.');
    }} />;
}
```

The application's writer still owns authorization, expected revision and retry
identity. Comment-only changes are real changes; source-native values and exact
JSON/YAML numbers require preservation. `.env` remains literal text without
environment loading or expansion. See the [full manual](../frontend/components/json-editor.md)
for incoming conflicts, pending snapshots, validation and modal editing guards.

## Application Acceptance and Rollback

| Gate | Required evidence |
| --- | --- |
| Dependency and distribution | Recorded framework commit/archive checksum, installed public exports, matching manifest/lock/overrides, built stylesheet/helper closure and reviewed source copies. |
| Static migration | Target-aware Doctor report with coverage gaps resolved or explicitly bounded; required/strict findings fixed; manual decisions documented. App typecheck and production build pass. |
| Presentation | Before/after light and dark screenshots; narrow/zoomed layouts; compact cards/fields; preserved Sidebar behavior; no accidental global public restyle. |
| Interaction | Keyboard/touch/RTL where supported; live reduced motion; real overflow and partial-item fades; stationary chrome; no transient unwanted horizontal scrollbar. |
| Modal and overlay ownership | Parent/child/popup Escape and focus return; close/body separation; guarded dirty drafts; failed/pending actions; identity/tenant retirement; portal/layer correctness. |
| Reactive truth | Real query totals/progress/arrivals; chart completeness and exact companions; empty/loading/error/disconnected/scope-replacement behavior; no fabricated operation completion. |
| Accepted writes | Rejected, accepted, uncertain and stale operations; no repeat side effect after acknowledgment; no newer editor changes falsely marked saved. |
| Rollback | Retained old dependency/artifact/lock and source copies; rebuild under the matching legacy selection; separately proven data restore if enabling services/migrations. |

Application tests are additional to framework qualification. Framework editor
qualification includes 20 browser cases, accepted-save/source tests, public
types, source copying and a production-only archive consumer. Those results do
not prove that a customized Pantheon dialog or chart has migrated correctly.
Run expensive compiler, browser, build and installed-archive jobs sequentially.

For theme rollback, use `themeFoundation="legacy"` on AppShell and matching
`themeFoundation: 'legacy'` for managed builds, or the retained legacy CSS entry
in an app-owned pipeline. Keep the rollback shell outside a next ancestor;
nested legacy markup does not erase inherited variables. Package/source/API
changes need their own code/dependency rollback, not only a theme toggle.

Do not merge or deploy the application upgrade until the comparison is approved.
Original-theme deletion is a separate follow-up after approval, not the final
step of this test migration.

## Prompt for the Application Migration Window

Copy this instruction into the window that owns the target application:

```text
Prepare this application for the Zero UI upgrade on feature/ui-next-adoption.
First read the pinned Zero framework's docs-next/guides/ui-upgrade.md and the
linked UI reference, application guide, modal migration and chart manuals.

Preserve unrelated changes. Fetch the Zero repository's feature/ui-next-upgrade
branch, record its exact commit, and use a clean isolated framework checkout.
Do not merge the framework Git history into this application repository.
Update the app's framework dependency using its existing ownership/update model;
record the selected archive checksum or Git pin. Do not install registry latest
and assume it contains this unreleased UI checkpoint.

Run the new Doctor's source-only upgrade/theme audit before and after installation.
Inventory package imports, app-copied components/CSS, modal frames, legacy charts,
scrolling assumptions and explicit animation overrides. Report unknown coverage.

Migrate theme/typography, modals, controls/scrolling, charts and document editors
in reviewable commits. Preserve the Sidebar, accepted writes, real reactive data,
tenant ownership, exact file source and supported legacy APIs. Follow each
system's full manual; do not build a second modal, tooltip, chart-query or theme
owner. Do not force-overwrite customized copies.

Drawer/BottomSheet, planned Arc input/number work and further folder organization
are outside this upgrade. Keep original components and theme files.
Run app type/build and focused interaction tests, collect before/after screenshots,
and document rollback and any unresolved findings. Stop for approval before
deployment, merging to main or deleting originals.
```

## Related Implementation and Planning References

- [Component index](../frontend/components/index.md) and
  [chart index](../frontend/charts/index.md) route individual manuals and parts.
- [Theme evolution](../_work/design-token-theme-evolution-plan.md),
  [typography plan](../_work/typography-system-plan.md) and
  [Arc audit](../_work/arc-design-language-audit.md) preserve design decisions.
- [Scroll adoption ledger](../_work/arc-scroll-surface-plan.md) and
  [interaction follow-up](../_work/arc-interaction-follow-up-plan.md) distinguish
  qualified owners from future work.
- [Charts plan](../_work/charts-system-plan.md) and
  [vector visualization plan](../_work/vector-visualization-plan.md) retain
  subsystem integration and qualification scope.
