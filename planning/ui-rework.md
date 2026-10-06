# Upcoming Zero UI Rework

[Working plans](./index.md) · [Documentation plugin plan](./documentation-plugin.md)

Status: planned; no global theme redesign, component relocation, or package
split is implemented by this note. Recorded 2026-10-06 from the user's design
direction and inspected Zero 2.4.0 main
`636b1c01b3484317df56ce624c7cd57976ee417c`.

## Intended Experience

Zero should feel like one polished, contemporary product across application
screens, administrative control planes, public pages, and optional plugins.
Keep the expressive components and useful animation already present, while
improving typography, visual hierarchy, density, and consistency.

The current UI is not being discarded. The desired evolution is a more
intentional shared system, with compact operational screens and comfortable
reading/public experiences derived from the same theme.

The user's primary visual direction is now **Linear-inspired**: modern,
beautiful, precise typography, spacing and hierarchy, with plentiful but
tasteful microinteractions and animation. This applies to frontend components
and backend-facing administration/control-plane UI. It does not change Bun,
Elysia, Guardian, Fabric or service architecture as a styling side effect.

## Linear As The Main Visual Reference

Linear's [March 2026 design explanation](https://linear.app/now/behind-the-latest-design-refresh)
describes quieter navigation, smaller/compact tabs and icons, softer borders,
and a less saturated default palette. Its
[2024 redesign account](https://linear.app/now/how-we-redesigned-the-linear-ui)
also discusses alignment, hierarchy and shared theme variables. These are
dated primary references, not evidence that Zero should copy exact current
Linear fonts, measurements, artwork or proprietary implementation.

For Zero, translate that direction into:

- **Typography:** a coordinated interface/reading/monospace scale, precise
  weights and line heights, restrained headings, and clear secondary labels.
  Choose the actual font treatment in representative compositions before
  changing platform defaults.
- **Density:** compact useful controls and tables, intentional group spacing,
  and consistent icon/text alignment. Reading prose and touch interfaces keep
  their own appropriate density within the same scale.
- **Surfaces:** neutral light/dark surfaces, subtle elevation and dividers,
  deliberate focus contrast, and configurable Zero accents reserved for useful
  emphasis and semantic state.
- **Hierarchy:** quiet surrounding chrome, content-first workspaces, predictable
  action placement, and inline/contextual controls that appear where useful.
- **Interaction:** immediate feedback, coordinated selection/hover transitions,
  smooth disclosure and panel changes, and informative pending/success states.
- **Consistency:** one shared theme and motion vocabulary across tables, forms,
  organization/user controls, storage, schema editing and the docs plugin.

These are Zero's proposed design choices informed by the reference, not claims
about Linear's internal implementation. The current palette remains in place
until a qualified, reviewed theme change is explicitly implemented.

## Shared Theme And Full Tokenization

- [ ] Establish an inventory of existing theme variables and hardcoded visual
  values, with the owning components and variants recorded.
- [ ] Define a coherent type scale: font families, sizes, weights, line heights,
  letter spacing, headings, labels, body text, and monospaced content.
- [ ] Define spacing and density scales covering control heights, internal
  padding, gaps, row heights, icon sizes, and content sections.
- [ ] Refine surfaces, text contrast, semantic accents, hover/selection states,
  dividers, borders, radii, shadows, and focus treatments in light/dark themes.
- [ ] Make visual defaults in components consume the main theme. Centralizing
  colors alone does not complete tokenization.
- [ ] Define component/domain aliases only where their meaning warrants them;
  aliases inherit shared scales instead of creating unrelated palettes.
- [ ] Support deliberate density variants, preserving keyboard usability,
  touch targets, text zoom, readability, and accessible contrast.
- [ ] Document normal application overrides, token inheritance, and migration
  guidance when existing default dimensions change.

Current source evidence: [shared stylesheet](../src/frontend/styles/globals.css),
[Button](../src/components/ui/button.tsx), [Input](../src/components/ui/input.tsx),
[Card](../src/components/ui/card.tsx), and [Table](../src/components/ui/table.tsx).
The stylesheet already centralizes important colors, fonts, and radii; multiple
components still declare their sizing/spacing directly. This is a targeted
inventory starting point, not a completed whole-library audit.

## Layout And Control-Plane Quality

- [ ] Tighten toolbars and tables without turning controls into cramped forms.
  Keep consistent alignment and intentional grouping of related actions.
- [ ] Apply coherent action hierarchy: primary, secondary, contextual, and
  destructive actions with restrained semantic color.
- [ ] Review adaptive user/organization, Data Studio, storage, and RBAC views
  at realistic narrow and wide sizes, including long labels and large datasets.
- [ ] Preserve the useful master/detail model: independently scrolling panes,
  bounded height chains, accessible mobile list/detail transitions, and an
  action bar that remains reachable.
- [ ] Keep contextual information in the details pane and operational actions
  in the appropriate toolbar/action bar instead of disconnected oversized cards.
- [ ] Review modal composition: visible headings/actions, safe close-button
  placement, sensible widths, scroll ownership, and unsaved-change behavior.
- [ ] Keep inline editing visually smooth, typed, acknowledged, and consistent
  with the rest of the controls.

## Motion And Microinteractions

- [ ] Create shared timing, easing, spring, distance, and reduced-motion tokens.
- [ ] Establish a small interaction vocabulary for menus, dialogs, tabs,
  navigation, tables, buttons, selection, and loading.
- [ ] Package shared behavior in reusable primitives/hooks where appropriate;
  token values alone do not implement coordinated interactions.
- [ ] Consider wider use of Zero's gliding/magnetic adjacent-item highlight
  across tabs, segments, sidebars, menus, and suitable toolbar groups.
- [ ] Distinguish transient hover from persistent selection and keyboard focus.
- [ ] Keep operational feedback fast and restrained; public/showcase surfaces
  may use more expressive motion from the same vocabulary.
- [ ] Verify focus handoff, touch behavior, pointer cancellation, interrupted
  transitions, and reduced motion. Animation must not delay usable interaction.

### Interaction Examples To Include In The First Reference Gallery

- Shared gliding hover/selection backgrounds in appropriate tabs, navigation
  and segmented controls, with a visible distinction between the states.
- Small, consistent button/icon feedback and clear pending/accepted feedback
  for real acknowledged operations.
- Coordinated menu/popover entrances and focus handoff, using the existing
  interaction primitives and their native dismissal lifecycle.
- Smooth details-pane/disclosure transitions that preserve scroll/focus and
  respect the existing bounded master/detail workspace.
- Polished inline-edit entry, validation, pending acceptance and failure states.
- Subtle row selection, contextual action reveal and loading transitions that
  preserve layout stability and current selection.

Make motion interruptible and shared by semantic role, with central durations,
easing/spring and displacement defaults. Do not animate every property through
a generic transition. Decorative pointer effects must not move the actual hit
target or make precise controls harder to operate. Hover-only behavior needs
keyboard/touch equivalents where it exposes information or actions.

Motion never proves a write succeeded, hides a permission failure, or changes
the existing acknowledgment/error/authorization contract. Reduced-motion users
still receive clear state transitions and immediate feedback.

## Component Organization And Packaging

- [ ] Inventory public components, hooks, icons, low-level primitives, and
  domain/control-plane components against actual package exports.
- [ ] Define a logical folder structure with clear responsibilities and owners.
- [ ] Identify true duplicates by behavior and public contract; do not remove
  components merely because they have similar names or appearances.
- [ ] Evaluate optional packages for primitives, icons, expressive/public UI,
  and domain/plugin UI after inspecting real dependency and bundle boundaries.
- [ ] Preserve one compatible React runtime, shared tokens, provider contracts,
  and a deliberate public-import/migration story across any package split.
- [ ] Verify installed-package styles, tree shaking, SSR, browser builds, and
  compiled deployment rather than assuming source-tree imports prove packaging.
- [ ] Update inventories, examples, backlinks, and upgrade guidance alongside
  approved import or composition changes.

No package names, split boundaries, component removals, or breaking import
changes are decided by this note.

## Reference Direction

Linear's application design is the primary reference for Zero's shared visual
language. [ReUI's component documentation](https://reui.io/docs) and
[shadcn/ui](https://ui.shadcn.com/docs/components/base/button) remain useful
secondary references for component details and example presentation.
[Elysia's docs](https://elysiajs.com/at-glance) are now the user's primary
documentation-layout reference, including nested navigation guides and a
restrained footer. [Starlight](https://starlight.astro.build/) remains useful for
content-driven generation. Neither defines a separate Zero theme: the docs
plugin initially keeps current public/frontend tokens, with the later redesign
remaining separate.

Use these references to guide an original, coherent Zero system. Reference
screenshots do not imply permission to copy proprietary component code, fonts
or assets; source reuse requires license review and attribution.

## Implemented Working Feature: CodeBlock Upgrade

The user approved
[pheralb's Code Blocks](https://code-blocks.pheralb.dev/docs/getting-started/prerequisites)
and its surrounding components/utilities as a replacement for Zero's existing
CodeBlock. The replacement is implemented on `feature/markdown-documentation-plugin`
and targets framework 2.5.0; it is not published. The public convenience component
remains `CodeBlock`, with composable parts around the same engine. The old
renderer and obsolete styles are removed, not retained as a competing block.

Its [examples](https://code-blocks.pheralb.dev/) demonstrate filename headers,
line numbers, line/word emphasis, diff notation, focus notation, wrapping, and
line anchors. The [React component](https://code-blocks.pheralb.dev/docs/react/code-block)
also separates wrapper, header, group, icon, and content responsibilities.

- [x] Review the full relevant component/utility family, not only its container.
- [x] Compare against existing Zero CodeBlock capabilities and preserve its
  public props, imports, file tabs, copy behavior, and explicit theme overrides.
- [x] Decide whether to adapt the upstream implementation or integrate selected
  capabilities into the existing component; avoid two competing official blocks.
- [x] Map all visuals, highlighting, diff/focus states, and interactions to Zero
  tokens and controls. Upstream neutral colors are not the Zero theme contract.
- [x] Reuse Zero's icon system and copy/observability hooks where appropriate.
- [x] Verify upstream licensing/attribution and qualify dependencies, SSR,
  installed packages, Bun compatibility and graceful fallback.
- [ ] Set wider application bundle-size budgets during the optional UI-package audit.
- [x] Review optional block compositions separately; do not introduce another
  UI primitive library or an MDX execution requirement implicitly.

The original [docs-plugin decision gate](./documentation-plugin.md#codeblock-upgrade-candidate)
is retained as design history. Supported usage is in the
[CodeBlock guide](../docs/frontend/code-block.md), with actual source/browser/archive
checks in the [qualification ledger](../docs-next/_work/audits/docs-plugin-qualification.md).
This focused replacement does not implement the global theme/library redesign.

## Relationship To The Documentation Plugin

The [documentation plugin](./documentation-plugin.md) uses current Zero theme
defaults, with full token-driven typography, layout, surfaces, highlighting,
and motion from its first implementation. Reused components must be checked
for token gaps. Necessary shared token extensions can keep today's appearance.

The plugin does not depend on first completing this whole UI rework. Its theme
contract should allow future improvements to flow through without rebuilding
its page templates or introducing a separate documentation theme.

## Suggested Work Sequence And Completion Evidence

1. Inventory the library and identify shared visual/interaction inconsistencies.
2. Produce a small Linear-inspired reference gallery using existing Zero
   components: AppShell/sidebar, toolbar/table, master/detail, contextual menu/
   modal, and a docs article with callouts/code/footer navigation. Keep this
   isolated from global production defaults while the direction is reviewed.
3. Agree on the shared token contract and review representative light/dark,
   compact/comfortable, narrow/wide, and reduced-motion examples with the user.
4. Migrate shared primitives, then domain components, in reviewable increments.
5. Address organization and any approved package split with compatibility tests.
6. Qualify the installed package in real compositions and update the docs.

Completion requires an actual token-consumption audit, visual review,
accessibility/interaction checks, package-mode verification, and an explicit
upgrade account. A new palette or a few attractive screenshots are insufficient
evidence that the entire component library has been made consistent.

Start with the shared type/spacing/surface/control/motion foundation and this
representative gallery. Migrate the existing library in reviewable slices;
component relocation and optional package splitting remain separate decisions.
