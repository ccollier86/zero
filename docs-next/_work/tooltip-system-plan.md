---
id: zero.work.tooltip-motion-kit
type: architecture
audience: [developer, agent]
owner: frontend-components
status: draft
visibility: internal
system: frontend-components
feature: tooltip
maturity: supported
applies_to: ["2.6.0 source; unreleased tooltip upgrade"]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "59cb76dc12d18a9428a616b08509cae1eecdf74d"
  snapshot: dirty
  date: "2026-10-08"
  evidence_level: source-observed
---

# Tooltip Motion Kit implementation and qualification

[Working evidence](./index.md) · [Tooltip guide](../frontend/components/overlays/tooltip.md)

Scope: extend existing Zero tooltip primitives while preserving the compound API.
No app configuration, services, production data or deployment is changed.
Public guide: [Tooltips and shared groups](../frontend/components/overlays/tooltip.md).

## Implementation sequence

1. Inspect both tooltip families, sidebar activation, modal ownership, portal/theme
   projection, keyboard hints, source-copy and public exports.
2. Add immutable motion resolution and owned WAAPI playback with exact reference
   curves, durations, sampled springs and capability fallbacks.
3. Upgrade standalone Radix paint without replacing its descriptions, placement
   or dismissal. Preserve caller refs/events and external ARIA descriptions.
4. Upgrade the existing Floating UI singleton for explicit TooltipGroup handoff.
   Keep one physical surface, capture interrupted poses, morph content/arrow
   position, and fence stale positioning and completion generations.
5. Bridge provider/root/content options and expose rich content, existing Kbd,
   overflow-only hints, semantic variants and custom portal/collision controls.
6. Qualify live reduced motion, inactive owners and child-first Escape through
   Zero's existing owner registry and handled-dismissal conventions.
7. Compile actual guide examples and fresh installed/source-copy consumers; run
   full-style browsers and existing sidebar/Kbd/modal regressions.

## Defaults and boundaries

- Grow: entrance 400ms, independent fade 200ms, exit 200ms; arrow enabled.
- First hover 450ms; warm window 450ms; departure grace 70ms. Presentation pace
  does not alter hover intent.
- Spring, Blur and Swing are optional. durationMultiplier 0.5–2.5 multiplies
  durations. Reduced motion suppresses travel, blur and cursor drift.
- Neutral, accent and light inherit Zero semantic tokens. No demo palette,
  fonts, fake toolbar controls or page markup is imported.
- Explicit groups use 420ms movement/size/arrow morph, 160ms outgoing text and
  300ms incoming text after an 80ms delay.
- Tooltips are noninteractive descriptions, not popovers. Legacy cursor-follow
  translation belongs to ordinary tooltips; grouped cursor personality uses Swing.

## Qualification gates

- [x] CSS/TS motion parity, scoped playback cleanup and interrupted-pose tests.
- [x] SSR/public composition, escaping, native Kbd and overflow/ARIA policies.
- [x] Browser defaults/presets, warm hover, narrow placement and shared handoff.
- [x] Reduced motion, unmount, modal portal/theme/layers and child-first Escape.
- [x] Extended option/ownership regressions, fresh archive/source copy and docs checks.
- [x] Final source review and selective local commit preparation.

## Final qualification ledger

The 2026-10-08 working-source qualification includes:

- 30 motion, placement, activation/SSR and composed-ref tests: 217 assertions.
- 13 fully styled Chromium tooltip scenarios: 141 assertions. These include
  exact preset timings, interruption, shared handoff, live override removal,
  controlled ownership, touch suppression, external descriptions and modal
  theme/layer/Escape ownership. Normal and oversized descriptions remain bounded
  inside small custom panels; turning collision handling off removes old caps.
- A combined 33-test tooltip/modal-manager/sidebar/Kbd Chromium run: 290 assertions.
  The separate five-scenario modal presentation suite also passed.
- 11 existing source-copy tests, one tooltip-copy test and three Kbd unit tests
  passed. Synthetic browser fixtures are excluded from copied production sources.
- Five complete public guide examples compile: one test, two assertions.
- A fresh installed archive and actual public CLI source-copy consumer pass:
  one test, nine assertions. Public exports, SSR, browser bundles, strict types,
  packaged styles/docs and the application-config nonexecution tripwire are checked.
- Strict public-tooltip TypeScript checking and whitespace checks pass. The
  documentation graph contains 748 unique, reachable pages; catalog home checks
  pass for 1,019 records and 173 public homes.

The final runtime-qualified archive SHA-256 is
4a2fb15e37dd8ddb7b397ed12faa2d55b50d465f81685acad9e4144240aea265.
It is an installed working-source archive, not a published release. Evidence and
screenshots are retained under the external tooltip-system diagnostics directory.
The local feature-branch commit is separate from publication, merge and deployment;
none of those external operations is part of this task's completion.

These tests do not establish full screen-reader, cross-browser or every-app
qualification. No live Pantheon instance, real session or application database
was used by these checks.

Diagnostics and disposable artifacts use external code-bank roots. The in-app
browser connection was unavailable; browser qualification uses the repository's
isolated Playwright harness with compiled Zero platform styles.
