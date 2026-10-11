---
id: zero.frontend-component-organization-plan
type: roadmap
audience: [developer, agent, maintainer]
owner: frontend-components
status: draft
visibility: internal
system: frontend-components
feature: source-organization
maturity: planned
applies_to: ["2.6.0 working source; two incremental UI source/documentation organization passes; larger-family migration staged"]
modes: [browser, SSR, package-imports, source-copy]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "335b27372b0b8ef57a1e92cf93cec378923fe50b"
  snapshot: dirty
  date: "2026-10-11"
  evidence_level: source-observed
---

# Frontend Component Organization Plan

[Working evidence](./index.md) · [Component index](../frontend/components/index.md) · [Component conventions](../frontend/design-system/component-conventions.md)

Organize frontend implementation by component family and responsibility, while
keeping supported package imports and source-copy contracts stable. A physical
move must not change behavior, create another provider/context, lose companion
CSS or overwrite an application's customized copy. Two bounded passes now
organize Card, Select, date/time, Popover, shared overlay mechanisms and frontend
export maintenance. The full chart manuals sit with the Charts overview;
[the durable guide](../frontend/components/source-organization.md) locates current
owners and compatibility rules. The rest of the hierarchy below is staged,
not a claim that all 1,240 baseline component files have been reorganized.

Theme retirement is a separate operation. Follow the
[original-theme retirement gates](../frontend/design-system/foundation-next.md#retire-the-original-theme-safely)
before removing any original stylesheet or token family.

## Current Scope Hold

The user has deferred further file/folder organization until much later. Preserve
the qualified moves and supported facades already in place; do not continue this
roadmap as part of the component readiness work. The immediate slice is approved
new/replaced components, existing design-token consumption and chart-related
Doctor review. Original implementations and theme files remain until replacement
testing and explicit removal approval. Pantheon migration and a broader component
showcase are separate later comparisons. The supplied expanded document reference
adds JSON/YAML/TOML/literal `.env` within the existing focused editor family;
the drawer/sheet system remains a separate subsequent design/implementation.

## Pre-Migration Inventory

The inventory taken before this pass on 2026-10-10 contained 50 directories under `src/components`, plus
one root-level package test. Counts include source, styles, barrels, tests and
browser fixtures; they are not counts of independent components.

| Area | Files | Test files | Browser fixtures |
| --- | ---: | ---: | ---: |
| `src/components` | 1,240 | 275 | 72 |
| `src/components/ui` | 100 | 27 | 10 |
| `src/components/animate-ui` | 188 | 8 | 2 |
| `src/components/charts` | 194 | 44 | 12 |
| `src/components/data-table` | 120 | 39 | 15 |
| `src/components/auth` | 126 | 36 | 4 |
| `src/frontend/client` | 258 | 90 | 2 |

`ui` is a flat catch-all rather than a primitive boundary. It mixes native
controls with Select motion/geometry, calendar/pickers, Card compositions,
notifications, list-detail layouts, record navigation and the retained Recharts
adapter. The pre-migration [frontend facade](../../src/frontend/index.ts) was 1,509 lines,
and 255 of the client directory's 258 files sit directly at its root.

Existing large families already contain useful responsibility boundaries.
[DataTable](../../src/components/data-table/index.ts) separates controllers,
query coordination, mutations, cell editing, views, motion and pagination in
filenames, but its 120 files remain flat. Charts already use more discoverable
family folders and pure model/math, runtime, inspection and organism assembly.

Popover/Dropdown/Sidebar/Tooltip ownership crosses facade, Animate UI styled
adapter, primitive and family helper folders. For example, the
[Tooltip facade](../../src/components/tooltip/index.ts) forwards to a styled
adapter that consumes helpers from the Tooltip family. Those are valid layers,
but their physical owner is difficult to locate.

## Implemented First Pass

These are physical changes, not new application import paths. The production
implementations, family-specific styles/helpers, tests and browser fixtures have
one canonical home. Old production paths are thin forwards; no second context,
status store, modal owner or selection controller was created.

| Family / boundary | Canonical owner now | Retained compatibility and copy destinations |
| --- | --- | --- |
| Card and composable parts | [surfaces/card](../../src/components/surfaces/card/index.ts) | `components/ui/card.tsx`, `card-status.tsx` and `card-presentation.ts` forward to canonical files. Existing `/components/ui/card` and React/root imports remain supported. |
| ContentCard quick look | [ContentCard](../../src/components/surfaces/card/content-card.tsx) and its family skin | `components/ui/content-card.tsx` and `content-card.css` remain forwards; its existing source-copy request retains Card/status/presentation companions too. |
| Direct CardStatus source copy | Same Card family | `components/ui/card-status` still plans both old `card-status.tsx` and `card-presentation.ts` destinations, not only their new canonical closure. |
| Select and its motion/paint/geometry | [controls/select](../../src/components/controls/select/index.ts) | `components/ui/select.tsx` and the five old Select helper/CSS destinations remain forwards. `/components/ui/select` and React/root imports resolve the same native implementation. |
| Root / React frontend facade | [frontend/index.ts](../../src/frontend/index.ts) → curated `exports/{runtime,hooks,controls,layout,data,features,public-content}` maintenance modules | Public names, order, targets, type-only flags and existing external stars remain unchanged. These modules do not add providers, runtime setup or a second public component tree. |

The root frontend facade is now 44 lines. Its 37 maintenance modules have a
largest module of 171 lines. The regression freezes the original 296 ordered
declarations, 1,455 named entries and 14 existing star/type-star declarations,
and compares canonical TypeScript symbol identities against an in-memory
reconstruction of the original facade. Named-entry count is not a count of
independent components.

The repository's broad runtime `data/` ignore pattern would also hide the two
curated frontend data-export modules. A narrow `/src/frontend/exports/data/*.ts`
exception now keeps those source files discoverable without unignoring runtime
data or generated outputs. Future semantic-group moves must check source-ignore
rules as well as TypeScript resolution; a local build can otherwise use a file
that would be missing from the recorded change.

The original stylesheet's fan-in now points at the canonical Card/Select skins;
the old skin files remain CSS import facades for copied/existing consumers.
This is an import-location update, not deletion of the original theme, a change
to its palette, or extraction of its remaining shared infrastructure.

The copy registry retains old request IDs and explicitly includes prior
compatibility companions. Fresh copies add the canonical dependency closure;
repeat copies skip existing files by default, including customized old helpers.
No new overwrite behavior or `--force` authorization was added. A source copy
that already exists remains app-owned until its owner deliberately updates it.

## Proposed Canonical Hierarchy

Use semantic groups, then family-owned folders. Card/Select, date/time, Popover
and shared mechanisms are implemented; remaining relocations below are planned.
These are implementation paths,
not newly supported application imports:

```text
src/components/
  controls/       button, input, select, combobox, calendar, picker families
  surfaces/       card, popover, dropdown-menu, context-menu, tooltip
  navigation/     sidebar, navbar, breadcrumb, pagination, record navigation
  feedback/       notifications, progress, skeleton, status
  layouts/        app-shell, resizable, list-detail, master-detail
  data/           data-table, charts, vector-visualization, kanban
  content/        code-block, streaming-text, typography, kbd
  features/       auth, storage, data-studio, administration and settings
  _internal/      shared motion, overlay scope, scrolling and presentation
```

Each family has a small curated `index.ts`, public composition, prop/types,
model or geometry, runtime/hooks and styles where needed. Keep simple tests
beside their owner. Large browser suites and fixtures can have family-local
`tests/` and `tests/fixtures/` homes; do not create a repository-wide fixture
dump. Allocate generated bundles/screenshots outside source under the project's
documented build/scratch/artifact roots.

Do not force every family into identical empty subfolders. A small Input can
remain a component and test; DataTable can justify `controller/`, `query/`,
`mutation/`, `editors/`, `view/` and `presentation/`. Components assembled from
smaller pieces expose those pieces through the family facade rather than a
global atoms/molecules taxonomy whose labels change when the piece is reused.

Keep these layer boundaries:

- `src/design-system` owns pure token composition, catalogs and CSS generation;
  component families consume it rather than maintaining competing token maps.
- `src/charts` owns chart contracts/math and non-React APIs; visual chart
  organisms remain components. Preserve Arc/native/reference-family distinctions.
- `src/modals` retains its one manager, stack, focus and result owner. Surface
  composition can use it but must not install another modal controller.
- `src/frontend/client` owns SDK/transport/session and service-backed hooks.
  Group it by existing auth, data, storage, chart/vector and routing seams in a
  later pass; moving a component does not move transport logic into rendering.
- Generic `src/hooks` remain separate from service-backed hooks. Browser
  presentation utilities in `src/lib` need explicit ownership, not indiscriminate
  relocation of server/database helpers into a browser shared folder.

`_internal` admits only shared mechanisms with identified consumers, such as
the existing anchored-motion, magnetic-row and native-scroll behavior. It must
not become the next catch-all. Family-specific math/paint stays with its family.
Third-party primitive adapters retain provenance and distinct responsibilities;
their folder name does not establish a second public component system.

## Compatibility Boundaries

[Package metadata](../../package.json) currently has 53 component export-map
keys, including wildcard/deny entries, and 124 exact `#zero/components` aliases.
These are path contracts, not 53 independent APIs. Record the pre-move public
symbol/subpath inventory before redirecting any entry.

| Boundary | Required treatment during a move |
| --- | --- |
| Root and `/react` facade | Preserve public names, prop/ref types and SSR/browser safety. Split maintenance into small curated family export modules without accidentally widening exports. |
| Focused component subpaths and `components/ui/*` | Keep supported paths resolvable through a forwarding file or export-map redirect. New canonical folders do not implicitly become public wildcard trees. |
| Internal aliases | Update actual source imports, package mappings, TypeScript paths and the private-import synchronization policy together. `#zero` remains framework-private, not an app migration target. |
| Context/provider identity | Old and new entrypoints must reference the same canonical implementation. Never copy an implementation to retain a path: that can create a second context, group, store or overlay owner. |
| Tests and fixture denials | Preserve test/spec/browser-fixture export denials; no helper or fixture becomes public merely because a new wildcard matches it. |
| CSS and companion helpers | Update source imports, the stylesheet fan-in, relative paths and copy closure together. Preserve class/slot names and token/motion values during structural work. |
| Generator configuration | Reconcile `components.json`, which currently points at `globals.css` and `ui: "@/components"`, with the chosen canonical/generator policy before generation resumes. |
| Documentation | Update source links, locations, example-harness mappings and navigation per family. Keep API guidance stable where consumer APIs did not change. |

Do not equate same-named files with duplicate implementations. `ui/tabs`,
checkbox, radio-group, switch and progress currently forward to Animate UI;
they are compatibility facades. Native/icon-aware UI Button and the Animate UI
Motion Button have different contracts and need a consumer/behavior comparison
before consolidation. The public-page `ExpandableCards` gallery and managed
`ContentCard` quick look likewise have distinct purposes.

Preserve the polished sidebar/navbar magnetic coefficients, modal origin/Rise,
dim/blur/recede/stack and hold confirmation, Tooltip Grow/arrow, chart inspector
feedback, Select morphology and native scroll ownership. A folder cleanup is
not an animation, density, accessibility or controller redesign.

## Source Copy and Doctor

The [copy engine](../../src/add/copy.ts) currently uses the source-relative path
as the app destination and recognizes `components`, `hooks`, `lib`, `modals`
and `design-system` as app-owned roots. The [registry](../../src/add/registry.ts)
hardcodes family targets and individual `components/ui/<name>.tsx` requests.
Source location, registry ID and app destination are separate decisions. The
first pass preserves IDs/old facade destinations while adding each new canonical
dependency closure; later moves must make the same decisions explicitly.

Preserve existing IDs and their destination behavior, or offer a new explicitly
selected layout with migration guidance. A new ID must not silently replace
customized old files. Qualify exact rewritten helper/CSS closure, dry-run,
skip-existing behavior and intentional `--force` separately. Moving visual
implementation under `src/frontend/components` without updating copy admission
would change ownership/rewrite behavior; do not treat that as a harmless rename.

Doctor's default source-only roots are `app`, `src`, `components`, `hooks`,
`lib` and `server`.
Root-level copied `frontend`, `modals` and `design-system` are not automatically
scanned by those defaults. Changed destinations need explicit discovery/fence
coverage without broadening reads to environment, databases or runtime data.

The [current upgrade catalog](../cli/doctor/source-audit.md#upgrade-auditing)
checks named public exports, known scrolling assumptions and admitted literal
assets. It does not yet prove copied-source provenance, every rename or theme
retirement readiness. Record breaking path changes alongside future catalog
rules and the planned source-copy baseline, not through guesses about filenames
or blanket instructions to recopy an app.

## Delivery Sequence

### Second Pass Plan

The plan below was frozen before implementation after reviewing first-pass
identity checks and the documentation graph. It follows actual dependency owners
rather than treating every similarly animated control as the same component.
Its selected source and manual moves are now implemented and qualified.

| Area | Planned canonical owner | Boundary to preserve |
| --- | --- | --- |
| Calendar and date/time pickers | `components/controls/date-time/` | Move thirteen production/helpers and ten tests/fixtures together; retain all old UI files and the seven existing addable TSX request IDs. Both Calendar contexts must keep identity. The calendar token stylesheet stays with frontend styles. |
| Popover | `components/surfaces/popover/` | Move its styled adapter and Radix primitive, retaining the public facade and old Animate UI paths. Radix still owns placement/focus; no new manager or presence controller. |
| Shared overlay mechanisms | `components/_internal/{overlay-scope,anchored-surface,scroll-viewport,magnetic-highlight}/` | Separate layer/theme ownership, anchored motion, actual native viewport decoration and magnetic material. Retain old overlay helper/CSS paths. Cross-component tests must move with their qualified dependency paths. |
| Chart documentation | `frontend/charts/{sankey,race-bar,funnel,arc,native}.md` | Move all five complete manuals with their existing IDs and twenty-five examples. Old routes become small compatibility pages with preserved section anchors and distinct IDs. Update navigation, working plans and the example harness. |
| Durable organization reference | `frontend/components/source-organization.md` | Document implemented owners and supported import/copy paths separately from this roadmap's future work. |

Source-copy review found a first-pass gap: explicit companions on direct registry
requests do not protect old helpers when a moved facade is reached transitively
from another family. Add one bounded legacy-dependency manifest applied by the
copy queue for every encountered compatibility file. Preserve prior destinations
and default skip-existing behavior; do not sweep entire folders or add overwrite
authorization. Freeze old dependency edges before moving the next families.

Popover, DropdownMenu and Tooltip currently plan fourteen, sixteen and twenty-one
production files respectively; UI ScrollArea plans eight. These are pre-move
copy-plan baselines, not component counts. Retain those old destinations while
adding only the canonical closure required by each target.

Do not consolidate the four existing magnetic owners: Dropdown/Sidebar Highlight,
Command/Calendar/Time MenuActiveHighlight, Select geometry and Navbar each have
distinct behavior and consumers. Dropdown's larger primitive and the shared
Tooltip/Highlight engines remain at their present implementation paths in this
pass. Relocating or unifying those engines needs separate context/lifecycle tests.

- [x] Review first-pass state, actual dependency owners, copy-plan and documentation seams.
- [x] Freeze and implement graph-wide compatibility companion ownership.
- [x] Move date/time and Popover/shared mechanisms with identity forwards.
- [x] Relocate chart manuals and add the durable source-organization guide.
- [x] Qualify unchanged native interaction/motion, copied consumers, installed sources,
  public export identity, private imports and canonical/compatibility doc routes.

No palette, typography, animation timing, server/data owner or theme retirement
change belongs to this organization pass.

Final discovery review also found missing current chart renderer/bridge records
in the named frontend catalogs. Add a bounded dirty-2.6 working-source supplement
for all fifty-three direct renderer/part re-exports, `useChartQuery` and the four
public query projection/error/budget helpers. Preserve pinned 2.1.1 counts and
the clean export JSON; wider headless-helper/type reconciliation is a separate
inventory task, not established by the catalog-home placement check.

- [x] Add and statically qualify the bounded chart discovery supplement: fifty-eight
  records with exact current declaration/route/manual mappings, without rewriting
  the historical export inventory.

- [x] Inventory the current layout, facade/adapter distinctions, stylesheet
  coupling and public/copy-path obligations.
- [x] Freeze the Card/Select old path → canonical owner → public facade → copy
  destination mapping, including prior CSS/helper companions and direct CardStatus.
- [x] Split frontend facade maintenance into curated exports without moving
  interaction owners or widening the public surface; qualify symbol identity and browser builds.
- [x] Pilot Card and Select implementation/styles/tests with retained compatibility
  paths and one implementation identity. Pickers were outside that first pass
  and are now organized by the second pass above.
- [ ] Freeze and qualify each subsequent family's public/copy-path mapping before
  relocating it; do not infer whole-library migration from the two pilots.
- [x] Consolidate overlay-family discovery and shared internal presentation
  helpers without changing the modal/portal/focus owners or hiding source-copy
  dependencies behind accidental broad imports.
- [ ] Partition the larger DataTable, chart and feature folders along their
  existing seams. Group client SDK/hook modules independently afterward.
- [ ] Extract neutral stylesheet infrastructure and explicit legacy tokens as
  a separately qualified change; do not couple palette retirement to UI moves.
- [ ] Remove compatibility paths or original theme material only after explicit
  approval, version policy, tested consumer guidance and owning migration rules.

Each family needs native prop/ref and behavior regressions, focused browser/SSR
checks, package export denials, actual copied-consumer CSS/helper builds, an
installed archive, Doctor target/capability checks and compiling documentation.
The private-alias checker and documentation graph must also pass. A checkout
build alone can hide missing package/copy assets. Representative-app visual
approval remains a separate gate before retiring original theme material.

## Documentation and Qualification

Focused checks cover canonical/legacy component and helper identity, native
Select forms/ref/types, Card/Select browser behavior, exact ordered frontend
exports, private aliases and copied-consumer CSS/closure/skip-existing behavior.
Fresh installed-archive qualification includes the canonical files, retained
facades, curated frontend modules and stylesheet fan-in rather than hashing only
the old UI wrappers. The checks are synthetic consumers, not representative-app
visual approval or a completed migration of larger families.

The private-import check inventories actual TypeScript module references rather
than quoted fixture payloads. Existing valid compatibility aliases stay explicit;
the otherwise-unused Calendar, date/time value-helper and former Popover primitive
aliases are deliberately retained, not silently removed during organization.
This pass does not
rewrite the package's private-import map.

Focused second-pass evidence (overlapping scopes, not an additive total):

| Check | Observed result |
| --- | --- |
| Date/time native, SSR and context identity | 32 pure/SSR tests / 150 assertions; 28 native-browser tests / 224 assertions; strict closure of 35 roots and 1,108 resolved sources, zero diagnostics. |
| Date/time old copy plans and customized destinations | 9 tests / 258 assertions; seven pre-move request plans retained and all thirteen custom historical files skipped on initial/repeat copy; fresh browser composition shares both Calendar contexts. |
| Popover and shared mechanisms | 47 tests / 552 assertions across pure, copy and browser checks; strict closure of 24 roots and 1,045 resolved sources, zero diagnostics. Eleven moved runtime/CSS bodies stay unchanged apart from import locations. |
| Public facade and actual UI documentation examples | 3 tests / 93 assertions; original ordered export digest and canonical type/symbol identities pass, and actual UI examples compile. |
| Copy compatibility, package-path admission, private imports and chart routes | 20 tests / 271 assertions; the eight supported paths resolve, canonical internal/family and fixture paths remain unexported, private map stays byte-identical, and forty-five former chart anchors remain linked. |
| Broad existing source-copy consumers | 11 tests / 101 assertions, including DataTable, form hooks, public sections, code and Navbar browser builds. The temporary consumer harness now has explicit dependency links in external scratch rather than relying on checkout ancestors. |
| Canonical chart examples | All twenty-five full examples compile: 1 test / 32 assertions. Full API examples are not duplicated in old route pages. |
| Installed archive | 1 test / 164 assertions; 131 current production source hashes match the installed copy, including canonical families, old forwards, the graph-wide copy engine/manifest and CSS fan-in. Public types, date/time SSR, mixed path identities, browser assets and source-only Doctor/upgrade pass without configuration/environment execution or database files. |
| Chart discovery supplement | 6 tests / 341 assertions; 53 renderer/part records, one hook and four bridge helpers. Named-symbol placement now has 1,077 records / 179 homes, zero problems. This bounded supplement does not prove exhaustive working-source type/helper coverage. |
| Token and documentation checks | Token check: 405 roles, zero unresolved references/problems. Documentation graph at second-pass completion: 773 unique, reachable pages with zero problems. Literal-color/legacy review candidates remain visible; this check does not authorize palette retirement. |

The latest installed archive SHA-256 is
`6ed0641944e07850dc1e4fdaf6ffa971cd5e3aa08e68b415885004ce0f11ede9`.
It is a dirty working-source qualification archive, not a published release.

Focused first-pass evidence (counts overlap; they are not an additive total):

| Check | Observed result |
| --- | --- |
| Frontend export digest and TypeScript symbol identity | 2 tests / 9 assertions; separate strict frontend dependency closure: 2,422 source files, zero diagnostics. Browser bundle succeeds in memory. |
| Select native/type/copy/export checks | 12 tests / 89 assertions; canonical Select browser suites: 9 tests / 73 assertions. |
| Card managed composition browser suite | 10 tests / 99 assertions; native/SSR/identity/typography checks remain separate. |
| Legacy/canonical copy plans and consumer behavior | 12 tests / 162 assertions across the new organization regression, existing anchored-copy check and two family-identity checks. All eleven customized legacy destinations remain untouched. |
| Installed archive | 1 test / 109 assertions; 78 current production source hashes match the installed copy. Next/legacy styling, native consumer types, browser CSS and source-only Doctor/upgrade checks pass with zero database files and no environment/config execution. |
| Managed foundation, scoped browser paint and AppShell defaults | 17 tests / 153 assertions; retained legacy artifacts and out-of-boundary public siblings stay usable. |
| Doctor target/export/CLI regressions | 31 tests / 224 assertions; capability evidence follows actual facade implementations without executing target configuration. |
| Private-import inventory and compatibility | 9 tests / 20 assertions; actual read-only check passes. Fixture strings and object-key ordering cannot create false stale-map failures; wrong/extra/missing mappings still fail and package metadata stays byte-identical. |
| UI documentation examples and graph | Actual UI examples: 1 test / 84 assertions. Graph: 767 unique, reachable pages, zero metadata/link/anchor problems. |

Installed evidence is retained outside source at
`/Volumes/code-bank/artifacts/zero-platform/diagnostics/theme-foundation/package-consumer-evidence.json`.
It records the dirty working snapshot, exact archive SHA-256 and qualified source
hashes; it is not a publication record or whole-repository hash proof.

The canonical [UI reference](../frontend/ui-reference.md) maps tokens, typography,
actions to motion and systems to their full manuals. Separate
[application](../guides/application-ui-development.md) and
[public UI](../guides/public-ui-development.md) guides explain assembly. The
[charts overview](../frontend/charts/index.md) demonstrates the subsystem tier:
shared API/data ownership first, then links to individual chart manuals.

The [theme evolution ledger](./design-token-theme-evolution-plan.md) retains
the implemented component/default-switch evidence. The
[component roadmap](../frontend/components/roadmap.md) tracks organization,
and the [Doctor roadmap](../cli/doctor/roadmap.md) owns upgrade/provenance work.

## Reviewed Next-Pass Priorities

After the second pass, `components/ui` has seventy-nine files: sixty-three
production/helper/CSS files, eleven tests and five fixtures. Twenty-four of its
production files are deliberate Card/Select/date-time compatibility forwards;
do not treat those as duplicate implementations to delete. Thirty-nine other
production/helper/CSS files remain; that count also includes older adapters and
forwards such as Tabs/Switch, not thirty-nine independent implementations.
DataTable still has 120 files, and the client
directory still has 258. These are source-file counts, not widget counts.

The next implementation pass should select one coherent row, freeze its exact
copy/public paths, and qualify it before taking the next row:

| Priority | Bounded existing scope | Proposed owner and preserved boundary |
| --- | --- | --- |
| Record workspace presentation | Five production files and six tests/fixtures: list/detail layout, panel hook, detail panel, record navigation bar/action. | `components/workspaces/records/`; retain five historical UI destinations, imperative panel refs, mobile/detail ownership and the existing `frontend/exports/layout/records.ts` facade. Shared AppShell, Resizable, MasterDetail, Storage and DataStudio stay outside the move. |
| Basic text controls | Two production files and one test: Input and Textarea. | `components/controls/text/`; preserve native refs/props and old IDs/private aliases. Label/FormField and validation are separate owners. |
| Tag input | One production file and two browser qualification files. | `components/controls/tags/`, coordinated with the separately planned Arc refresh. A structural move preserves current admission/keyboard behavior; the semantic refresh records explicit compatibility decisions. |
| DataTable motion core | Seven production/CSS files and four tests/fixtures: motion model/player/snapshot/tokens, motion hook and two skins. | `components/data-table/motion/`; keep the same `DATA_TABLE_MOTION` object, row identity, interruptible snapshots/reveal and native scroll owner. Retain old CSS forwards/copy plans before switching fan-in. Do not mix this with server query/cache/pagination/live-record restructuring. |
| Reactive chart adapter | Two production files and six tests: chart-query and chart-query-projection plus all family projection checks. | `frontend/client/charts/`; retain flat forwards for `/charts/react` and the React facade, identical `ChartQueryError`, scope retirement and existing subscription/data owners. This move does not introduce a server analytics API. |

Card/ContentCard and Select now have dedicated
[surface](../frontend/components/surfaces/card.md) and
[control](../frontend/components/controls/select.md) manuals with real family
indexes. Their mixed primitive pages retain original IDs, six sibling contract
bodies and four former Card/Select section routes. The extracted manuals have
distinct new IDs and contain the four complete examples exactly once. Central
routing, assembly guides, catalog homes and actual UI-example selections now
point to the canonical manuals.

The coherent date/time manual remains a future whole-page move with its current
ID and an old-route page; qualify routing/catalog/example changes together.
Popover, Tooltip and ScrollArea already have focused manuals and need no move
merely to mirror a source folder. Retained Recharts guidance stays separate.

The pinned package-export manifest remains historical evidence. A later complete
working-source route/symbol/type delta must have explicit ownership and separate
machine-readable evidence; do not relabel pinned counts or imply that a green
placement check proves exhaustive coverage. Headless chart math/default helpers
are part of that remaining reconciliation.

## Latest Component Requests: Documentation-Only Phase

The [Arc interaction follow-up](./arc-interaction-follow-up-plan.md) now owns the
detailed scroll/drawer/numeric/input/floating-tray register. Its family plans record current
gaps, proposed ownership, reference calibration, accepted-write/authority
boundaries, compatibility and verification. No new NumberField, generic
RollingNumber, MentionInput, optional phone selector or managed BottomSheet was
implemented by this phase.

Keep structural and semantic work separately qualified. The proposed Tag home
above matches its follow-up plan; generic digit display has a typography owner
rather than another table-only copy. Drawer planning retains one coordinated
modality owner and does not replace Sidebar's Sheet. Continue canonical manual
organization while these feature contracts are staged; a written plan does not
make an unchecked runtime feature implemented.

The [Floating Button Group plan](./floating-button-group-plan.md) now has a canonical
`controls/floating-button-group/` implementation and [focused manual](../frontend/components/controls/floating-button-group.md). Keep the
existing joined ButtonGroup/Toggle source, contracts and manual unchanged;
sharing measurement or paint does not merge action and selection controllers.
The reference's full CSS/motion coverage was already in the broad inventory;
its dated supplement supplies token dispositions and current installation
identities without rewriting historical counts. Its focused package/source-copy
route is `components/floating-button-group`; root and React entries expose the
same value and seven types. No old compatibility facade is needed for a new family.

## Documentation Follow-Up Qualification

The latest documentation-only slice adds five detailed Arc follow-up plans and
four real control/surface manual/index pages. The focused route/discovery
regression passes four tests / 170 assertions: exact moved-example hashes,
retained mixed-page IDs/anchors, six unchanged sibling-section hashes,
canonical routing/compiler inputs and seven current Card-part/ContentCard records.
The actual UI documentation example compiler also passes one test / 84 assertions
through public source imports, including all four extracted examples. It executes
no app, provider, configuration or writer.
Their catalog supplement is separate from the fifty-eight chart records and
does not rewrite the historical baseline.

The documentation graph now contains 782 unique, reachable pages with zero
metadata/link/anchor problems. Named-symbol placement has 1,084 records across
181 reader homes, zero missing homes; this is placement, not exhaustive API
coverage. All 131 production source hashes still match the qualified installed
archive above. This later slice changes documentation and its checks, not the
new runtime features, accepted owners or theme-retirement state.

### Floating Tray Documentation Addition — Historical Planning Slice

On 2026-10-11, the additive Floating Button Group plan and token disposition
supplement extend discovery without creating a supported manual or export.
The bounded planning/manual/parser checks pass 14 tests / 311 assertions; every
captured CSS reference, declaration and motion reference has a disposition.
The graph has 783 unique reachable pages and no metadata/link/anchor problems.
Catalog placement remains 1,084 records / 181 homes with no problems; a planned
component is not added to the supported-symbol count. The 131 production source
hashes still match the qualified archive. Runtime and visual qualification of
the new tray remain unchecked.

### Floating Tray Implementation Qualification — 2026-10-11

The later implementation is separate from the historical docs-only slice above.
It adds the canonical control family, one public value/seven types, explicit
focused package and source-copy routes, and the full three-example manual.
Internal model/geometry, label phases, CSS and paint measurement remain owned
by that family; no replacement joined/selection controller or public helper
sprawl was introduced.

| Boundary | Current bounded result |
| --- | --- |
| Family interaction | 27 tests / 276 assertions, no failures/skips: 13 actual Chromium cases, two SSR cases and 12 pure model/geometry cases. Light row and nested dark/touch column screenshots were inspected. |
| Existing owners and theme | 55 pure theme/typography/motion, joined ButtonGroup and documentation/parser regression tests passed. The token check reports 462 roles, all 60 legacy aliases and zero unresolved references; generated CSS matches its pure renderer. Existing legacy/literal-color review candidates remain separate migration work. |
| Public and copy paths | Six tests / 132 assertions cover the frozen curated public contract, canonical symbol/type identity, isolated source-copy build/custom preservation/static Doctor export resolution and the actual UI examples—including all three new manual fences. |
| Installed archive | One test / 78 assertions qualifies a fresh installed archive, strict public/production types, three facade identities, SSR, browser CSS, protected defaults and zero configuration/environment/database execution. All 39 bounded production source hashes match the installed snapshot. |
| Documentation | 784 unique reachable pages, zero metadata/link/anchor problems; 1,092 symbol records / 182 reader homes, zero placement problems. The historical inventories/counts remain unchanged. |

The archive evidence is recorded separately under
`/Volumes/code-bank/artifacts/zero-platform/diagnostics/floating-button-group/package-consumer-evidence.json`
and in the [adoption plan](./floating-button-group-plan.md). Earlier 131-file
qualification is historical, not proof that those files stayed byte-identical
through this feature addition. Current evidence is dirty working source and a
bounded locally installed archive, not publication, representative-app approval,
new drawer/input implementation or permission to retire the original theme.
