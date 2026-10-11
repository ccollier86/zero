---
id: zero.frontend.ui-reference
type: reference
audience: [developer, agent, maintainer]
owner: frontend-components
status: draft
visibility: internal
system: frontend
feature: ui-reference
maturity: supported
applies_to: ["2.6.0 working source; component and theme upgrades are not a published release"]
modes: [browser, SSR, application, public-pages, source-copy]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "335b27372b0b8ef57a1e92cf93cec378923fe50b"
  snapshot: dirty
  date: "2026-10-11"
  evidence_level: source-observed
---

# UI Reference: Tokens, Motion And Component Systems

[Frontend index](./index.md) · [Documentation index](../index.md)

Start here when building or changing a Zero interface. This is the shared routing
reference for design tokens, typography, action-to-animation policy and component
systems. Each system's linked manual owns its exact API, options and lifecycle;
this page does not replace those contracts or make private helpers public.

Use [Application UI development](../guides/application-ui-development.md) for
authenticated dashboards, settings and workspaces. Use
[Public UI development](../guides/public-ui-development.md) for landing pages and
content assembly. Both follow this reference rather than maintaining competing
default-theme or motion rules.

For an existing application, use the [UI upgrade handoff](../guides/ui-upgrade.md)
for the framework branch, component/manual map, dependency and source-copy
procedure, Doctor triage and application acceptance gates.

## Agent Workflow

1. Check the installed package's actual exports and version. Working-source
   additions below are not a promise about an older installed package.
2. Choose the application or public presentation lane, then an existing system
   from the index below. Read its full manual before composing its API.
3. Prefer its facade for standard assembly, exported parts for deliberate
   composition and documented overrides for local customization. Preserve the
   system's state, focus, scrolling, portal and service owners.
4. Keep permissions, accepted writes and operation truth with the authoritative
   backend. A UI animation, optimistic number or success toast is not acceptance.
5. Qualify the changed consumer and its distribution paths. Do not infer visual
   approval or safe legacy deletion from a source-only check.

## Tokens And Typography

The [next theme foundation](./design-system/foundation-next.md) owns the canonical
role catalog, light/dark values, compatibility aliases and pure
`@zero/framework/design-system` APIs. AppShell defaults to the scoped next
foundation and compact density. A custom frame activates its own explicit next
boundary; unmarked siblings and public surfaces are not automatically migrated.
The application stylesheet includes retained original infrastructure followed by
the next supplement. The original theme and explicit legacy rollback remain
available. [Style builds](./design-system/style-build.md) explain managed output
and application-owned CSS pipelines.

Choose semantic roles for surface, text, border, status, focus and component
feedback. Do not substitute strong primary-action color for quiet selected-row
material, or hardcode a reference site's palette into a component. Shared chart
roles standardize inspector, typography and frame treatment while preserving
stable series/source identity. Component-local aliases are scoped tuning points,
not another competing theme definition.

| Concern | Canonical reference and rule |
| --- | --- |
| Foundation and scoped overrides | [Next foundation](./design-system/foundation-next.md): catalog, token composition, density and scoped activation. Explicit visual overrides remain deliberate. |
| Retained compatibility values | [Legacy tokens](./design-system/tokens.md): original root/dark values and Tailwind mappings; not the new default-role catalog. |
| Application versus public intent | [Lanes](./design-system/lanes.md): dense working surfaces versus expressive public content. Neither is a security boundary. |
| Theme preference and switching | [Themes](./design-system/themes.md): provider, persistence and transition fallback. Do not install a competing theme owner per component. |
| Text hierarchy | [Typography](./design-system/typography.md): CSS-first roles and optional native Text/Heading. Body is 14px, support/control 13px; headings follow semantic document levels, not font-size wishes. |
| Inputs and specialized text | [Typography](./design-system/typography.md#shared-scale-and-roles): native input is 16px on small screens; modal, tooltip, analytical, inspector and list roles keep task-specific hierarchy. |
| Fonts and assets | [Typography](./design-system/typography.md): body/display/mono stacks are tokens; the application still loads its actual font assets. |
| Icons | [Named icons](./design-system/icons.md), [registry](./design-system/icon-registry.md) and [icon animation](./design-system/icon-animation.md): semantic names, safe lookup and owned animation triggers. |

Keep local role overrides close to their intended consumer. Floating surfaces
project their supported source/owner theme without losing the active modal's
portal, z-index or interaction fences. Do not fix a scoped-theme issue by adding
a global palette override to every popup.

The [theme evolution ledger](../_work/design-token-theme-evolution-plan.md) and
[Arc design audit](../_work/arc-design-language-audit.md) retain the reference
evidence and future direction. They are planning evidence, not extra production
token catalogs. Removing the original theme requires the
[retirement gates](./design-system/foundation-next.md#retire-the-original-theme-safely),
including shared infrastructure extraction and representative-app approval.

## Which Motion Belongs To Which Action

Use the family-owned recipe. The relationship to the action matters more than
making every surface use the same animation. Full numeric options and reduced-
motion behavior live in the linked manuals.

| Action | Default presentation and owner |
| --- | --- |
| Open a modal or dialog | [Modal motion](./modals/motion.md): From Button with a supplied usable trigger; Rise when no usable trigger exists. Paired reverse exit, dim + blur and page recession. Duration multiplier 1.5 means 975ms origin entrance, not 1.5× velocity. One manager owns stacking, focus, dismissal and cleanup. |
| Confirm an important deletion | [Confirmation](./modals/confirm.md) and [HoldButton](./modals/hold-button.md): use the supported destructive/hold path. The real 1500ms hold interval does not scale with decorative animation or reduced motion. Do not replace it with a fast decorative progress effect. |
| Open/select/close a Select | [Morph Select](./components/controls/select.md#morph-presentation-and-rich-options): actual trigger-to-list shape, native selection and magnetic row handoff; distinct 400ms open, 340ms close, 280ms highlight and 420ms width calibrations. Rich descriptions/metadata do not become the submitted title/value. |
| Open an ordinary anchored panel or picker | [Popover](./components/overlays/popover.md#anchored-motion): restrained .97 scale/5px travel, 580ms settle and 160ms fade; 140ms exit. Actual collision-resolved side sets origin. Date/TimePicker and Combobox reuse this, not the modal's full rectangle morph. Explicit Motion overrides remain caller-owned. |
| Move through selectable/action rows | [Choice controls](./components/primitives/choices.md), [Command](./components/primitives/command.md) and [DropdownMenu](./components/overlays/dropdown-menu.md): shared gliding magnetic material follows native pointer/keyboard state. Hover paint is not selection or an accepted action. Never add a second list controller just for the highlight. |
| Move through a floating action tray | [FloatingButtonGroup](./components/controls/floating-button-group.md): additive working-source stationary commands with one moving highlight, independent press feedback and reserved-label handoff. The tray uses a 420ms/.16 movement spring, not a command deadline. Joined ButtonGroup and Toggle retain their APIs; Tooltip keeps the approved Grow policy and overlay placement stays with its own owner. |
| Hover a content card | [ContentCard](./components/surfaces/card.md#contentcard-and-managed-quick-look): mouse-only 2px lift and 1.04 media zoom; status rolls use the family recipe. Plain Card is a static native composition, not an automatic hover controller. Touch does not acquire synthetic hover; reduced motion removes decorative travel. |
| Expand a ContentCard quick look | [Managed quick look](./components/surfaces/card.md#contentcard-and-managed-quick-look): article geometry feeds the existing modal system; only the title opens it, and independent actions remain independent. Supply a deliberate details body rather than duplicating live preview forms. The public ExpandableCards gallery is a separate contract. |
| Describe a control on hover/focus | [Tooltip](./components/overlays/tooltip.md): Grow/400ms, arrow on; rich title/description/shortcut options. Hover intent, warm window and grace are separate from presentation duration. TooltipGroup morphs one bubble between triggers. Interactive content belongs in Popover. |
| Inspect chart data | [Charts overview](./charts/index.md): compact shared inspection surface with its own 120ms feedback, not the generic panel entrance. Chart-owned tracing, ranking, scrubbing and data morphs keep their individual manuals' recipes. |
| Receive realtime data or show operation progress | [DataTable](./data-controls/data-table/index.md), [Charts](./charts/index.md) and [vector visualizations](./components/vector-visualization.md): animate actual admitted data/state. Do not fabricate backend phases, rerank results, completion or stream timing to make a demo look busy. |
| Scroll a long surface | [ScrollArea](./components/primitives/scroll-area.md): Arc-style conditional edge fades and overlay rails decorate the actual bounded viewport. No overflow means no thumb. Select/Command/picker reuse exists; [remaining modal and wider adoption](../_work/arc-scroll-surface-plan.md) is planned. Preserve existing scroll owners without a nested redundant scroller. |
| Move through navigation or collapse a shell | [Sidebar](./components/overlays/sidebar.md), [AppShell](./app-shell/index.md) and [public navigation](./components/public-pages/navigation.md): retain their polished magnetic/animated-icon and collapse behavior. Organization or typography work does not retune that interaction. |
| Change calendar/month/date presentation | [Dates and time](./components/primitives/dates-and-time.md): retain the family caption/date-roll and native selection model; panel opening uses anchored motion. Custom day renderers retain their own semantics and need separate qualification. |

Do not apply From Button to every hover card, tooltip or chart inspector. Do not
apply Select morphology to arbitrary forms. Do not use CSS motion as an async
operation deadline. Reduced motion removes decorative travel/blur/particles
according to each owner, without shortening hold confirmation, bypassing
validation or changing accepted-write semantics.

## Systems, Blocks And Primitive Index

This tiered index routes to system overviews and focused manuals. A system
overview explains shared facade/data/composition rules and indexes its individual
components. A public reusable part has a documented reference section or page;
a helper used only inside one block stays in that block's manual.

| Family or assembly task | Overview and individual references |
| --- | --- |
| Application frame and navigation | [AppShell](./app-shell/index.md), [Sidebar](./components/overlays/sidebar.md), [Breadcrumbs](./components/primitives/breadcrumbs.md), [public navigation](./components/public-pages/navigation.md). |
| Native fields and actions | [Controls index](./components/controls/index.md), [Inputs/buttons](./components/primitives/inputs.md), [ButtonGroup](./components/primitives/button-group.md), [FloatingButtonGroup](./components/controls/floating-button-group.md), [Select](./components/controls/select.md), [other choice controls](./components/primitives/choices.md), [Command](./components/primitives/command.md), [dates/time](./components/primitives/dates-and-time.md), [tags/progress/validation](./components/primitives/tags-and-validation.md), [inline editing](./components/primitives/inline-editing.md). |
| Surface composition and identity | [Surfaces index](./components/surfaces/index.md), [Card parts and ContentCard](./components/surfaces/card.md), [Badge](./components/primitives/surfaces.md#badge), [Avatar](./components/primitives/surfaces.md#avatar), [Separator/Skeleton](./components/primitives/surfaces.md#separator-and-skeleton), [AvatarGroup](./components/avatar-group.md), [DenseList](./components/dense-list.md). |
| Small floating interactions | [Overlays index](./components/overlays/index.md), then [Popover](./components/overlays/popover.md), [DropdownMenu](./components/overlays/dropdown-menu.md), [ContextMenu](./components/overlays/context-menu.md), [Tooltip](./components/overlays/tooltip.md) and [radial menu](./components/overlays/radial-menu.md). |
| Dialog workflows | [Modals overview](./modals/index.md): manager, content/actions, tabs/nav layouts, motion/options, forms, confirm/prompt, hold deletion, workflow progress and exact lifecycle/scope retirement. |
| Layout and overflow | [ScrollArea](./components/primitives/scroll-area.md), [list/detail](./components/primitives/list-detail.md), [Resizable](./components/primitives/resizable.md), [Tabs](./components/primitives/tabs.md), [Collapsible](./components/overlays/collapsible.md). |
| Reactive tables and control planes | [Data controls](./data-controls/index.md) → [DataTable](./data-controls/data-table/index.md), [Data Studio](./data-studio/index.md). Plain [Table/Pagination](./components/primitives/tables-and-pagination.md) markup does not install that query engine. |
| Charts and analytical organisms | [Zero Charts API and chart index](./charts/index.md) → Sankey, Race Bar, Funnel, Arc and handmade charts. Retained Recharts/statistics compatibility is explicitly separate. |
| Ingestion and vector search | [Vector visualization](./components/vector-visualization.md): reusable pieces, assembled organisms, real operation adapters, externally supplied observations and explicit public stories. |
| Schema-backed forms | [Forms overview](./forms/index.md): headless state, field composition, generated forms, steps and accepted submission. |
| Authenticated feature blocks | [Guardian UI](./guardian/index.md), [Storage](./storage/index.md), [Notifications](./notifications/index.md), [Rooms](./rooms/index.md) and [Torrent](./torrent/index.md): service-backed APIs and scope owners. |
| Structured settings and special fields | [SettingsMatrix](./components/settings-matrix.md), [integration settings](./components/integration-settings-list.md), [Cascader](./components/cascader.md), [JSON editor](./components/json-editor.md), [SignaturePad](./components/signature-pad.md), [PhoneInput](./components/phone-input.md), [sensitive display](./components/sensitive-display.md). |
| Text, code and transcripts | [Typography](./design-system/typography.md), [text index](./components/text/index.md), [code-block composition](./components/public-pages/code-block-composition.md), [Kbd](./components/kbd.md), [scroll anchoring](./components/scroll-anchoring.md). |
| Public sections and content collections | [Public component index](./components/public-pages/index.md) → navigation, Hero, sections, backgrounds, FAQ, code and collections. Keep their existing contracts until a deliberate migration. |
| Complete component discovery | [Component index](./components/index.md), [primitive index](./components/primitives/index.md), [overlay index](./components/overlays/index.md), [configuration](./components/configuration.md). Use these for family parts/options not repeated in this routing table. |

## Composition, Ownership And Qualification

Standard facades reduce repeated anatomy and make defaults reliable; they are
not mandatory schemas for every screen. Compose documented parts when the
standard facade does not fit. Use native children, slots, classes/styles and
family options as intended, while preserving accessible names and independent
actions. A customized surface still uses its system's manager where applicable.

Do not create a second modal host, selection context, auth transport or realtime
subscription owner to restyle one component. Do not replace the manager's X with
a large bespoke close action or place content under its reserved header. Do not
wrap switches/selects in an outer row button. Do not infer public imports from
the physical folder of a private geometry/runtime helper.

[Source and documentation organization](./components/source-organization.md),
[component conventions](./design-system/component-conventions.md) and the
[organization plan](../_work/frontend-component-organization-plan.md) define
canonical family ownership, compatibility facades and source-copy boundaries.
The implemented passes organize Card, Select, date/time controls, Popover and
shared overlay mechanisms, split frontend export maintenance, and group the
five chart manuals with their system overview. Larger component and client
folders remain staged; this is not a completed whole-library migration.

The [latest Arc interaction plans](../_work/arc-interaction-follow-up-plan.md)
record drawers/BottomSheet, wider scroll adoption, numeric display/fields and
Tag/Phone/Mention/InlineEdit follow-up. Those extensions remain planned.
[FloatingButtonGroup](./components/controls/floating-button-group.md) now has an
additive working-source facade and full manual; it is not a published package
upgrade or representative-app visual approval. Current family manuals remain
the source for usable APIs.

Before handing off a UI change, check native types/refs, SSR and browser behavior,
keyboard/touch/focus, overflow/collision/portal ownership, reduced motion,
controlled state, active-scope retirement and accepted backend results. Qualify
installed imports and actual copied CSS/helper closure, not only checkout
compilation. Verify documentation links and examples. The
[Doctor upgrade audit](../cli/doctor/source-audit.md#upgrade-auditing) reports
bounded static evidence; it is not full UI certification or permission to
overwrite custom copies. Representative-app visual, contrast, delayed-font and
assistive-technology review remain separate qualification gates.
