---
id: zero.charts-system-plan
type: roadmap
audience: [developer, agent, maintainer]
owner: frontend-components
status: draft
visibility: internal
system: frontend-components
feature: zero-charts
maturity: planned
applies_to: ["2.6.0 working source"]
modes: [browser, SSR, light, dark]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "335b27372b0b8ef57a1e92cf93cec378923fe50b"
  snapshot: dirty
  date: "2026-10-09"
  evidence_level: source-observed
---

# Zero Charts Implementation Plan

[Working evidence](./index.md) · [Components](../frontend/components/index.md) · [Theme evolution](./design-token-theme-evolution-plan.md)

Introduce Zero-owned charts alongside the existing Recharts composition. The
supplied Sankey is the first complete organism and an additional reference for
the future chart language. The Race Bar reference extends the same library with
historical ranking, playback and scrubbing. The immediate scope is these
components, typed data facade, existing-query bridge, tests and token ledger. Do not remove Recharts,
replace the global theme or introduce a second data transport.

## Current Foundations

The existing [chart wrapper](../../src/components/ui/chart.tsx) supplies Recharts
containers, tooltips and legends; it does not collect or authorize data. Keep its
API and five existing chart colors compatible.

The existing [query hooks](../../src/frontend/client/data-hooks.ts) subscribe to
authorized client collections. `useQuery` filters the local cache; it does not
execute a server aggregate or prove that a lazily loaded collection is complete.
Paginated table rows cannot establish a whole-dataset chart. Prefer a bounded,
full-sync collection of already aggregated edges for the first reactive example.

The existing [tooltip](../frontend/components/overlays/tooltip.md) owns positioning,
collision handling, portal ownership and keyboard dismissal. Reuse it for the
Sankey inspector with a scoped surface and motion configuration. Preserve the
reference's non-interactive content; an inspector with buttons or editable fields
would need an explicit popover composition instead.

## Component Composition

Create `src/components/charts/sankey` for small, named responsibilities: public
data contracts; graph admission and source composition; proportional tracing;
responsive layout; SVG geometry and paint; particle rendering; environment and
motion lifecycle; React interaction; inspector content; and the accessible data
companion. Compose these into `SankeyChart` rather than introducing a general
imperative DOM manager that owns arbitrary application children.

Provide a React component entry and a browser-independent math entry. A pure
query projection belongs in the query layer, not in the SVG renderer. Stable
node and link identities connect updates, traces and application selections.

### Reference Contract

Preserve the horizontal ribbons, narrow nodes, source colors, quiet downstream
nodes, labels above numeric values, stage headings, sparse drifting particles
and compact Flow control. Below 420px, rotate the flow into the reference's
upright layout with a minimum 480px height. Avoid forced horizontal scrolling.

Keep the supplied timings: 1000ms entrance, 130ms per-column stagger, 700ms
updates, 140ms trace-distance delay, 440ms pour and 260ms trace fade. An update
must start from the geometry currently on screen. Removed elements collapse;
new elements enter without resetting the whole chart. Pause decorative work
offscreen or when the document is hidden; reduced motion removes particles and
settles geometry immediately.

Mouse hover, touch inspection and keyboard traversal must expose the same values.
Custom inspector renderers receive real node/link context. Include a labeled data
table and live keyboard announcements; do not leave important values in canvas
pixels or hover-only content.

### Data Integrity

Accept a bounded directed acyclic graph with finite nonnegative flow values.
Reject duplicate node identities, missing endpoints, cycles, inconsistent pinned
columns and aggregate overflow. Anonymous duplicate endpoint links may combine;
explicitly identified parallel links retain their identity. Generate endpoint
keys without ambiguous delimiter concatenation.

Tracing is proportional mixing through each node, as in the supplied reference.
It is not exact per-person attribution. Midstream additions and losses must remain
visible in node totals and source composition rather than being silently balanced
or presented as exact paths. Particle motion conveys aggregate flow, not individual
business events or acknowledged writes.

## Execution Sequence

- [x] Implement and test graph admission, composition, trace math and layout.
- [x] Compose the React organism, shared inspector and bounded particle layer.
- [x] Preserve update interruptions, controlled selection, reduced motion and
  visibility lifecycle.
- [x] Add public component/math/query entries and `zero add` support without
  shipping browser fixtures or backend dependencies into copied presentation.
- [x] Connect the first query bridge to existing authorization-aware hooks;
  surface projection errors and size limits without inventing completeness.
- [x] Verify synthetic light/dark and narrow-screen examples, pointer/touch/
  keyboard inspection, live updates, cleanup, SSR and browser-safe packaging.
- [x] Publish the component guide and actual example qualification; record the
  chart anatomy and token requirements in the theme plan.

### Initial Slice Qualification

The working implementation is in
[the chart composition](../../src/components/charts/index.ts),
[headless facade](../../src/charts/index.ts) and
[query bridge](../../src/frontend/client/chart-query.ts). The
[component guide](../frontend/charts/sankey.md) records current contracts.

The combined synthetic/source qualification passes 80 tests across 11 files,
including 14 browser cases and unchanged Recharts theme/tooltip regressions.
Five actual complete documentation examples compile in memory. Source-copy
qualification builds the copied chart in an isolated consumer against current
public package entries; it does not assert a published or installed archive.

The review corrected entrance fast-forwarding after fonts became ready, displaced
label hit areas, global-token inheritance, portal inspector overrides, phone table
overflow, controlled inspection retirement, extreme particle weights and canvas
allocation. Particles are capped at 130; canvas backing paint is capped at four
million pixels and 8192px per dimension. Mix traces have a 4096 origin-element
budget and reject larger paint layers explicitly.

This qualifies the first component/query slice, not the later server aggregate
API. Repository-wide TypeScript still reports four pre-existing unrelated errors
in data-table, database-client and resource integration tests; chart source and
the actual chart examples add no diagnostics in that check.

## Race Bar Extension

Implement the second organism under `src/components/charts/race-bar`, keeping
input admission, ranking/interpolation, responsive geometry, spring integration,
playback lifecycle, timeline, inspector and React assembly separate. Reuse Zero
Button and Tooltip; preserve their portal ownership and keyboard behavior.
Do not fetch data or introduce a second reactive subscription in the renderer.

### Reference and API Contract

Preserve lightly tinted bars with a crisp colored cap, names aligned beside bars
at wide widths and inside them below 400px, tabular values, the rolling period,
all-item total, compact legend and spring-following timeline. Keep the reference's
1400ms per-period playback, 55% smoothstep value blend, independent rank springs,
420ms entering/300ms retiring period labels and 120ms inspector fade. Analytical
critical damping should retain those spring frequencies and velocity without the
reference Euler integrator's instability during delayed frames and scrubbing.

Expose bar count, frame duration, autoplay, loop, initial/controlled frame,
controlled playback/selection, highlight, formatting, total/legend/control
visibility, motion and custom item inspectors. Supply ref commands for
play/pause/toggle/replay/seek/next/previous. Distinguish requested frame changes
from observed displayed periods, and requested playback from effective
visibility suspension, so controlled state cannot create a feedback loop.

History consists of stable item IDs and ordered periods with explicit IDs where
labels repeat. Admit finite nonnegative values, finite all-item totals and bounded
item/frame/cell counts. Missing own item keys mean zero; do not coerce invalid
values or accept unknown keys. Updates must retain visible period identity where
possible, retire missing selection and clamp shortened/empty histories. Exact
period-to-period change is not the interpolated display value; zero baselines
have no finite percentage change. Include the complete accessible history table.

Pause offscreen/hidden work without advancing through invisible elapsed time.
Preserve a user's explicit pause; reduced motion disables autoplay and settles
transitions immediately. Long labels, narrow containers, theme overrides and the
hidden history table must not introduce horizontal scrolling.

### Execution

- [x] Admit and test bounded history, stable ranking, period identity, exact delta
  semantics, responsive layout and numerically safe spring/tick calculations.
- [x] Assemble the React chart, controls and shared inspector; preserve stable
  rows and interrupted motion during playback, seeking and reactive replacement.
- [x] Qualify controlled state, empty/single periods, pointer capture, keyboard,
  touch, reduced motion, offscreen/hidden suspension and complete teardown.
- [x] Extend public component/headless exports, source-copy and SSR/browser
  consumer checks while retaining Sankey and Recharts compatibility.
- [x] Publish the Race Bar guide, compile its actual examples and record the
  four-series palette, tint, numeric, timeline and inspector token direction.
- [x] Inspect synthetic light/dark and phone-width fixtures and record evidence.

The query example should project an already authorized bounded rollup history
through `useChartQuery`. Period playback is a presentation clock, not event
provenance, server aggregate maintenance or automatic monthly/YTD conversion.
Database functions/triggers and Fabric remain the owners of durable rollups and
scope, as described in the next phase.

### Race Bar Qualification

The implemented [organism](../../src/components/charts/race-bar/race-bar-chart.tsx)
and [guide](../frontend/charts/race-bar.md) expose the reference
settings, controlled target/observed-period callbacks, ref commands and reusable
inspector, history, legend and timeline pieces. Inputs, ranking, responsive
geometry and motion remain separate pure/browser responsibilities.

The combined working-source qualification passes **134 tests across 18 files**,
with **13,944 assertions**. It includes 17 Race Bar browser cases, 14 unchanged
Sankey browser cases and the existing Recharts tooltip regression. Ten actual
complete chart-guide examples compile against public source entries. The
documentation structure check reaches all 755 pages with no reported problems.
Public entries build for browsers and SSR; copied presentation builds in an
isolated consumer without executing app configuration. This is source-copy
qualification, not a published or installed archive release assertion.

The Race Bar review corrected unstable delayed-frame springs, zero/subnormal
scales, controlled scrub requests, empty-history retirement, period identity
during replacement, chrome changes resetting playback, repeated frame-callback
emission, orphaned animation frames, noisy live announcements, scoped font
measurement and inspector percentage overflow. Local plot isolation prevents
ranked rows from painting above the shared portalled inspector. Synthetic
light/dark, phone-width and settled inspector previews were inspected.

Five integration cases project actual synthetic full-sync collection changes
through `useChartQuery`, including rollup updates, prepend/trim continuity,
scope retirement, same-scope authority retirement and invalid replacement data.
No live app, provider, database or new aggregate service is started. The wider
server facade remains the phase below. The subsequent Funnel extension begins
shared chart-token normalization rather than retaining separate prototype themes.

Repository-wide TypeScript still reports only the same four pre-existing
unrelated test diagnostics in data-table, database-client and resource integration
files. The chart source, public fixtures and guide examples introduce no new
diagnostics in that check.

## Funnel and Realtime Stream Extension

The supplied Funnel and requested Realtime Stream references extend the same public
component, headless and query entries. Keep chart implementations compositional;
source subscriptions and authority remain with the existing Zero data layers.
Do not create an unrelated per-chart transport or silently replace Recharts.

### Shared Presentation

Implement a shared chart-token skin before adding more independent defaults.
Normalize analytical inspector radius, padding, body/value typography, border,
shadow, focus and short feedback roles across Sankey, Race Bar and new charts.
Resolve common categorical tones through named family colors while retaining
stable source/group mappings and existing local override contracts. Surface,
foreground, font and border roles remain connected to the active Zero theme.
Preserve chart-specific geometry and hand-tuned motion rather than flattening
every organism into the same animation.

### Funnel Contract

Use stable `id` fields for segments and stages, matching the existing chart data
facade. A typed view identifies total, split or an isolated segment without
reserving business IDs such as `total` or `split`. Input admission must reject
duplicate identities, invalid numeric values, unknown segment keys, inherited
value records, total overflow, excessive inputs and increasing stage counts
that cannot represent a conversion funnel. Missing own segment values mean zero;
retention from an empty previous stage is undefined, not a fabricated percentage.

Preserve the tapered band, smooth stage boundaries, count/retention readouts,
drop-off annotations, gliding inspection column, compact segment/split/flow
controls and horizontal-to-vertical layout below 420px. Default band height is
170px. View changes and reactive updates retarget from current geometry with
stable stage/segment identity. Retain the reference spring frequencies and
control timings with numerically stable integration.

Particle departure distributions derive from each segment's actual aggregate
step counts and weighted entry mix. The dots illustrate those rates; they do
not establish individual journeys, accepted writes or observed live events.
Keep particles and canvas bounded, paused offscreen/hidden, and disabled under
reduced motion. Expose controlled/default view, flow and active-stage selection,
pure custom inspection, formatting, orientation and optional controls.

### Execution

- [x] Implement bounded Funnel admission, exact totals/rates, responsive geometry
  and deterministic weighted particle/departure calculations.
- [x] Compose the Funnel organism, shared controls/inspector, interrupted motion,
  keyboard/touch reading and complete accessible data companion.
- [x] Add the shared family token layer and qualify live scoped overrides,
  compatibility aliases, light/dark paint and unchanged legacy chart colors.
- [x] Extend public entries, source copying, synthetic query qualification,
  documentation examples and browser/SSR consumers.
- [x] Inspect light/dark, narrow, total/split/isolated and custom-inspector states;
  preserve lifecycle and callback/portal safety established by earlier charts.
- [ ] Inspect and implement the Realtime Stream reference once its supplied
  local file is available; qualify actual stream timestamps, bounded history,
  ordering, pause/resume and source retirement from the real reference contract.

The Funnel source is available at `/Users/catalystlabs/Downloads/Funnel Chart.html`.
The supplied `/Users/catalystlabs/Downloads/Realtime Stream.html` path was absent
during initial admission, and the user was asked to save or resend it. Do not
invent the missing chart's layout or API in the meantime.

### Funnel and Shared-Token Qualification

The combined working-source run passes **195 tests across 25 files**, with
**14,787 assertions**. It includes 19 Funnel browser cases, 9 cross-chart token
browser cases, the existing 14 Sankey/17 Race Bar browser cases and the Recharts
tooltip regression. Fifteen actual complete guide examples compile against the
public component/headless/query entries. All 756 documentation pages are unique
and reachable with no structural problems. Public browser/SSR consumers and an
isolated copied-source consumer build without executing app configuration.
A final focused rerun after the stage-span inspector correction passes all
37 component/family browser, SSR, public-entry and example checks (247 assertions).

Five synthetic Funnel query cases qualify insert/update/delete recomputation,
segment identity, scope replacement, same-scope authority purge and invalid
cohort admission. No live provider, database, backend aggregate service or
production data is started. The chart renders already authorized cohort counts;
server-maintained consistent cohort revisions remain the caller's responsibility.

Review corrected stale zero-data readouts after clock retirement, retired
screen-reader announcements, touch timers affecting subsequent API inspection,
batched/reentrant commands and rejected controlled retries, static controls,
selection-pill alignment, collapsed-width geometry/inspection, modern CSS color
resolution and explicit zero tint. Inspectors use the shared portal and a
full-stage anchor, flipping to the opposite stage boundary and respecting plot
and viewport limits. Light/dark, phone, split and isolated previews were inspected.

Family tokens normalize inspector radius/padding/type/elevation/maximum width,
compact label/value roles, focus/feedback and named categorical colors. Scoped
overrides are tested on actual SVG, DOM, canvas pixels and portalled inspectors,
including local-override precedence. Sankey text remeasurement and neutral trace
ink follow current scoped roles; legacy Recharts colors remain unchanged.

The in-app browser bootstrap was unavailable (`missing field sandboxPolicy`),
so verification used the established isolated synthetic browser harness. The
repository-wide TypeScript check reports only the same four unrelated baseline
test diagnostics; the chart source and examples introduce no new diagnostics.

Realtime Stream remains pending the actual reference file. This is a completed
Funnel/chart-token slice, not a claim that the requested second chart or the
later server analytics facade has been implemented.

## Arc Free Chart Extension

The current extension converts twelve free chart types from the official Arc
registry into `src/components/charts/arc`, separately from the custom organisms
and Recharts. Public entries are `@zero/framework/components/charts/arc` for
React and `@zero/framework/charts/arc` for headless models/math. The existing
`@zero/framework/charts/react` bridge remains the sole reactive collection
projection path; no component creates its own transport or server rollup.

Scope: Line, Bar, Donut, Streamgraph, Brush, Waffle, Slope, Sparkline, Gauge,
Activity Heatmap, Ridgeline and Treemap. Animated Counter is not a chart in this
slice; Pro Split Bar and other Pro source are excluded. Broader licensing
documentation is deferred at the user's request; source attribution and required
permission text remain inline.

### Sequence and Contracts

- [x] Inspect the live catalog and each full free registry source; record the
  exact [upstream token inventory](./arc-chart-token-inventory.json).
- [x] Split bounded own-data admission and analytical geometry from React,
  animation state, controls and inspector content.
- [x] Preserve source geometry/abilities: curves, average/drum readouts, rounded
  arcs, fixed-unit allocation, baseline modes, brush grips/annotations, rank
  changes, status gauge, UTC calendar waves, empirical density and hierarchical
  drill-down. Use explicit IDs rather than Arc's original data keys.
- [x] Route semantic paint into Zero/shared chart roles at consuming sites,
  keep namespaced override tokens, reconcile small analytical-card differences,
  and record source-vs-shared decisions in the [theme ledger](./design-token-theme-evolution-plan.md#arc-chart-extension).
- [x] Reuse Zero Tooltip ownership/collision portals, retain non-interactive
  analytical content and expose pure custom inspector renderers.
- [x] Add public component/headless entries, global skin and dedicated/broad
  source-copy targets. Build actual copied consumers without app configuration.
- [x] Qualify actual bounded reactive projection: inserts/updates/deletes,
  invalid input masking, scope/authority retirement, lazy/auto rejection,
  pre-projection row budget and subscription cleanup.
- [x] Write the [Arc guide](../frontend/charts/arc.md); compile its
  five complete examples alongside the fifteen custom-chart examples.
- [x] Complete serial browser qualification and final regression sweep.

Admitted chart magnitudes are explicitly bounded at `1e12`; this is a presentation
envelope, not a storage limit. Work budgets and signed/nonnegative semantics are
documented per organism. No invalid data is silently coerced, truncated or repaired.
UTC calendars disclose missing days as zero within their authorized supplied range;
density is an estimate over real observations and exact inspection remains empirical.
Empty/zero data must not fabricate a proportion or density population.

Controlled requests cannot mutate caller state. Retired identities cannot expose
old measurements or select a newly inserted item at an old array position. Revealed
geometry settles offscreen/hidden; all motion controls, observers/listeners and
delayed callbacks must clean up. `motion={false}` and reduced motion suppress
decorative JS/CSS while preserving exact accessible data and useful focus.

### Qualification Boundary

The in-app browser connection failed during bootstrap (`missing field
sandboxPolicy`), so UI checks use the existing isolated synthetic Playwright
harness. Browser runs are serialized; no app, DB, external provider or live query
service is started. Light, dark and narrow screenshots are implementation
evidence, not public business data or a published-package guarantee.

Working-source browser/SSR bundle checks exercise all twelve public exports and
verify that the headless facade excludes React/Motion/browser/DB authority.
Source-copy includes shared CSS/math/overlay dependencies and excludes test
fixtures. The wider default-theme migration, named server aggregates, provider
freshness/receipt contracts and Realtime Stream remain separate roadmap items.

### Qualification Results — 2026-10-09

The final combined working-source regression run passed **285 tests across 39
files**, with **15,985 assertions and zero failures**. It covers the twelve Arc
organisms and their pure models, the existing Sankey/Race Bar/Funnel and Recharts
behavior, shared token/inspector ownership, authorization-aware reactive queries,
actual public-entry browser/SSR builds, and both chart source-copy consumer builds.
All twenty complete documentation examples compile against the actual public
entries. No application configuration, database or external provider is started.

Serial browser qualification includes all twelve charts in light, dark and narrow
layouts, controlled requests/retired identities, custom/default/hidden inspector
content, keyboard/touch controls, motion interruption, scoped fonts/tokens and
cleanup. The inspected all-twelve gallery is saved under
`/Volumes/code-bank/artifacts/zero-platform/diagnostics/arc-charts/`; group-specific
evidence is under `arc-cartesian`, `arc-proportions` and `arc-distributions` in the
same diagnostics root. Screenshots use synthetic measurements.

The documentation structure check reports 757 unique, reachable pages and no
problems; `git diff --check` is clean. The full repository TypeScript check has no
new Arc diagnostics, but still fails on four pre-existing unrelated test errors:
the missing `DataTableServerQuery` name, a database-operation union's
`idempotencyKey` access, and two resource test doubles missing `findPage`. This is
not a claim of a repository-wide clean typecheck or a published-package release.

Final review additionally qualified accessible companion scope (Brush's accepted
window, Donut's visible members, Ridgeline's exact descriptive statistics),
documented controlled Cartesian inspection settings, and corrected an existing
Funnel browser test to await React's controlled response rather than an already
settled static paint. No production Funnel behavior was changed by that test fix.

## Handmade Chart Coverage Extension

Recharts remains supported for existing callers. New Zero charts use original
SVG/DOM rendering and analytical models, not Recharts, D3, or another chart engine.
The installed Recharts source is a reference for mathematical behavior and
capability coverage only: category/value axes, independent signed accumulators,
normalization, intervals, polar angles, and hierarchy partitioning. Existing Zero
charts own the visual language, reveal/morph behavior, tokens and inspection.

### Implementation Sequence

- [x] Inspect installed Recharts mathematical/layout code and the current Zero
  component, token, motion, packaging and query seams.
- [x] Establish shared bounded admission, figure/legend/exact-data/inspector
  pieces and one presentation lifecycle under `charts/native/shared`.
- [x] Build a handmade Cartesian model/layout and renderer: quantitative/time X,
  named linear/log axes, gaps, signed/grouped/stacked/percentage bars, areas,
  mixed marks, scatter/bubbles, references and controlled inspection/windowing.
- [x] Build true histogram binning, matrix heatmaps, box plots, waterfalls and
  validated OHLC candlesticks from pure models and original renderers.
- [x] Build radar profiles, multi-range radial bars, solid pies and hierarchical
  sunbursts with honest raw quantities and controlled drill/selection.
- [x] Add a bounded observed-time stream with real supplied measurements,
  no fabricated data clock, a held inspection window and correction/retirement.
- [x] Expose React/headless facade and source-copy entries; keep authorized
  reactive collection projection in the existing Zero query bridge.
- [x] Document public settings, data/math semantics, source-reference boundaries,
  and the shared design/motion decisions in the existing token ledger.
- [x] Qualify analytical extremes, own-data admission, SSR, browser interactions,
  light/dark/narrow presentation, authorization retirement and packaging.

This extension covers presentation and analytical contracts. Existing database
functions/triggers can maintain the supplied authorized aggregate rows; the named
server metric service below is a distinct platform responsibility and is not
silently implemented inside a renderer. Realtime Stream's original downloaded
reference is unavailable, so a new handmade observed-time organism follows the
current Zero chart language without claiming pixel identity to that missing file.

### Coverage Qualification — 2026-10-09

The final fresh-process combined working-source run passes **391 tests across
54 files**, **17,741 assertions**, with **zero failures**. It includes all new
native model/renderers alongside the earlier Arc/Sankey/Race Bar/Funnel and
legacy Recharts regressions; all 34 typed `ZeroChart` choices; actual public
browser/SSR module graphs; three isolated source-copy consumer builds; authorized
reactive inserts/corrections/deletes, projection failure masking and scope/
authority retirement; and all **25 complete documentation examples**.

The pure native entry has no React/browser/provider/database/chart-engine runtime.
The renderer graph has no Recharts/D3/Victory engine. The bridge remains the
existing full-sync projector; no app configuration, live database, external
provider or separate metric transport is executed by qualification.

Serial browser suites qualify six native Cartesian, ten statistical, nine polar
and eight public-gallery/stream cases. Screenshots in light/dark and 390px layouts
were inspected. The combined gallery is under
`/Volumes/code-bank/artifacts/zero-platform/diagnostics/native-charts/`, with
family evidence under `native-cartesian`, `native-statistical` and `native-polar`.
The in-app browser bootstrap still failed with `missing field sandboxPolicy`;
the existing isolated synthetic browser harness supplied this evidence.

Review corrected stable log mapping at adjacent high-magnitude endpoints,
overflowing exterior tiny-domain coordinates, actual SVG rectangle attributes,
cap alignment, physically legible metadata, sampled tick collisions, automatic
scatter/bubble endpoint clipping, clustered true-time candle hit regions,
Sunburst color inheritance, false-zero tiny-value readouts and controlled stream
holds. Every real stream vertex is retained so narrow irregular spikes survive.
Raw intervals on normalized percent stacks are explicitly rejected rather than
misrepresented as confidence bounds. Full exact companions survive formatting,
normalization, visibility and missing data; stream UTC text also includes raw
epoch milliseconds so fractional precision is not hidden.

The documentation structure check reports **758 unique reachable pages**, no
problems, and `git diff --check` is clean. The full repository TypeScript check
still reports the four previously established unrelated test errors (missing
`DataTableServerQuery`, database-operation union `idempotencyKey`, and two test
doubles lacking `findPage`); there are no new chart diagnostics. This is a
working-source qualification, not a published-package or live-provider claim.

The [native component guide](../frontend/charts/native.md),
[shared theme notes](./design-token-theme-evolution-plan.md#handmade-chart-coverage-extension)
and [native token inventory](./native-chart-token-inventory.json) record the
implemented settings and boundaries. Wider theme migration and the named
aggregate service remain separate work below.

## Post-Review Production Hardening — 2026-10-09

The follow-up review's eight implementation findings and three contract/documentation
gaps are addressed in working source, with individual regression coverage:

- [x] Reserve full automatic numeric/time endpoint bar groups, including caps,
  without changing raw X units or authoritative explicit clipping.
- [x] Replace native and equivalent Arc color denylists with one pure bounded
  supported-color grammar; use color-only swatch properties as defense in depth.
- [x] Keep realtime segment lifecycle keys through observed-ID overlap as windows
  advance; split/merge corrected gaps without replaying already visible data.
  Commit identity state only after render; discarded concurrent snapshots cannot
  change mounted paths. Retirement retains no historical identity map.
- [x] Traverse missing Cartesian cells without resetting keyboard position;
  only eligible series are selectable at each observation.
- [x] Activate the effective inspected polar identity after pointer leave;
  controlled owners still accept or reject requests explicitly.
- [x] Link persistent atomic exact polar readouts to keyboard plots, independently
  of custom tooltip suppression. Other native summaries keep their live node
  present before the first inspection, without duplicating polar announcements.
- [x] Derive bubble-size domains from visible bubble marks only.
- [x] Fall back safely for numerically degenerate smooth segments instead of
  emitting nonfinite SVG controls.
- [x] Fail closed for async or nonboolean predicates with distinct typed errors;
  consume async rejection, do not project partial selection or retain old data.
- [x] Use compensated additive totals and binary64-scale declaration checks;
  exact zero/subnormal contradictions and positive magnitude overflow reject.
- [x] Implement actual measured low/high area interval bands, including missing
  bounds, isolated whiskers, orientation and noninverting smooth boundaries.
  Raw percent-stack intervals remain invalid rather than changing units.

All fixes retain the custom native/Arc rendering and existing motion/design
roles. They add no renderer engine, data transport, provider boot or dependency.
The guides document the supported paint grammar and new predicate error codes.
Source-copy consumers retain the shared pure color boundary and internal path/
keyboard helpers; synthetic harnesses remain excluded.

Browser regressions use the isolated synthetic harness after the in-app browser
connection failed. The color-request probe is intercepted and blocked; there are
no permitted external requests, app configuration or live database calls. The
controlled-polar regression also waits for the synthetic owner's committed
acceptance state before activation, avoiding a fixture scheduling race.

Final qualification: **531 passed, zero failures, 22,821 assertions across 54
files** in the complete chart/package/copy/reactive/documentation run. The
supplemental final query/live-region run passed **16 tests** (including three
new live hook error/recovery cases and two persistent frame-readout cases).
All 25 complete documentation examples compile; the structural gate still has
758 unique reachable pages and no problems. `git diff --check` is clean.
The repository-wide TypeScript check retains only the four previously recorded
non-chart test errors; no chart diagnostics were added.

The corrected four-bar endpoint capture is
`/Volumes/code-bank/artifacts/zero-platform/diagnostics/native-cartesian/review-endpoint-bars.png`.
Light/dark/mobile family captures are refreshed by the full browser run. These
are synthetic working-source checks, not a live-app, published-package or
provider qualification claim.

## Later Chart Data Services

The wider chart facade should accept named, authorized aggregate snapshots with
explicit metric/window/filter definitions, scope identity, revision and freshness.
Design this after the component vertical slice; the first query bridge is not
that server service.

Use registered server query handlers and existing SDK requests for snapshots.
Use Zero Sync for bounded invalidation or already authorized aggregate rows. Reuse
Fabric routing and server-resolved principal/tenant topology; never let chart
configuration choose database paths, credentials or arbitrary SQL. Authorization
scope changes retire displayed data and pending work before subscribing again.

The concrete query seam is `defineDatabaseRealm({ queries })` with an
authority-bound `AsyncDatabaseClient.query`, preserving its value/sequence
envelope and consistency policy. Request services already derive data/Fabric
authority; a chart route must still enforce resource row/column policy within
that physical database scope.

Database triggers/functions may maintain aggregates where appropriate, with
idempotent updates, deletion/correction handling and explicit source ownership.
Torrent may own expensive background recomputation; the chart follows acknowledged
results and progress, not its own scheduler. Resource field access applies to
aggregate inputs and outputs. Rate, distinct-count and percentile semantics need
separate definitions rather than summing arbitrary cached values.

Transaction database functions and insert/update/delete triggers already expose
the required writer capability. Use the previous row to reverse an old
contribution on corrections or deletion, and apply the new contribution in the
same accepted transaction. Durable recomputation uses the existing outbox and
source-scoped service capability, not a chart-owned timer.

Qualification must cover reconnect, concurrent writes, stale revisions, scope
switches, errors, backpressure and bounded history. Add further chart types behind
the same data contract only after their semantics are defined. Existing Recharts
can consume compatible snapshots during migration; replacement is incremental.

## Token Notes

The Sankey reference adds a six-color categorical palette, neutral downstream
nodes, tinted resting ribbons, source/ink trace bands, small source-colored
particles, ordinary-font tabular values and a compact multi-row inspector.
Keep these chart-specific roles overrideable and distinct from legacy series.
Do not reorder the existing five-color palette or install an external font.

The [theme plan](./design-token-theme-evolution-plan.md) owns the later decision
to promote inspector typography, spacing, border and elevation into shared
tooltip/popover defaults. The component can demonstrate that language now without
silently redesigning unrelated overlays.

The supplied chart references must converge into one shared Zero visual language.
Their minor radius, spacing, type, shadow, grid, focus and palette differences
are temporary reference inputs, not separate permanent chart themes. Follow the
[cross-chart convergence checklist](./design-token-theme-evolution-plan.md#shared-chart-language-convergence)
to select common family roles and compatibility aliases. Preserve intentional
flow/ranking geometry and motion while normalizing their shared presentation.
