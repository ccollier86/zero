---
id: zero.design-system.roadmap
type: roadmap
audience: [developer, agent, operator]
owner: design-system
status: draft
visibility: internal
system: design-system
feature: roadmap
maturity: supported
applies_to: ["2.6.0 working source; publication qualification pending"]
modes: ["React browser UI", "SSR markup", "managed frontend styling"]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "335b27372b0b8ef57a1e92cf93cec378923fe50b"
  snapshot: dirty
  date: "2026-10-10"
  evidence_level: source-observed
---

# Design-System Roadmap

[Design-system index](./index.md) · [Documentation index](../../index.md)

Semantic tokens, theme transitions/morph icon, animated pack, modern table
controls and existing public/application components are implemented capabilities.

Future user-requested direction:

- [x] Implement a parallel [next backing foundation](./foundation-next.md) with
  pure token/recipe API, scoped supplemental CSS, legacy compatibility, reference
  admission, read-only gaps and focused qualification. Old token files remain
  intact; this is not completion of frontend component adoption.
- [x] Correct the confirmed [follow-up backing integration defects](../../_work/design-token-theme-evolution-plan.md#follow-up-review-and-preservation):
  source precedence, trusted admission, shared backdrop scope and exact Sankey
  mode radius, within existing portal/motion owners.
- [x] Add the explicit [managed foundation selection](./style-build.md#select-the-managed-foundation),
  compiled-artifact admission, retained hashed assets, fresh installed-package
  qualification and [read-only Doctor theme diagnostics](../../cli/doctor/source-audit.md#backing-theme-diagnostics).
- [x] Switch the application default to next on the existing AppShell frame,
  retain explicit legacy rollback and leave document/public roots unmarked.
  Visual testing follows further user-requested changes, not this switch.
- [ ] Resolve the separate visual preservation decisions in the following design pass:
  navigation material, readable terminal identities and named variant paint.
  Keep the deliberately redesigned, slightly dynamic modal presentation.
- [x] Deliver the first [typography consumer baseline](./typography.md): shared
  recipes, actual core controls, specialized alias bridges and optional native
  Text/Heading with legacy fallbacks. Application shells now use next by default.
- [ ] Complete the [typography system plan](../../_work/typography-system-plan.md):
  use Arc's existing scale, body/display distinction and restrained hierarchy;
  extend the implemented recipes and staged consumers while preserving compact charts,
  readable prose and the successful sidebar.
- [ ] Continue public/landing/front-page component polish.
- [x] Deliver the structured modal manager's standardized header/content/actions
  and smaller close glyph, with owned stacking/portals and approved motion.
  Existing custom/legacy consumer migration is separately reviewed through
  [Doctor](../../cli/doctor/source-audit.md#structured-modal-migration).
- [ ] More adaptable control-plane/prefab blocks for platform/organization administration.
- [ ] Evaluate selected document viewers/editors, calendars, chat and other reusable plugins.
- [ ] Markdown-first documentation site using the same tokens.
- [ ] Targeted contrast, keyboard/assistive technology/reduced-motion/device/package style qualification.
- [ ] Refine the default theme and interaction vocabulary using the user's selected
  new components, preserving light/dark semantic tokens and consistent spacing,
  typography, focus and motion.
  Follow the [design token and default theme plan](../../_work/design-token-theme-evolution-plan.md):
  the ingestion/search organisms now use current tokens with an implemented
  anatomy/token ledger; build the wider language from their complete interfaces
  and further approved references.
  Query/dimension readouts, stage strips, small dividers, source/title/score rows
  and rank changes are reference anatomy alongside the animated maps.
  Arc is now the leading reference for the wider language, not only chart paint.
  The [Arc source and effects analysis](../../_work/arc-design-language-audit.md)
  records its neutral hierarchy, typography, density variants, selection-control
  roles and reusable motion alongside those earlier references. Promote shared
  highlights and stable measured geometry through existing Zero primitives;
  keep expressive effects optional and preserve approved modal/tooltip/hold,
  analytical-inspector and magnetic-sidebar behavior. First concrete backing
  values now exist; global promotion and additional component imports remain
  pending cross-family qualification.
  Magnetic highlights are now an explicit required default, not an optional
  effect to reconsider: preserve sidebar/public-navbar handoff and expand it
  across calendar dates, context/dropdown/submenus and menu-like popover choices.
  The [coverage contract](../../_work/design-token-theme-evolution-plan.md#required-magnetic-highlight-contract)
  distinguishes existing movement from missing family coverage and owns the
  interaction/verification requirements.
  The user also selected [compact dashboard content, default Morph Select styling
  and shared Arc UI ScrollArea treatment](../../_work/design-token-theme-evolution-plan.md#compact-dashboards-rich-pickers-and-shared-overflow).
  Preserve the sidebar while tightening headings, controls and metric cards;
  share rich menu/Cascader rows, magnetic highlights and exact conditional edge
  fades/overlay bars. Keep existing form, keyboard, tree and portal authority;
  apply the effect to the real viewport rather than nesting another scroller.
  The first Morph Select/anchored/magnetic/Arc-scroll/Card pass is implemented;
  its [qualification ledger](../../_work/design-token-theme-evolution-plan.md#anchored-controls-and-card-follow-up)
  distinguishes delivered contracts from wider custom/context-menu adoption
  and representative-app visual approval.
  The [new chart plan](../../_work/charts-system-plan.md) adds the supplied Sankey:
  six series, quiet ribbons, name/value hierarchy, source tracing and a compact
  aligned inspector inform the chart-specific language before global defaults change.
- [ ] Evaluate a separately installable icon package alongside the reusable UI
  package. Preserve familiar framework imports through an explicit compatibility
  boundary; avoid duplicate React contexts, icon registries or theme providers.
- [ ] Complete the [original-theme retirement gates](./foundation-next.md#retire-the-original-theme-safely)
  before any approved deletion. Extract neutral stylesheet infrastructure,
  preserve explicit legacy/public owners and rollback, update distribution/
  Doctor evidence and qualify actual consumers. Default-next is not deletion approval.
- [ ] Continue the [component organization plan](../../_work/frontend-component-organization-plan.md)
  beyond the implemented Card/Select, date/time, Popover/shared-mechanism and
  frontend-facade passes, preserving stable
  public/copy paths. Structural moves do not
  authorize palette, animation or legacy-import removal.
- [ ] Apply the [latest Arc interaction plans](../../_work/arc-interaction-follow-up-plan.md)
  through the same theme/typography/motion catalog. Scroll adoption, drawer
  detents, numeric controls and input refreshes are documented but not implemented
  by the current organization phase; preserve approved cross-family effects.

The [component roadmap](../components/roadmap.md) owns the distribution/dependency
plan. New references and package separation are future work, not changes to
current imports in this release.

These are ideas/plans, not APIs or a claim of present compliance. Confirmed
interaction/lifecycle defects get source corrections and tests rather than
being accepted as limitations. [Modals](../modals/index.md),
[current control conventions](./component-conventions.md) and
[agent plans](../../agents/tooling/roadmap.md) connect future work to existing
ownership.
