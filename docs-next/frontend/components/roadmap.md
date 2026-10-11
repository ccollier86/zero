---
id: zero.frontend.components.roadmap
type: roadmap
audience: [developer, agent]
owner: frontend-components
status: draft
visibility: internal
system: frontend-components
feature: component-roadmap
maturity: planned
applies_to: ["2.6.0 working source; publication qualification pending"]
modes: [browser, SSR, Guardian single, Guardian multi]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "335b27372b0b8ef57a1e92cf93cec378923fe50b"
  snapshot: dirty
  date: "2026-10-11"
  evidence_level: source-observed
---

# Reusable Component Roadmap

[Component index](./index.md) · [Frontend index](../index.md) · [Documentation index](../../index.md)

The current platform already contains full data, auth, storage, workflow and UI
systems. Future work should improve or compose those contracts, not describe
existing capabilities as absent foundations. Unchecked directions below remain
ideas/plans; checked entries identify implemented capabilities:

- [x] Document the current source layout, compatibility boundaries and separate
  original-theme retirement requirements in the
  [component organization plan](../../_work/frontend-component-organization-plan.md).
- [x] Implement the first family-owned organization pass: Card and Select now
  have canonical implementation/styles/tests; old production paths remain
  compatibility facades. Split frontend export maintenance without changing
  public symbols or owners, and retain source-copy companion destinations.
- [x] Implement the next bounded pass: date/time controls and Popover have
  canonical family homes, shared overlay mechanisms have explicit internal owners,
  and the five full chart manuals live beside the Charts overview. Preserve
  former import paths and graph-wide source-copy dependencies; see the
  [organization reference](./source-organization.md).
- [ ] Continue incremental organization of the larger overlay engines, data and
  feature families, and client
  SDK modules; freeze and qualify each family's public/copy-path mapping first.
- [x] Extract full Select and Card/ContentCard manuals into focused control/surface
  indexes. Retain mixed-page IDs, sibling contracts and old section links; canonical
  routing and actual example checks use the new manuals.
- [x] Deliver rich Morph Select, shared anchored motion/magnetic choice paint,
  Arc native-scroll treatment and composable Card/ContentCard in working source.
  [Qualification](../../_work/design-token-theme-evolution-plan.md#anchored-controls-and-card-follow-up)
  preserves deliberate modal/Tooltip/chart behavior; full-app visual approval,
  wider custom/context-menu coverage and source-copy provenance remain separate.

- [ ] Rich document reader/editor plugins, including nondisruptive autosave with
  explicit accepted persistence rather than merely a local debounce timer.
- [ ] A reusable general code editor with syntax highlighting, token-aware themes
  and bounded text editing. [JsonEditor](./json-editor.md) currently covers
  structured JSON and plain JSON text; this later work must use an approved
  existing editor rather than a homemade highlighting primitive.
- [ ] A richer AI prompt/chat interface that reuses the existing gateway, typed
  tools, streaming presentation, storage and tenant authority.
- [x] Composable ingestion and vector-search organisms with a full Zero facade,
  real operation state, external-engine adapters and explicit landing-page stories.
  Follow the [visualization plan](../../_work/vector-visualization-plan.md), including
  observer hooks that attach to existing chat/tool/agent operations without
  duplicate searches. See the [component guide](./vector-visualization.md).
  Preserve their information panels as part of the
  [future theme reference](../../_work/design-token-theme-evolution-plan.md).
- [x] An optional [Markdown-first documentation plugin](../../plugins/docs/index.md)
  provides the reader, navigation and search. It retains its separately versioned
  preview contract; installing it does not publish a documentation website.
- [ ] Further public website/content polish and permission-aware document editing
  with an actual accepted writer, not a client-only editing surface.
- [ ] Full blogging/calendar/file-browser experiences where real app requirements
  justify a reusable plugin rather than app-specific screens.
- [ ] Additional compact application/organization administration blocks and
  optional in-table mini-graphs with accessible exact data.
- [x] Introduce the first Zero-owned chart: the [Sankey organism](../charts/sankey.md),
  compact shared inspector, headless flow math and existing-query bridge.
  The [current Recharts composition](./primitives/charts.md) remains compatible.
- [x] Add the [Race Bar chart](../charts/race-bar.md) with ordered aggregate history,
  spring-driven rank/value transitions, playback/seek/scrub controls and shared
  inspection. Record its reference token direction without replacing existing charts.
- [x] Add the [Funnel chart](../charts/funnel.md), with validated conversion cohorts,
  total/split/isolated views, responsive smooth bands and illustrative retention flow.
- [x] Begin chart-family token convergence: shared analytical-inspector/type/focus
  roles and named categorical colors, retaining local overrides and legacy Recharts.
- [x] Add the separate [twelve Arc charts](../charts/arc.md), bounded model/math
  facade, source-copy skin and authorized existing-query projection qualification.
- [x] Add [handmade analytical coverage](../charts/native.md): quantitative/mixed
  Cartesian charts, true statistics, polar/hierarchy geometry and an original
  observed-time stream, all sharing Zero tokens, exact companions and the
  authorized reactive bridge. Recharts is a math/capability reference only.
- [ ] Compare the observed stream with the supplied Realtime Stream reference
  if that missing file becomes available; current implementation makes no
  pixel-equivalence claim.
- [ ] Extend the chart facade with named authorized aggregate snapshots and
  explicit Fabric/database automation integrations. Follow the
  [chart plan](../../_work/charts-system-plan.md); the completed query bridge
  reads bounded aggregate collections, not arbitrary server analytics.
- [x] Connect first-class editable profiles, avatar staging/cropping, verified
  contacts, regional preferences and required-completion policy to the adaptive
  [user-settings experience](../guardian/profile-settings.md), with fixed
  post-bootstrap feature provisioning and explicit readiness.
- [x] First-class [Guardian presence](../../backend/guardian/presence.md) with
  multi-device leases, inactivity and admitted Reactive DB/Fabric projections.
  Its supported topology has one active presence owner per SYSTEM database;
  distributed multi-owner operation remains future work. The
  [avatar group](./avatar-group.md) supplies opt-in visual decoration, not the
  service; [settings matrix](./settings-matrix.md) and
  [integration list](./integration-settings-list.md) supply controlled settings
  compositions without inventing persistence or provider management.
- [x] Investigate and document the latest component requirements in the
  [Arc interaction follow-up](../../_work/arc-interaction-follow-up-plan.md):
  universal ordinary-surface scroll treatment, managed drawers/BottomSheet,
  NumberField/table helpers and generic changed-digit display, complete
  PhoneInput with optional country/flag UI, TagInput, users/presence-aware
  MentionInput, revision-aware InlineEdit presentation and the complete
  [Floating Button Group](../../_work/floating-button-group-plan.md) action tray.
- [x] Implement the additive [FloatingButtonGroup](./controls/floating-button-group.md)
  working-source facade, token-mapped magnetic/press/label recipe and existing
  Tooltip/overlay composition. Preserve joined ButtonGroup/Toggle and document
  native commands, refs, scope guards and synchronous callback ordering.
- [x] Qualify FloatingButtonGroup source-copy closure, fresh installed-package
  imports/types/SSR/browser assets and the actual manual examples through its
  [adoption plan](../../_work/floating-button-group-plan.md), while retaining the
  frozen earlier public-export contract alongside the additive facade.
- [ ] Complete remaining FloatingButtonGroup real-device/accessibility review
  and representative-app visual approval through its
  [adoption plan](../../_work/floating-button-group-plan.md). Working-source API
  documentation is not a published upgrade or permission to replace every toolbar.
- [x] Add the bounded [managed-modal scroll treatment](../../_work/arc-scroll-surface-plan.md)
  in new adapter/wrapper/skin files. Existing body/panels, header tabs and responsive
  navigation retain native scroll ownership; `scrollTreatment:"native"` keeps the
  original shell recipe and its original files unchanged. The new internal
  interactions add smooth paging, snap-safe drag and bounded wheel conversion
  without replacing public ScrollArea or existing consumer adapters.
- [x] Qualify the bounded modal runtime, emitted assets, source-copy and installed
  archive while freezing the original shell/adapter/theme bytes; record that
  slice's actual results separately in the adoption ledger.
- [x] Qualify the bounded DatePicker days/months and ContextMenu root/submenu
  adoption: new wrappers, explicit custom-menu viewport, Arc/native options,
  managed-menu owner bridge and live presentation switching retain native engines.
  Actual browsers/types/manuals, direct/transitive CLI copies and a fresh installed
  archive pass; 16 original files remain byte-identical. Detailed evidence stays
  in the scroll ledger, not an app-wide release or retirement claim.
- [ ] Complete remaining ordinary surface adoption. Explicit Sheet bodies,
  detail/list layouts and the wider feature inventory remain separate gaps;
  expanded public ScrollArea options and direct-DOM performance work are not
  implemented by these bounded passes.
- [ ] Implement those bounded feature plans after their contracts/migrations
  are frozen. Managed drawers and the remaining input/number interaction
  extensions stay planned; they are not available merely because their
  requirements are indexed.
- [ ] Design independently installable UI and icon packages. Keep existing
  `@zero/framework` React/component/icon imports as compatibility re-exports where
  practical; map shared hooks, tokens, CSS scanning, peer dependencies and package
  versioning before changing distribution. This release does not split packages.

Follow the narrower [primitive roadmap](./primitives/roadmap.md),
[overlay roadmap](./overlays/roadmap.md), [public-page roadmap](./public-pages/roadmap.md),
[text roadmap](./text/roadmap.md), [AppShell roadmap](../app-shell/roadmap.md)
and [design-system roadmap](../design-system/roadmap.md) for the relevant owner.
The modal-manager redesign remains with [modals](../modals/roadmap.md), not a
second conflicting global manager in this umbrella.

Original implementations, compatibility paths and theme files remain available
through testing and comparison. Passing automated checks does not authorize
their removal: retirement also requires the user's explicit approval of the
new behavior and presentation.
Its implemented [DenseList](./dense-list.md) supplies native settings/member rows,
grouped content and single-action picker composition with existing Zero controls.
It follows the [layout plan](../../_work/modal-system-redesign-plan.md#dense-list-composite)
without replacing the domain controllers behind IntegrationSettingsList or SettingsMatrix.

Confirmed defects are corrected and tested during the audit rather than deferred
as product limitations. Additional whole-device, assistive-technology and
representative-app qualification is evidence work, not proof that the unchecked
future features have been implemented.

## Related Guides And Next Steps

- [Component index](./index.md) locates the current reusable families.
- [Configuration](./configuration.md) links the existing typed settings.
- [Source organization](./source-organization.md) locates current owners and
  defines the compatibility, copy and documentation migration procedure.
- [Guardian interfaces](../guardian/index.md) owns authority-aware control-plane evolution.
