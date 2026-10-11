---
id: zero.design-system.foundation-next
type: how-to
audience: [developer, agent, maintainer]
owner: design-system
status: draft
visibility: internal
system: design-system
feature: opt-in-theme-foundation
maturity: experimental
applies_to: ["2.6.0 working source; application default; legacy retained; publication qualification pending"]
modes: [browser, SSR, light, dark, application, public-pages]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "335b27372b0b8ef57a1e92cf93cec378923fe50b"
  snapshot: dirty
  date: "2026-10-10"
  evidence_level: source-observed
---

# Next Theme Foundation

[Design-system index](./index.md) · [Documentation index](../../index.md)

The new backing design-token system is the application-shell default, alongside
the retained original foundation. It provides an Arc-led neutral palette,
compact dashboard geometry and task-specific motion recipes. Public/landing
surfaces outside the application boundary keep their existing tokens.
The [theme evolution plan](../../_work/design-token-theme-evolution-plan.md#parallel-foundation-implementation-and-migration-gates)
records completed checks and the remaining component-adoption gates.

Separate package entrypoints keep the switch reversible:

- `@zero/framework/design-system`: pure token composition, catalogs, motion
  recipes, CSS generation and source-text migration diagnostics.
- `@zero/framework/styles-next.css`: generated, scoped CSS supplement.
- `@zero/framework/styles.css`: application entrypoint loading the original
  styles followed by that supplement.
- `@zero/framework/styles-legacy.css`: retained original foundation entrypoint.

The original global/component token files and backend
`@zero/framework/tokens` authentication service remain separate. Importing the
new TypeScript API does not install CSS, load fonts, create a provider, connect
services or inspect browser preferences.

## Activate An Explicit Boundary

Managed builds include the new foundation by default. In an application-owned
CSS pipeline, import the application entrypoint:

```css
@import "@zero/framework/styles.css";
```

For separately controlled scope adoption, the equivalent explicit import order is:

```css
@import "@zero/framework/styles-legacy.css";
@import "@zero/framework/styles-next.css";
```

`AppShell` now places `data-zero-theme="next"` and compact density on its existing
outer frame. It adds no wrapper and does not mark `<html>` or `<body>`, preserving
public pages and the existing ThemeProvider's saved light/dark/system selection.
For a custom application frame, place `data-zero-theme="next"` on the chosen
container yourself. Loading the supplement without that attribute leaves
unmarked legacy roots and sibling applications unchanged.
Explicit typography markers/Text/Heading still opt into their recipes.
For Zero-managed builds, omission or `AppConfig.themeFoundation: 'next'` compiles
the supplement after the original entrypoint. Explicit `'legacy'` keeps the old
stylesheet. This build selection does not itself add markup boundaries, choose the
browser's mode or load fonts. See
[managed stylesheet selection](./style-build.md#select-the-managed-foundation).

For a top-level rollback, use `themeFoundation="legacy"` on `AppShell` and
`themeFoundation: 'legacy'` in managed server configuration, or import only
`styles-legacy.css` in an app-owned pipeline. This is not a nested legacy
isolation boundary: a legacy shell intentionally placed inside a next ancestor
still inherits that ancestor's custom properties. Existing artifacts without
foundation metadata remain legacy and require explicit legacy configuration or
a rebuild for the new default.

For app-owned source, `zero add theme-foundation --target ./src --dry-run`
previews the new target. Omitting `--dry-run` copies `design-system/` and
`frontend/styles/theme-next.css` under that target directory, skipping existing
files unless `--force` is explicitly used. It does not edit configuration, CSS
imports, markup attributes or old token files. Import the copied supplement
after legacy styles and apply the copied `createThemeAttributes()` yourself.
Package imports remain the maintained alternative; see
[source ownership](../../cli/tooling/source-copy.md).

Complete React boundary example with a validated, application-owned override:

```tsx
import type { CSSProperties, ReactNode } from 'react';
import { createThemeAttributes, createThemeTokens } from '@zero/framework/design-system';

const attributes = createThemeAttributes({ mode: 'light', density: 'compact' });
const customized = createThemeTokens({
  mode: 'light',
  overrides: { '--zero-theme-primary-fill': '#224466' },
});
const style = {
  '--zero-theme-primary-fill': customized['--zero-theme-primary-fill'],
} as CSSProperties;

export function NextThemeScope({ children }: { children: ReactNode }) {
  return <section {...attributes} style={style}>{children}</section>;
}
```

`createThemeAttributes()` omits the mode by default: the boundary follows an
existing `.dark` host/ancestor class, otherwise light. Explicit `light` or `dark`
overrides that class for token paint. Explicit `system` follows CSS media
preferences without an SSR browser read. The pure `createThemeTokens()` and
`createThemeDeclarations()` functions instead default to concrete **light**;
they do not accept `system`. Use an explicit mode when resolving a snapshot.

Nested next boundaries get independent palettes and freshly resolved aliases.
Passive `data-zero-density` regions alter density only; they preserve inherited
paint and local geometry overrides. Passive public wrappers inherit the next
palette, suppressing legacy public modal/tooltip paint resets. A nested local
palette change should establish another next boundary: CSS `var()` aliases
otherwise inherit the values computed at their declaring ancestor.

## Roles, Density And Compatibility

The catalog currently contains **462 canonical properties**: 220 existing
foundation/component roles, 185 typography properties across 37 complete text
recipes, and 57 scoped [FloatingButtonGroup roles](../components/controls/floating-button-group.md#tokens-motion-and-measurement).
`getThemeTokenCatalog()` returns an
immutable, sorted name/light/dark/responsibility catalog for normal-motion,
compact defaults. `THEME_DENSITY_TOKENS` and `resolveThemeMotion()` expose the
other density and preference variants. Schema version `THEME_FOUNDATION_VERSION`
is `1`; it is not a framework release number.

| Responsibility | Current next-foundation choice |
| --- | --- |
| Materials | Light canvas/surface/raised white, quiet inset layers; dark canvas `#141414`, surface `#191919`, raised `#1f1f1f`. |
| Text and states | Separate primary/secondary/muted text, control foregrounds, state ink/solid/wash roles; sampled ordinary text pairs meet 4.5:1 and control-identification/focus pairs meet 3:1. |
| Action versus hover | Strong neutral action fill is distinct from the quiet interaction wash. Arc's strong accent does not silently become Zero's soft `--accent`. |
| Typography | Applied 14px body and 13px compact-control recipes, Inter body/Geist display/mono families, optional native Text/Heading and specialized compatibility roles. No font downloads. |
| Density | Compact control 32px, comfortable 36px, touch 44px at a 16px root. Compact card padding 16px and section gap 16px. These are roles, not rewrites of hardcoded component classes. |
| Shape | Control/panel/surface 6/8/10px-equivalent; modal 14px, tooltip 8px and analytical inspector 10px remain task-specific. |
| Inspection | Shared 9×12px padding, 12px/1.45 support text, 17px/1.3 value and aligned rows. Existing chart inspector ownership is retained. |
| Floating action trays | Separate quiet/raised materials, transient/press/mode fills and valid local concentric radii. Standard/compact visual geometry respects the current density's hit-target minimum; it does not enlarge ordinary Buttons. |
| Close affordance | 14px glyph, 32px target; coarse-pointer target role 44px without enlarging the glyph. Keyboard focus remains visible. |
| Charts | Eight named analytical series retain family identities; legacy `--chart-1` through `--chart-5` retain their existing palette/order. |

`createThemeTokens(options)` returns canonical roles only.
`createThemeDeclarations(options)` adds compatibility bindings for all **60**
existing root semantic names plus selected modal, tooltip, chart, code, table
progress and visualization paint/font aliases. It also rebinds every existing
inline Tailwind theme alias for direct `--color-*`/font/radius consumers;
compiled root aliases otherwise retain the old ancestor palette.
Alias compatibility is not proof
that every component already consumes density, typography or motion roles.

The [typography consumers](./typography.md) now apply actual recipes: the next
boundary consumes the body tuple; core controls/cards/forms and Select/Command
consume role utilities; specialized modal/tooltip/chart/list/code aliases bridge
their existing measurements. Optional native Text/Heading uses the same catalog
without requiring control wrappers. Direct family consumption fixes nested font
inheritance; local role variables and caller classes/styles remain usable.
This is a qualified first adoption baseline, not a completed full-screen
migration. The [typography plan](../../_work/typography-system-plan.md) retains
font-loading, wider consumer and accessibility/promotion gates.

Overrides accept known canonical names and bounded, trusted application CSS
values. Unknown roles, unresolved mandatory references, cycles, resource URLs,
escaped values, declaration/HTML injection and priority directives are rejected.
External `var()` references require an explicit fallback. This is admission for
trusted theme configuration, not a full CSS grammar parser or support for
untrusted user-authored styles. It does not contrast-certify custom overrides.
Explicit null mode/density values are rejected rather than treated as omitted.
Getter-backed admitted configuration is sampled once so one resolved result
cannot mix different selections.
For local component tuning, existing component aliases can still be set directly
at the component/owner boundary; their APIs are not removed.

## Motion Is A Task Contract

`resolveThemeMotion({ reducedMotion })` returns frozen `recipes` and `tokens`.
It does not run animations or replace existing interaction owners.

- Sidebar and public-navigation magnetic springs retain their existing physical
  coefficients. Picker open/close/highlight/width/label recipes use Arc's measured
  spring vocabulary; `visualDurationMs` is calibration, not a guaranteed deadline.
- Ordinary anchored popovers/pickers use .97 scale and a 5px trigger-facing offset
  at 580ms, with 160ms opacity and 140ms exit, following their actual placed side.
  Select keeps its separate trigger-to-list morphology. Explicit component motion
  overrides retain their owner rather than layering two animations.
- Browsable Card feedback uses a 2px mouse-only lift, 1.04 media zoom and short
  status rolls. Quick-look cards use the existing modal manager's origin/Rise
  policy; they do not install another dialog or interaction clock.
- ScrollArea records the selected Arc treatment: 28px conditional edge region,
  0.5px overflow threshold, 11px track target, 5→7px thumb, 28px minimum thumb,
  30→46% foreground mix, 900ms linger and 160/480ms show/hide transitions.
- Modal policy remains From Button, Rise fallback, reverse entrance, dim+blur,
  page receding and a 1.5 duration multiplier: 975ms origin, 900ms Rise fallback.
- Tooltip policy remains Grow, 400ms entrance and arrow on. Hover intent/warm
  timing is separate from animation duration. Analytical inspectors retain 120ms
  feedback rather than inheriting a decorative tooltip entrance.
- Reduced motion snaps new visual recipes, disables receding and removes visual
  transition times. It does **not** shorten the 1500ms hold-confirm interval,
  hover intent or scrollbar linger. Existing modal/tooltip resolvers remain
  authoritative; the supplement does not overwrite their motion options.

## Live Theme Propagation

Already-open owned overlays now subscribe to legacy/public and next-theme
attributes on their source ancestry, plus system color, reduced-motion,
coarse-pointer, forced-colors and viewport changes. Theme projection uses the
source's own document/window, including iframe sources and their disconnected
fallback. Qualified owned-popover updates preserve the portal node, draft/focus, local overrides,
owner layer and inert state; they do not remount the popup or change dismissal.

The single shared modal backdrop now follows the active dialog's live source
paint, restores the parent's paint when a stacked child closes, and retains the
outgoing treatment until the existing scene settles. Standalone tooltip
precedence is corrected in both layers, matching grouped tooltips: closer source
tokens beat the broader modal owner, and explicit visual styles remain last.
Existing modal backgrounds, blur/recede effects, stack/focus owners and approved
animations stay intact.

Sankey, Race Bar and Funnel use the same presentation subscription for cached
paint and text measurement. Font completion refreshes chart measurements where
needed. A presentation update does not become a data update: trace selection,
playback state, row/flow geometry and particle clocks retain their meaning.

The shared observer batches notifications and releases listeners on disposal.
Connected reparenting/adoption and same-document or known-shadow-branch
reconnection are supported. Accessible slots follow flattened inheritance and
assignment changes; browsers hide closed-shadow slot associations for light-DOM
sources. Moving an already detached source into an unknown document/shadow branch
requires resubscription. Direct CSSOM/stylesheet-text replacement has no automatic
notification, and moving a whole chart runtime
between documents still requires remounting its document-owned environment.
These subscriptions do not install fonts or styles.

## Check Before Promotion

Run `bun --no-env-file scripts/check-theme-foundation.ts` for deterministic CSS
parity, complete root-alias coverage and read-only source gap candidates. The
scanner includes compiled Tailwind declaration ownership; it is still syntactic,
not a whole-program import/inline/computed-style audit. Literal colors and old
aliases are review candidates, not automatic defects. Only parity, missing
compatibility names and unresolved new-foundation roles fail this check.
The package also exposes a config-free backing check:

```sh
zero doctor --source-only --theme-foundation --project-root . --json
```

It checks the Doctor package's generated CSS and legacy aliases, then inspects
admitted source and bounded relative CSS imports. Unknown mandatory canonical
references and customized app-owned copied CSS are manual-review warnings;
old aliases and literal colors are counts, not migration errors. It does not
execute configuration, Tailwind, environment files or runtime services, and
never rewrites styles. See [source-only theme diagnostics](../../cli/doctor/source-audit.md#backing-theme-diagnostics)
for scope, exit policy and the explicit no-env-file launch.

Focused tests cover immutable composition, reference/cycle admission, contrast
pairs, physical/motion policy, public export builds, generated CSS parity and
real-browser synthetic probes for root/nested mode, density, system preference,
reduced motion, coarse targets, live owned portals, native shadow/document
subscriptions, chart paint caches and real copied-consumer builds. They do not
constitute a packed-release or whole-application accessibility certification.

The application default switch and the first Morph Select/magnetic picker/Arc
native-scroll integrations are implemented in working source. The remaining
visual work is full-screen density adoption and wider context-menu coverage; qualify old
Tailwind `dark:` branches inside explicit light scopes; and verify actual
applications, fonts, zoom, forced colors and touch. Managed opt-in and portable
artifact matching are implemented; actual application adoption and release
visual approval still needs its own checks. Keep the old files until the
retirement gates below pass. Removal is a separate approval step.

## Retire The Original Theme Safely

The current `src/frontend/styles/globals.css` is not only an old palette.
Both application CSS and managed next builds still consume it. It supplies
Tailwind, the dark variant, inline utility aliases, root/dark/public values,
base html/body/selection/focus rules and 30 imports of framework/token/component
styles and package CSS. The generated `theme-next.css` is a scoped supplement;
it has no independent Tailwind/base/component import layer and cannot replace
`globals.css` by itself.

Deleting that file today would also remove current Card, Select, magnetic-menu,
ScrollArea, modal, chart and DataTable styling. Treat removal of its mixed
ownership, retirement of its palette and removal of the public legacy option
as three separate decisions.

Before approving any deletion:

1. **Separate durable infrastructure.** Extract Tailwind registration, utility
   aliases, base rules and component CSS aggregation into named neutral owners.
   Preserve import order and compiled behavior; this extraction must not change
   the palette, motion defaults, geometry or public-page background.
2. **Give retained values explicit homes.** Keep the original root/dark/public
   declarations in a legacy token owner and retain the specialized code, modal,
   tooltip, calendar and DataTable families until their responsibilities are
   fully replaced. Those files include behavior/layout recipes, not just colors.
   Compatibility aliases remain supported while their consumers need them.
3. **Qualify each lane.** Next/default application styling must have complete
   infrastructure and tokens without relying on a file selected for retirement.
   Unmarked document/public surfaces must retain a deliberately supplied palette
   until their separate migration is approved. Do not activate document roots
   as an incidental workaround. Preserve quiet accent and legacy chart-series
   semantics, source/owner portal projection and saved light/dark/system behavior.
4. **Keep rollback explicit.** `styles-legacy.css`, managed
   `themeFoundation: 'legacy'` and AppShell's legacy selection stay usable unless
   their removal is independently approved and versioned. A filename may become
   a compatibility entrypoint after extraction; removing it is not required to
   adopt next. Nested legacy isolation is still not implied.
5. **Update distribution and diagnostics together.** Reconcile stylesheet exports,
   application imports, managed builds, generator settings, source-copy companions,
   documentation and package tests. Doctor currently reads `globals.css` and its
   root declarations; update that evidence to the new owned assets rather than
   disabling alias/parity checks. Record actual breaking changes in the upgrade
   catalog. The current static audit does not certify readiness for retirement.
6. **Preserve deployed artifacts.** Rebuild artifacts under the selected
   foundation. Older manifests without foundation metadata remain legacy;
   retain prior hashed CSS URLs for deployed manifests and in-flight pages.
   Source cleanup does not authorize deleting published build assets.
7. **Complete consumer approval.** Require managed next/legacy builds, public
   CSS imports, browser/SSR types, copied-source CSS/helper closure, generated
   parity, actual role consumption, owned stacked overlays and representative
   application/public-page visual checks. Include real fonts, density, zoom,
   keyboard/focus, touch, forced colors and reduced motion. No unresolved required
   findings may be hidden by suppressing a check; manual reviews need decisions.
8. **Approve exact targets and rollback.** Record the version, replacement paths,
   migration instructions and retained source/archive rollback before removing
   the exact approved original files. Do not delete whole theme/style folders
   or app-owned copied styles as part of that decision.

The [theme evolution plan](../../_work/design-token-theme-evolution-plan.md#original-theme-retirement)
tracks these gates. The [component organization plan](../../_work/frontend-component-organization-plan.md)
owns source moves; a folder cleanup does not imply palette or legacy-API removal.

## Source Ownership

`src/design-system/` separates palette, foundation/density, motion, compatibility,
validation, composition, CSS generation and diagnostics. Generated output is
`src/frontend/styles/theme-next.css`. The canonical maps and generated catalog
are the exact-value reference; the [Arc evidence](../../_work/arc-design-language-audit.md)
and [working evolution plan](../../_work/design-token-theme-evolution-plan.md)
retain design lineage and migration decisions without duplicating a competing
token registry. The [legacy token reference](./tokens.md) still documents the
retained legacy foundation, not the next application default.

`src/lib/observe-presentation-theme.ts` owns live presentation subscriptions.
Existing overlay and chart owners retain their portal, focus, dismissal,
geometry and animation lifecycle; the helper does not take over those concerns.
