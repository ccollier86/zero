---
id: zero.inventory.design-system
type: inventory
audience: [agent, maintainer]
owner: design-system
status: draft
visibility: internal
system: design-system
applies_to: ["2.1.1"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-04"
  evidence_level: source-observed
---

# Design Tokens, Themes, Icons, And Motion

[System inventory index](./index.md) · [Documentation index](../../../index.md)

## Audit Identity And Verification Boundary

Framework `@zero/framework` 2.1.1 source baseline is committed `main` at `a3a5f726768dac890f241a3899c0a1acb66265d9`; inspection date 2026-10-04. The baseline commit was clean. The shared working tree now also contains separately authorized source/test corrections; baseline claims remain pinned to the commit unless a supplemental correction is stated. This draft inventory is source-observed; its independent source contract review is complete, while whole-platform and package reconciliation remain separate gates. It does not qualify an installed package, wider version range, production browser, or every Guardian/Fabric mode. No application imports, environment files, Doctor, provider requests, live databases, or app scripts were executed. “Tests present” means located, not passed. Planned destinations are plain paths relative to `docs-next/`.

## Independent Source Contract Review

Reviewed independently on 2026-10-05 against the pinned baseline's public
barrels, implementations, configuration/argument definitions and runtime
composition. The feature groups in this inventory are reconciled; the full
platform map, detailed guides and installed-package qualification are separate
gates. Authorized post-baseline source corrections remain supplemental dirty
working evidence, not released support. No app configuration, Doctor, live data,
provider or environment file was executed for this contract review.

## Purpose And Terminology

Owns quiet application and richer public-content token lanes, stylesheet/theming, default animated icons, presentation motion and attribution. It does not own authorization or streaming transport.

## Features And Documentation Coverage

| Feature | Public/source contract and evidence | Canonical draft guide |
| --- | --- | --- |
| Stylesheet/semantic tokens | /styles.css; [src/frontend/styles/globals.css](../../../../src/frontend/styles/globals.css); app/public/sidebar/chart/font/radius tokens | [frontend/design-system/tokens.md](../../../frontend/design-system/tokens.md) |
| Dark/public/application lanes | :root/.dark and semantic variables | [frontend/design-system/lanes.md](../../../frontend/design-system/lanes.md) |
| Theme provider/switch | ThemeProvider/ThemeProviderProps/ThemeTogglerButton/ThemeTogglerButtonProps; [src/components/ui/theme-provider.tsx](../../../../src/components/ui/theme-provider.tsx), [src/components/animate-ui/components/buttons/theme-toggler.tsx](../../../../src/components/animate-ui/components/buttons/theme-toggler.tsx) | [frontend/design-system/themes.md](../../../frontend/design-system/themes.md) |
| Icon context/wrappers | AnimateIcon/IconWrapper/ZeroIcon/useAnimateIconContext and public props/context types; [src/components/animate-ui/icons/icon.tsx](../../../../src/components/animate-ui/icons/icon.tsx) | [frontend/design-system/icon-animation.md](../../../frontend/design-system/icon-animation.md) |
| Named icon pack | Every alias individually in [component catalog](../catalogs/frontend-components.md); /icons entry | [frontend/design-system/icons.md](../../../frontend/design-system/icons.md) |
| Registry utilities | getZeroAnimatedIcon/hasZeroAnimatedIcon/resolveZeroAnimatedIcon/zeroAnimatedIconNames/zeroAnimatedIcons; [src/components/animate-ui/icons/registry.ts](../../../../src/components/animate-ui/icons/registry.ts) | [frontend/design-system/icon-registry.md](../../../frontend/design-system/icon-registry.md) |
| Animation helper APIs | getVariants/pathClassName/staticAnimations via icons entry | [frontend/design-system/icon-animation.md](../../../frontend/design-system/icon-animation.md) |
| Tokenized UI/motion families | Public sidebar/menu/popover/checkbox/progress/etc versus source-local Animate UI; catalogs reconcile routes | [frontend/design-system/component-conventions.md](../../../frontend/design-system/component-conventions.md) |
| Style build/app candidates | createApp composition; internal [src/frontend/server/style-bundle.ts](../../../../src/frontend/server/style-bundle.ts) | [frontend/design-system/style-build.md](../../../frontend/design-system/style-build.md) |
| External reexports/attribution | StickToBottom/useStickToBottom/useStickToBottomContext, Sonner toast/Toaster, Motion/Animate UI; [THIRD_PARTY_NOTICES.md](../../../../THIRD_PARTY_NOTICES.md) | [frontend/design-system/external-surfaces.md](../../../frontend/design-system/external-surfaces.md) |

## Public Surface And Integration Map

Root/react exposes AnimateIcon, ZeroIcon and the registry lookup/name helpers
plus their exported types; it does not export the named icon pack, IconWrapper,
getVariants, pathClassName, staticAnimations or useAnimateIconContext as runtime
values. /icons exposes the full named aliases and those context/helpers.
Source-local Animate UI modules are not public package components solely because
their files export symbols. Style build scans app candidates and package-owned
styles; ThemeProvider wraps next-themes. Icons/themes/motion are presentation,
not Guardian permission gates.

Existing [docs/frontend/design-tokens.md](../../../../docs/frontend/design-tokens.md) and [docs/frontend/icons.md](../../../../docs/frontend/icons.md) are research inputs; CSS/barrels/registry/build composition are current source evidence.

## Configuration Inventory

- CSS custom properties: exact declarations in globals.css group app/public/sidebar/chart/font/radius colors and Tailwind aliases. Resolution is CSS cascade/render-time, not Doctor/env precedence.
- ThemeProvider inherits next-themes props; wrapper defaults attribute=class/defaultTheme=system/enableSystem/disableTransitionOnChange; caller props override. Browser persistence/system-theme requires exact-version examples.
- ThemeTogglerButton and animated icon exported props control triggers/variants/sizes/delays/loops; no server service settings.
- Registry getZeroAnimatedIcon accepts a typed ZeroAnimatedIconName and directly indexes the registry (an untyped unknown name yields undefined); hasZeroAnimatedIcon uses an own-property check; resolveZeroAnimatedIcon accepts any string and returns null for missing names. ZeroIcon expects a valid canonical name and does not add fallback rendering.
- ThemeTogglerButton defaults to light/dark/system mode order, default variant/size and ltr direction. Empty mode arrays fall back to that order. Its circular transition uses the browser View Transitions API when supported and motion is permitted; reduced-motion/unsupported browsers change the theme without the circular animation. Morph icon presentation is a separate affordance, not a platform-wide reduced-motion guarantee.
- NODE_ENV controls browser bundle minify/sourcemaps/environment constant replacement in client-bundle.ts; building styles/bundles writes outputs and is not read-only.

The [design configuration reference](../../../frontend/design-system/configuration.md) now links to the complete light/dark token table, owned theme/icon defaults and style-build behavior. Contrast/reduced-motion/accessibility/package verification remains a distinct evidence gate, not a claim derived from token declarations.

## Evidence And Verification

Tests present: [src/frontend/server/style-bundle.test.ts](../../../../src/frontend/server/style-bundle.test.ts), [src/frontend/server/client-bundle.test.ts](../../../../src/frontend/server/client-bundle.test.ts), [src/components/animate-ui/icons/registry.test.ts](../../../../src/components/animate-ui/icons/registry.test.ts), [src/components/animate-ui/icons/animation-loop.test.ts](../../../../src/components/animate-ui/icons/animation-loop.test.ts), [src/components/animate-ui/components/buttons/theme-toggler.test.tsx](../../../../src/components/animate-ui/components/buttons/theme-toggler.test.tsx), [src/components/animate-ui/primitives/effects/theme-transition.test.ts](../../../../src/components/animate-ui/primitives/effects/theme-transition.test.ts). Example package-mode layout and component source examples. No visual/browser qualification ran.

## Findings, Philosophy, And Known Future Plans

### Supplemental Icon Context Option Correction

Authorized source review reproduced missing persistOnAnimateEnd forwarding
from both root/nested AnimateIcon providers (0 passed, 1 failed), and omitted
retention/reset props on direct wrapped icons (1 passed, 1 failed before that
second correction). Working source now forwards the declared options without
changing default triggers/sizes or presentation APIs. Explicit child false
retention overrides a true parent; no new component or animation was added.

Executed 2026-10-05: `bun --no-env-file test
src/components/animate-ui/icons/icon-context.test.tsx
src/components/animate-ui/icons/animation-loop.test.ts
src/components/animate-ui/icons/registry.test.ts` — **7 passed / 14 assertions**.
Context probes use synthetic SSR markup only, no app/provider/DB or browser
animation qualification. This is dirty development evidence after the clean
baseline, not released support; icon-animation documentation marks it.

- Coverage gap: token/contrast/reduced-motion/accessibility and installed-package style resolution need explicit qualification.
- Public route distinction: root/react does not alias the entire icon pack.
- Established philosophy: quiet app lane and expressive public lane share semantic tokens, reusable controls and motion. [docs/platform-roadmap.md](../../../../docs/platform-roadmap.md) records public-content/docs-site evolution; existing tokens/icons are not merely planned foundations.

## Navigation And Completion Review

The section entrance/configuration/roadmap and per-feature homes above now link to created reader drafts with parent indexes, contextual links and related next steps. Keep these working inventories out of public publication. See the [process](../../../documentation-process.md) and [standards](../../../documentation-standards.md).

- [x] Source-backed feature groups, public routes, and planned homes recorded.
- [x] Tests present, source inspection, and execution claims distinguished.
- [x] Findings and uncertainties recorded without documenting defects away.
- [x] Independent source/contract review of this inventory.
- [ ] Whole-platform reconciliation.
- [ ] Exact-package/export/example/mode qualification.
- [x] Reader-facing draft guides, configuration references, philosophy and roadmaps linked; artifact and independent detailed review remain separate.

## Detailed Draft Closeout

Created source-reconciled draft feature/configuration/index/roadmap pages on
2026-10-05. Every feature-group destination above now resolves to an actual
page. Reader status remains draft/internal: source inspection, focused working
corrections and example checks do not qualify an archive or production mode.
No current docs, package entries, app projects or active agent files were
changed. CLI operational examples were not executed.

Actual complete design-system TSX fences were compiled through public source
imports with Doctor/overlay examples (1 passed / 20 assertions across 19 actual
fences). The code was not executed or rendered as a production app. Exact
token values and 65 icon aliases were extracted by source-file reads only;
no provider/configuration/browser service was imported to enumerate them.
