---
id: zero.inventory.frontend-components
type: inventory
audience: [agent, maintainer]
owner: frontend-components
status: draft
visibility: internal
system: frontend-components
applies_to: ["2.1.1"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-04"
  evidence_level: source-observed
---

# Frontend Component And Generic Hook Families

[System inventory index](./index.md) · [Documentation index](../../../index.md)

## Audit Identity And Verification Boundary

Framework `@zero/framework` 2.1.1 source baseline is committed `main` at `a3a5f726768dac890f241a3899c0a1acb66265d9`; inspection date 2026-10-04. The baseline commit was clean. The shared working tree now also contains separately authorized source/test corrections; this inventory's baseline claims remain pinned to the commit unless a supplemental correction is stated. This draft inventory is source-observed and awaiting independent reconciliation. It does not qualify an installed package, wider version range, production browser, or every Guardian/Fabric mode. No application imports, environment files, Doctor, provider requests, live databases, or app scripts were executed. “Tests present” means located, not passed. Planned destinations are plain paths relative to `docs-next/`.

## Purpose And Terminology

Owns the public reusable UI/component families and generic browser interaction hooks. Data controls/forms, frontend runtime/router/sdk, modals, and design tokens/icons have separate system inventories. Guardian/Storage/Data Studio/Notifications/Torrent remain owners of their domain authority and services; their frontend organisms are still individually cataloged here.

## Individual Surface Reconciliation

The [component catalog](../catalogs/frontend-components.md) records **414 named exports** with exact import alternatives, source declaration and planned home; **133 are icon/wrapper export records**, including aliases. The [hook catalog](../catalogs/frontend-hooks.md) records **131 hook exports**, of which **25 expose the generic /hooks route**. The [support catalog](../catalogs/frontend-support.md) records **94 non-server runtime helpers/errors/facades**. Aliases are records, not independent implementations. Different modules exporting useRow/useQuery are not merged.

The [internal bindings catalog](../catalogs/frontend-internal-bindings.md) records **444 source-export candidates without a declared package runtime route**. These include vendored Animate UI and internal controllers; source-copy dependencies are not necessarily dead/unsupported. Non-exported local functions are outside that export-only list. Public types/remaining package surfaces reconcile with [package exports](../catalogs/package-exports.md).

## Features And Documentation Coverage

| Feature/family | Exact representative public surface and evidence | Canonical planned guide |
| --- | --- | --- |
| UI primitives | Every individual Card/Badge/Button/Input/Select/Table/Chart/etc export and alias in component catalog; UI wildcard entries from [package.json](../../../../package.json) | `frontend/components/primitives/index.md` |
| Overlay/menu/sidebar composition | Public DropdownMenu*, Popover*, Tooltip*, Sidebar*, Collapsible* plus useSidebar/useCollapsible; named component subpaths/barrel | `frontend/components/overlays/index.md` |
| App shell | AppShell/AppShellHeader/AppShellBreadcrumbs/AppShellSidebar and all AppShell* public configuration types; [src/components/app-shell/index.ts](../../../../src/components/app-shell/index.ts) | `frontend/app-shell/index.md` |
| Public navigation/hero/content | ResizableNavbar; Hero/HeroActions/HeroBackground/HeroImageBackground/WavyBackground; FeaturesSection/CtaSection/FooterSection/Faq/CodeBlock/ExpandableCards/BentoGrid*/AnimatedList* | `frontend/components/public-pages/index.md` |
| Text presentation | FlipWords/TextGenerateEffect/TypewriterEffect/StreamingText, StreamSource and status/props; [src/components/text-effects/index.ts](../../../../src/components/text-effects/index.ts), [src/components/streaming-text/index.ts](../../../../src/components/streaming-text/index.ts) | `frontend/components/text/index.md` |
| Sensitive display/QR | SecretField/SecretFieldProps, QRCode/QRCodeProps; [src/components/secret-field/secret-field.tsx](../../../../src/components/secret-field/secret-field.tsx), [src/components/qr-code/index.ts](../../../../src/components/qr-code/index.ts) | `frontend/components/sensitive-display.md` |
| Phone field | PhoneInput/PhoneInputProps/PhoneInputSize; canonical helpers and shared Input read-only composition; additive dirty 2.5.0 source, not part of the original audit | [Phone input](../../../frontend/components/phone-input.md) |
| Hierarchical selection | Cascader composition, typed node/search/selection contracts and useCascaderSelection; [src/components/cascader/index.ts](../../../../src/components/cascader/index.ts) | [Cascader](../../../frontend/components/cascader.md) |
| Handwritten signature capture | SignaturePad composition, SVG/JSON/native forms, useSignaturePad, SignatureAgreementCard, ClauseInitials; [src/components/signature-pad/index.ts](../../../../src/components/signature-pad/index.ts) | [Signature Pad](../../../frontend/components/signature-pad.md) |
| Guardian forms/gates/control planes | Every auth/admin organism individually cataloged; useGate/usePropertyGate/native continuation/invitation hooks; [src/components/auth/index.ts](../../../../src/components/auth/index.ts) and adaptive user management | `frontend/guardian/index.md` |
| Storage organisms | StorageManagement/StorageStudioManagement/StorageStudioWorkspace/FileBrowser/DriveList/UploadDropzone and all named storage catalog rows; [src/components/storage/index.ts](../../../../src/components/storage/index.ts) | `frontend/storage/index.md` |
| Data/Studio forms and organisms | DataTable/DataStudio/CrudPage/MasterDetail/Kanban; separate data-controls/form inventories | `frontend/data-controls/index.md` |
| Notification UI | NotificationBadge/Item/List/Dropdown/Center plus NotificationProvider/context; individual props and formatRelativeTime; [src/components/ui/notification-center.tsx](../../../../src/components/ui/notification-center.tsx) | `frontend/notifications/index.md` |
| Confirmation/modals | ModalManager/HoldButton/ConfirmModalContent and ConfirmProvider/useConfirm; separate modal inventory | `frontend/modals/index.md` |
| Generic async/state hooks | useAsyncAction/useControlledState/useDataState/useDisclosure/useStableCallback/usePrevious/useMounted | `frontend/hooks/state-and-actions.md` |
| Generic timing hooks | useDebouncedCallback/useDebouncedValue/useThrottledCallback/useThrottledValue/useInterval/useTimeout/useIdle | `frontend/hooks/timing.md` |
| Generic DOM/system hooks | useAutoHeight/useClickAway/useCopyToClipboard/useHotkey/useIsInView/useMediaQuery/useIsMobile/useMotionValueState/useOs/getOS/useTextSelection | `frontend/hooks/browser-interactions.md` |

Each grouped row is routing only: the catalogs assign every symbol a focused guide, including subpath-only exports not in the root barrel.

The Cascader row is an authorized additive working-source feature on top of
2.2.1 commit `ea971213e7bc7f3b1d11b16cda42227ca8287a60`, not a claim that it
existed in the clean 2.1.1 inventory. Its guide and source own nested leaf
selection, a multi-selection cap, path-aware local/remote search, asynchronous
drill-down, pinned commands and optional external chips. It composes existing
Zero controls rather than introducing another authorization or transport layer.

The Signature Pad row is also a separately authorized unreleased source addition
on top of that 2.2.1 baseline, alongside committed Cascader `9032797`. It captures
validated immutable ink and composes existing tokenized controls; application
servers retain identity, authorization, trusted dates and durable signing. Its
guide distinguishes SVG native fields from acknowledged agreement receipts and
clause completion. It introduces no automatic backend route or migration.

Supplemental Signature Pad checks were executed on the unreleased source on
2026-10-05, not on an application or live signing/storage service. The real
styled synthetic Chromium suite passed **33 tests / 175 assertions**, covering
mouse/capture, native touch, synthetic pen pressure, cancelled gestures,
ink-option retirement, local history shortcuts, disabled/read-only imperative
guards, native required fields and reset (including cancelled reset and batched
multi-clause reset), asynchronous duplicate/save locks and retired generations,
accepted-change notification failures with content-free scope retirement,
controlled interior-point replacements, acknowledged dates, safe receipt
rendering, clause counts, and light/dark/mobile geometry. Screenshots were
stored outside the source tree in the designated diagnostics root; checked
consent motion was allowed to settle before visual evidence.

An actual freshly installed packed public consumer passed **1 test / 9
assertions**, proving 13 signature-family runtime exports through the root,
React and focused component paths, browser bundling, SSR, an initial native SVG
field, the public hook, agreement and clause compositions. The broader actual
UI Markdown example compiler check, including six signature examples, passed
**1 test / 46 assertions**. Docs traversal passed **695 pages / IDs / reachable
pages with zero problems**. These are focused source/fixture checks, not a
legal/compliance certification, npm publication, or proof of a shipped archive.

## Configuration And Integration Inventory

### Adaptive Settings Presentation: October 6 Working Source

Three source additions follow the session-recovery checkpoint
`43b718a5fdf6fec4acf61524ba8d490da784e747`, framework 2.5.0. They have
focused component paths plus root/React exports and do not change the
historical 2.1.1 catalog counts:

- [Avatar Group](../../../frontend/components/avatar-group.md) owns a compact
  roster/count/optional add composition. Existing Avatar primitives remain
  unchanged. Status decoration defaults off, is presentation-only, and follows
  square/rounded/circle geometry; no tracking/subscription is mounted.
- [Settings Matrix](../../../frontend/components/settings-matrix.md) owns
  controlled boolean choices in one to three columns, per-cell async state,
  locked/unavailable explanations and provider/app-target retirement.
- [Integration Settings List](../../../frontend/components/integration-settings-list.md)
  owns flat/grouped service presentation, labeled statuses, optional header
  action, read-only mode, menus and acknowledged/confirmed action interaction.

The first fresh installed temporary consumer passed one test /16 assertions:
root/React/focused export identity, browser build, SSR without a domain service,
package-local guides, notices, the recovery API and disabled presence semantics.
This is an intermediate dirty-source check, not a clean release/archive claim;
final source/browser evidence belongs in the
[profile-upgrade qualification ledger](../guardian-profile-qualification.md).
Existing profile/notification/integration/storage services remain their own
authority/persistence owners. Connected profiles, uploads and first-class
presence are not implemented merely by these presentation additions.

### Phone Input And Shared Read-Only: 2026-10-06 Working Evidence

The Phone Input row supplements the original inventory with authorized dirty
source based on `39c0ed1de0501986810a2b99366f484e66ba80dc` (framework 2.5.0).
Its [guide](../../../frontend/components/phone-input.md), schema/form guides and
component/helper/export catalogs have reciprocal navigation. ReUI examples 7/8
and the free radix primitive were inspected; adaptation attribution is retained
in the root third-party notices. Current tokens and Zero controls are reused.

Independent review caught an external-clear defect: a raw `+` and cleared value
both mapped to the formatter's undefined value, retaining visible digits. A
narrow reset bridge and regression correct it without remounting ordinary typed
clears. Styled screenshot review also caught clipped dial codes due to the
scroll area's intrinsic content width; the owned picker layout and geometry
regression correct that without changing shared ScrollArea defaults.

Executed with Bun's automatic env-file loading disabled, using only synthetic
data and temporary consumers, on the final working phone source:

- Focused helper/schema/generated-form/base-input/export tests plus a fresh
  installed package consumer: **23 passed / 169 assertions**, including the
  package smoke's **1 / 11**. This qualifies those public imports, browser build
  and DOM-free rendering from a temporary dirty-source archive, not a release.
- Phone SSR and actual styled Chromium: **10 passed / 74 assertions**, of which
  **7** are browser tests. Countries/keyboard, US/FR formatting, canonical native
  FormData, outside-form association, refs/focus/copy, locked open menus,
  null/undefined and partial drafts, native reset, generated validation,
  light/dark semantic overrides and a short 320px RTL viewport are covered.
- Existing schema/default/configuration/inference regressions: **73 / 352**;
  full project TypeScript clean. Actual reusable UI Markdown fences including
  all three phone examples: **1 / 62**. Whitespace check clean.
- Documentation structural check: **720** pages/IDs/reachable, zero problems;
  catalog placement: **959** records assigned to **154** existing homes, zero
  problems. These are placement measures, not complete platform qualification.

Logs and settled screenshots are outside the source/package tree under the
designated logs/artifacts roots. No Pantheon files, live account, app database,
provider, environment file or deployment were used. Release versioning,
merge/push and artifact provenance remain separate from these working checks.

### 2.4 Grouped Controls And Conventional Context Menus

The original 2.1.1 inventory/counts above remain a pinned historical audit.
The 2.4.0 additions are catalogued separately: [Button Group](../../../frontend/components/primitives/button-group.md)
owns five action/selection parts and a class composer; [Context Menu](../../../frontend/components/overlays/context-menu.md)
owns seventeen conventional menu/portal/choice parts with corresponding Props
types. Both families have root/React and focused public component imports.
They reuse existing controls, Radix behavior, icons and Zero colors/radius/fonts;
they do not implement the future global density/motion-contract redesign.

Focused checks against the feature candidate passed 25 SSR/composition tests
(167 assertions), 16 styled browser tests (103 assertions), and the actual
UI Markdown example compiler (54 assertions, including six new examples).
The browser review exposed an invisible-menu entrance defect; the final native
surface runs Motion inside Radix Presence without reinterpreting native React
events or delaying close-focus handoff. Unchanged visibility checks and added
native event/ref/asChild/style-restoration checks pass. A stronger retained
asChild reproduction also caught a detached public ref when a consumer changed
its own DOM tag internally; a stable native callback ref now tracks attachments
and preserves React 19 returned cleanup functions. That unchanged regression
and the complete browser gate pass. Examples and browsers
use synthetic local callbacks, not application data. Final package/provenance
checks remain release-owned rather than inferred from these counts.

The final runtime source was frozen and committed as
`fdba48af9dcbab96ddeb3aa3b49f070a8c8a81a6`. Root's final full typecheck passed,
as did the combined 25-test SSR/composition gate and a newly installed public
2.4.0 package consumer (1 test / 16 assertions). The latter checks 23 runtime
exports for root/React/focused identity, fresh-process browser bundling, native
SSR semantics, included component guides and third-party notices. Documentation
navigation/metadata passed for 698 pages with zero problems. These focused
gates are not a claim of a full-platform audit or changes to any application.

Components consume exported Props/Options types and inherited React/Radix/Motion/third-party attributes; exact declarations are linked per catalog row. Settings are React props/render-time, not automatic server env/Doctor discovery. Required provider context, controlled/uncontrolled values, callback behavior, SSR fallback, accessibility and mode-sensitive services need feature-level detail during the later guide pass.

AppShell* contracts include preset/icon/brand/breadcrumb/workspaces/menu/nav/user/header/theme toggle structures; source-owned defaults live in app-shell modules and presets. Public content accepts caller-owned assets/text/actions; streaming strings do not imply an AI transport. SecretField's masking/reveal/copy options act on a secret already authorized into browser memory—masking is not encryption/security. Notification/Guardian/Studio/Storage organisms compose SDK hooks and server-scoped APIs; visibility props remove UI only, never bypass backend authorization. Generic hooks own UI state/lifecycle, not transport persistence.

## Evidence And Verification

Tests present by family: [src/components/streaming-text/streaming-text.test.tsx](../../../../src/components/streaming-text/streaming-text.test.tsx), [src/components/streaming-text/streaming-text.browser.test.ts](../../../../src/components/streaming-text/streaming-text.browser.test.ts), [src/components/admin/users/adaptive-user-management.test.tsx](../../../../src/components/admin/users/adaptive-user-management.test.tsx), [src/components/ui/list-detail-layout.test.tsx](../../../../src/components/ui/list-detail-layout.test.tsx), [src/components/ui/date-picker-value.test.ts](../../../../src/components/ui/date-picker-value.test.ts), [src/hooks/use-os.test.ts](../../../../src/hooks/use-os.test.ts); data/storage/UI test suites are mapped in their owning inventories. Package tests [src/package-exports.test.ts](../../../../src/package-exports.test.ts), [src/package-distribution.test.ts](../../../../src/package-distribution.test.ts) are present, not executed. Examples package-mode/guardian-fabric-proof and source-local examples; research [docs/frontend/component-inventory.md](../../../../docs/frontend/component-inventory.md) and [docs/frontend/hooks.md](../../../../docs/frontend/hooks.md).

## Findings, Philosophy, And Known Future Plans

- Confirmed original-baseline packaging defect, corrected in the authorized dirty working tree: `/components/ui/*` resolved tracked card.test, record-navigation-bar.test and list-detail-layout.test modules. The working manifest now excludes `*.test` and `*.spec` UI routes; valid UI routes remain available. These tests are not supported component teaching targets. Focused public resolution checks passed (2 tests/10 assertions); exact archive qualification is still required. See [findings](../findings.md#confirmed-corrections).
- Verification gap: source/barrel coverage does not certify every primitive's SSR/accessibility/browser mode. Do not reuse old aggregate component counts as evidence.
- Established philosophy: prefer reusable tokenized Zero primitives/organisms and SDK-backed controls; source-copy zero add is an explicit app-owned customization path.
- Future public documentation/component catalog/editor/complex calendar/control improvements in [docs/platform-roadmap.md](../../../../docs/platform-roadmap.md) remain ideas with provenance, not newly exported components.

## Independent Source Reconciliation

Reviewed independently on 2026-10-05 across frontend/components/subpath/generic-hook barrels, the five symbol/member catalogs, and responsibility-focused AppProvider, form/data/control-plane, StreamingText, SecretField and shell contracts. Catalog aliases preserve symbol-origin identity; third-party re-exports and props must retain their originating contracts/attribution. Runtime/forms/data-control/navigation rows now resolve to one planned home per feature rather than conflicting source-filename guides.

The catalogs provide individual export coverage, not a claim that every primitive has been rendered or accessibility-tested. Large domain components consume live capabilities through their owning SDK/service contract; controlled data/callback modes deliberately delegate app behavior. StreamingText is a string-chunk presentation component, not the AI gateway; SecretField only masks a browser-held authorized value. These independent boundaries remain explicit in their planned guides. Confirmed Link and acknowledged CRUD/master-detail findings are assigned to the [router](./frontend-router.md) and [data-control](./frontend-data-controls.md) ledgers, not hidden by general component polish language.

## Navigation And Completion Review

### Supplemental Overlay Draft And Range/Token Corrections

The public overlay/menu/sidebar group now has an eleven-page detailed draft
family at [overlays](../../../frontend/components/overlays/index.md), with exact
public import boundaries, controlled/local props, provider composition,
callbacks/lifecycle, configuration and roadmap. Component/hook/support catalogs
now assign its exported symbols to those actual guides. Eight complete public
overlay examples were compiled in memory alongside Doctor/design examples:
the full example check passed 1 test / 20 assertions on 2026-10-05, without
executing the examples.

Actual SidebarMenuButton plus generated platform CSS in synthetic Chromium
confirmed hsl(var(...)) incorrectly wrapped complete oklch semantic colors:
the light/dark computed outlines were absent (0 passed, 2 failed). Only base,
hover and active-highlight color wrappers changed to var(...). Focused
sidebar-outline browser cases now pass **2 / 8 assertions**, comparing normal
and hover computed colors against the actual semantic token values. The test
owns/cleans its temporary CSS output and opens no app/session/data service.

Progress's animated indicator ignored max while Radix's ARIA/root used it;
source SSR regressions failed all 5 cases. Working projection now uses the
declared normalized Radix range: 5/10, 500/1000 and .5/1 render half, completion
and default100 remain coherent, invalid/null values match indeterminate root
rather than overflow. Focused progress cases pass **5 / 33 assertions**.
These are dirty development corrections, not release/browser/accessibility
qualification. No public component Props or new configuration API was added.

### Generic Hook Detailed Draft And Contract Corrections

Generic public hooks now have focused [state/action](../../../frontend/hooks/state-and-actions.md),
[timing](../../../frontend/hooks/timing.md), and
[browser interaction](../../../frontend/hooks/browser-interactions.md) homes,
plus configuration/index/roadmap and the separate confirmation companion.
The individual hook/support catalogs map to these real canonical pages.

Actual null-rendered hook/SSR regressions reproduced controlled-value requests
overriding the parent and useDataState missing its server snapshot: 1 passed /
2 failed. The minimal corrections preserve parent-controlled render values and
provide a stable null SSR snapshot: 3 passed / 5 assertions.

useAsyncAction's accepted callback/error callback/concurrent/reset/unmount
contracts reproduced 0 passed / 6 failed. The focused hook now keeps accepted
writer outcomes separate, observes sync/async notifications safely, prevents
secondary error callbacks masking rejection, tracks deliberate concurrent groups
and fences reset/unmount generations. Default reset-on-run protects newer results.
The final async/generic run passed 10 tests / 33 assertions; no browser, app,
database, network or provider ran. These are dirty-source corrections, with
global typecheck/package review remaining separate. Root independently reviewed
the final implementations and reran these contracts together with useDataPage:
23 passed / 58 assertions, with no further correction requested. The review does
not expand synthetic null-rendered hook tests into a browser qualification.

Sources: [async action](../../../../src/hooks/use-async-action.ts),
[async regressions](../../../../src/hooks/use-async-action.test.tsx),
[generic regressions](../../../../src/hooks/generic-state-contracts.test.tsx).

### AppShell Header Visibility Closeout

The seven-page [AppShell family](../../../frontend/app-shell/index.md) now records
the public presets, descriptors, slots and authority-owned workspace signals.
Tracing those props exposed topbar/simple-sidebar ignoring header=false and
header.hide, while the other header-bearing presets honored them. A synthetic
SSR test reproduced 5 passing / 2 failing cases. Shared configuration resolution
and visibility gating corrected those two branches without changing the direct
header prop type, controlled sidebar or minimal layout.

The focused header/workspace suite passed 12 tests / 48 assertions. Agent A
independently reviewed the implementation and reran the same passing suite.
Checks used synthetic SSR content and pure workspace helpers, not a browser,
client/session, network or data service. Exact-package qualification is separate.

### Primitive And Presentation Draft Closeout

The remaining primitive, public-page, text, sensitive-display and bottom-anchoring
families now have focused real guide homes under
[components](../../../frontend/components/index.md), with actual props/imports,
callback/persistence distinctions, provider requirements and reciprocal indexes.
AppShell has its own family. The catalogs were reconciled to those grouped homes
rather than creating empty filename aliases. Root's read-only placement checks
now resolve all 866 component/hook/support/SDK records and all 428 inventoried
feature groups; this is placement evidence, not a depth or correctness certificate.

Source tracing also drove these independently reviewed focused corrections:

| Responsibility | Reproduction and final targeted evidence |
| --- | --- |
| Delimited TagInput batches / chart theme lanes | Root reproduced 2 passing / 4 failing cases; coherent one-batch replacement and light/dark styles passed 6 tests / 14 assertions, independently rerun/reviewed here. |
| Chart tooltip labelKey | Actual synthetic component DOM reproduced 0 passing / 1 failing case. The config label now applies with raw-label fallback, explicit formatter and hideLabel precedence. Tooltip/theme run passed 4 tests / 16 assertions; root independently reviewed/reran. |
| Hero option normalization | Empty/class-only legal background options threw as React children: 1 passing / 2 failing SSR cases. Narrow option recognition passed 3 tests / 6 assertions; root independently reviewed/reran. |
| InlineEditText acceptance/lifetime | Root reproduced 0 passing / 4 failing actual-input cases, plus a disabled queued-blur case. Same-tick admission, unmount/focus/navigation fences, safe accepted notifications and disabled new-save guards passed 6 tests / 17 assertions, independently rerun/reviewed here. |

These synthetic fixtures never opened an app, session, provider, database or
live storage. Actual-input tests use the existing isolated Bun-built Playwright
fixture path; they are not a whole-device/visual/accessibility certification.
SSR/style tests do not start animation effects. Test-only UI browser-fixture
modules are excluded from the package wildcard with read-only resolution tests.

The editor guide explicitly leaves real record identity with the keyed parent:
value/revision alone cannot identify a row. An accepted server write is not rolled
back by unmount, disabling or a failed navigation notification. Progress/range
and controlled-table state corrections are recorded by their assigned reviewers,
not presumed complete merely because their guide exists.

The actual 29 AppShell/primitive/text/sensitive/public-page Markdown code fragments
were subsequently compiled in memory using public source paths: 1 passing test /
30 assertions. The [UI example checker](../../checks/frontend-ui-examples.test.ts)
does not execute these examples, import app configuration or load providers.
This qualifies the inspected fragments' types, not every prose claim or artifact.

## Additive Shared Workspace Layout Implementation

The user-authorized Data Studio UI pass also updates shared ListDetailLayout,
DetailPanel, RecordNavigationBar, MasterDetailPage and AppShell. The bounded
workspace frame, zero-minimum flex/motion chain, independent pane scrolling and
non-scrolling bottom sibling are presentation contracts, not authentication or
data-query changes. AppShell adds workspace/document contentMode; topbar/minimal
retain document defaults while dashboard-like presets use workspace.

ListDetailLayout/MasterDetailPage add desktop detailVisible and opt-in resizable.
Desktop visibility does not block mobile selected-record inspection/Back. One
mounted tree retains fields/effects across viewport/hide transitions, and all
library panel IDs are instance-unique. RecordNavigationBar adds optional
showNavigation/status so unselected screens keep useful counts/actions. All
existing required count/callback props remain compatible.

The initial homemade splitter prototype was removed. Three thin standard
Resizable wrappers reuse pinned react-resizable-panels 4.14.2 for pointer/touch,
keyboard/ARIA and constraints; a separate small adapter resolves the existing
CSS tracks and responsive visibility through the library API. It scopes the
outer separator measurement to direct children, not nested app splitters.
The [guide](../../../frontend/components/primitives/resizable.md) and three
additive catalog records distinguish these dirty additions from the clean
baseline/publication. No external registry component generator was run.

Initial six focused suites passed 32 tests / 168 assertions and were independently
reviewed/rerun by A. Later checks add other AppShell presets, nested panel sizing,
and a real animated-tabs content→fill→content transition. That last regression
confirmed a retained 3200px Motion inline height; explicit auto in fill mode
clears the prior natural-height target. The direct regression passed 1 test /
7 assertions and was independently reviewed/rerun by A. The final six-suite
shared run passed 38 tests / 212 assertions, with no captured page/console
errors in the layout fixtures. The shared UI Markdown examples compile through public source
paths: 1 test / 32 assertions after the new Resizable and MasterDetail snippets.
These tests use isolated Chromium/synthetic data and compiled platform CSS;
no application/session/provider/live database was opened. Exact package/app
qualification and the root's combined review remain separate evidence.

Canonical reader homes are [list/detail](../../../frontend/components/primitives/list-detail.md),
[master/detail](../../../frontend/data-controls/master-detail.md), and
[AppShell configuration](../../../frontend/app-shell/configuration.md).

## Shared CodeBlock Upgrade — 2026-10-06 Working-Source Supplement

The user-authorized pheralb-inspired upgrade replaces CodeBlock's rendering and
compositions with one shared implementation while preserving its existing
convenience props. It does not retain a parallel legacy renderer or install a
second UI system. Additive native parts, file tabs, package-manager tabs/select,
copy/morph controls, inline/Markdown/trusted-pre adapters and server preparation
now have focused homes under [CodeBlock](../../../frontend/components/public-pages/code-block.md).
The composition, rendering and examples pages distinguish browser fallback,
trusted generated HTML, app-owned authorization and optional preference storage.
The catalog supplements preserve the earlier baseline's historical counts.

Qualification exposed and corrected concrete integration defects rather than
loosening acceptance checks:

| Responsibility | Correction and focused evidence |
| --- | --- |
| Syntax engine / embedded grammars | Bun's JavaScript-regex renderer misclassified a TypeScript string/comment boundary. The existing single Oniguruma engine renders it correctly; lazy embedded Markdown grammars retain their actual nested syntax. No second engine is loaded. |
| Highlight annotations / anchors | Inserting line anchors before Shiki's notation transform broke comment parsing. Anchors now attach after the code transforms; highlights, word marks, diff/focus, numbering and copied source remain coherent. |
| Tokenized controls / syntax | Old global dark styles flattened variable syntax colors, and inherited Button utility styles overrode action sizing. Scoped styles and native token-valued action defaults now honor actual runtime metrics, syntax colors, focus, hover and reduced motion. Radius defaults use real runtime variables rather than unavailable theme aliases. |
| Metadata budgets / server publication | Fence ranges clamp to actual code lines, and word decorations have explicit bounded budgets. Strict server preparation remains available; an explicit escaped fallback with an app-owned error callback prevents an unsupported language from breaking an entire documentation publication. |
| Native adapters / copy lifetime | Trusted-pre native classes/events/attributes stay on the actual pre element, without copied decorative anchors. Copy awaits the operation, prevents duplicate clicks, reports failure, respects prevented events and reacts to reset-duration changes. |

The final focused CodeBlock run passed **32 tests / 170 assertions**, comprising
unit/highlighter/SSR tests and **10 isolated Chromium cases**. The browser cases
exercise desktop/mobile light/dark rendering, actual runtime token values,
keyboard file tabs, copy outcomes, stale-result fencing, wrapping, manager
preferences, trusted-pre/native behavior, reactive copy reset and useful no-JS
server-rendered source. Fixtures use synthetic code and generated platform CSS;
they do not open application sessions, providers or databases. The in-app browser
bootstrap was unavailable, so the established disposable Bun/Elysia/Chromium
harness was used; this does not imply a whole-device accessibility certification.

The working source's complete TypeScript check passed. The expanded UI example
checker passed **1 test / 59 assertions**, compiling five new CodeBlock snippets
through the public source facades without executing applications. The structural
documentation check observed **712 pages / 712 IDs / 712 reachable / 0 problems**
at that check's point in this changing documentation tree. These observations
describe the dirty `feature/markdown-documentation-plugin` source based on
`636b1c01b3484317df56ce624c7cd57976ee417c`, not a published or installed 2.4.0
archive. Exact-package/export and combined plugin qualification remain separate.

Subsequent actual 2.5.0 framework/0.1.0 optional-package archive and compiled
reader gates passed and are recorded in the
[documentation-plugin qualification ledger](../docs-plugin-qualification.md).
The shared renderer also copied/prepared code successfully from the source-free
compiled reader under nonce CSP. This is focused working-archive evidence, not
registry publication, a clean release commit or whole-library qualification.

Sources: [component family](../../../../src/components/code-block/index.ts),
[transformer tests](../../../../src/components/code-block/code-block-transformers.test.ts),
[browser tests](../../../../src/components/code-block/code-block.browser.test.ts),
[rendering guide](../../../frontend/components/public-pages/code-block-rendering.md),
and [upstream notice](../../../../THIRD_PARTY_NOTICES.md).

Planned section entrance/configuration/roadmap and per-feature homes above require their parent indexes, contextual links and useful reciprocal guides. Keep these working inventories out of public publication. See the [process](../../../documentation-process.md) and [standards](../../../documentation-standards.md).

- [x] Source-backed feature groups, public routes, and planned homes recorded.
- [x] Tests present, source inspection, and execution claims distinguished.
- [x] Findings and uncertainties recorded without documenting defects away.
- [x] Independent targeted feature/default/import reconciliation.
- [ ] Whole-platform reconciliation and discovered-defect closeout.
- [ ] Exact-package/export/example/mode qualification.
- [x] First-draft feature guides, configuration, indexes and roadmaps placed.
- [ ] Whole-set guide review, public projection and publication qualification.
