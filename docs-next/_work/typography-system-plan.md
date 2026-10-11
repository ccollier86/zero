---
id: zero.typography-system-plan
type: roadmap
audience: [developer, agent, maintainer]
owner: design-system
status: draft
visibility: internal
system: design-system
feature: typography
maturity: experimental
applies_to: ["Arc-led typography adoption; 2.6.0 working source inventory"]
modes: [browser, SSR, light, dark, application, public-pages, documentation]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "335b27372b0b8ef57a1e92cf93cec378923fe50b"
  snapshot: dirty
  date: "2026-10-10"
  evidence_level: source-observed
---

# Typography System Plan

[Working evidence](./index.md) · [Theme evolution plan](./design-token-theme-evolution-plan.md) · [Design system roadmap](../frontend/design-system/roadmap.md)

Use Arc's established typography foundation as Zero's baseline, with a small,
documented set of compact and analytical exceptions. Standardize text hierarchy
and consumption rather than inventing a different scale for each component.
Preserve the polished sidebar, useful chart readouts and readable documentation;
keep the deliberately redesigned, slightly dynamic modal presentation.

The [implemented typography baseline](../frontend/design-system/typography.md)
now includes complete CSS-first recipes, actual shared consumers and optional
native Text/Heading. Full-screen adoption and font/locale/accessibility
qualification remain staged work. AppShell now activates next by default;
custom/public boundaries remain explicit. No font assets are installed and
original theme files are retained under the
[separate retirement gates](../frontend/design-system/foundation-next.md#retire-the-original-theme-safely).

## Arc Baseline

The pinned [Arc foundation](https://github.com/kuratlielia/arc-library/blob/86330cc9270c4acc55b7204c9583fcbaa378192c/registry/foundation.css#L65)
separates Inter body from Geist display, uses the rem scale below, and supplies
body/display leading 1.4/1.1 and tracking −.01em/−.03em. Its
[theming guide](https://uiarc.dev/docs/theming) assigns Geist to headings at 30px
and above, and Inter to other text. The [existing Arc inventory](./arc-design-language-audit.md#foundation-token-ledger)
records the source identity and separate compact dashboard references.

| Shared scale | rem | Pixel equivalent at a 16px root |
| --- | --- | --- |
| Extra small | .75 | 12 |
| Small | .875 | 14 |
| Base | 1 | 16 |
| Large | 1.125 | 18 |
| Heading | 1.375 | 22 |
| Page | 1.75 | 28 |
| Display small | 2.25 | 36 |
| Display medium | 3.25 | 52 |
| Display large | 4.5 | 72 |

Use these steps for new ordinary typography. Zero's existing 13px compact text
and 15px section role remain explicit product-density exceptions, not another
general scale. Approved chart/tooltip measurements remain analytical exceptions.
Do not add a new intermediate size every time a component needs better spacing.
Current canonical names retain their values during migration; add missing steps
and semantic mappings without silently changing existing overrides.

Keep regular/medium/semibold weights 400/500/600 as the normal vocabulary.
Existing bold metric/brand treatments are compatibility exceptions to qualify,
not permission to remove available emphasis from prose. Body text uses the body
family, including smaller product headings; larger deliberate headings/readouts
use display. Technical source and IDs
use mono. A numeric value does not automatically require a monospace face.

## Current Implementation and Gaps

| Area | Implemented now | Adoption requirement |
| --- | --- | --- |
| Foundation | [Base tokens](../../src/design-system/theme-foundation.ts) retain existing values; [typography catalog](../../src/design-system/theme-typography.ts) adds the standard scale and 37 complete text recipes consuming shared families/leading/weights/tracking. | Qualify wider compositions and real font assets; maintain approved analytical exceptions. |
| Application base | The next supplement applies the body tuple to explicit next boundaries. Optional [Text/Heading](../../src/components/typography/index.ts) applies complete marked recipes through native semantics and base-layer CSS. | Continue full-screen adoption without converting every native control into a wrapper. Unmarked legacy siblings remain untouched. |
| Controls and cards | [Button](../../src/components/ui/button.tsx), [Input](../../src/components/ui/input.tsx), [Label](../../src/components/ui/label.tsx), [Card](../../src/components/ui/card.tsx) and [StatCard](../../src/components/ui/stat-card.tsx) now consume role utilities with legacy Tailwind and caller overrides. | Typography does not fix oversized content spacing: metric padding remains separately fixed at `p-6`, and control heights are unchanged. |
| Sidebar and AppShell | [Sidebar](../../src/components/animate-ui/components/radix/sidebar.tsx) and [AppShell](../../src/components/app-shell/app-shell-sidebar.tsx) use 14px-equivalent main text and 12px metadata. | Preserve their first migration baseline and magnetic geometry. Do not automatically apply the 13px compact role to this successful layout. |
| Lists and menus | DenseList's existing size aliases bridge to roles; [Command](../../src/components/ui/command.tsx) and Select use direct native row/trigger/input/shortcut roles. | Continue Cascader/context/dropdown family adoption under existing interaction owners. Existing literal specialized weights/leading remain intact. |
| Modal and tooltip | Existing title/body/description/meta/key aliases bridge to canonical recipes. Standalone tooltip source precedence matches grouped tooltips, and the shared backdrop follows the active owner's scoped paint. | Preserve hierarchy and redesigned materials/motion; continue complete settings-screen qualification. |
| Analytical UI | Existing chart label/readout/inspector size/leading aliases bridge into preserved analytical recipes. | Arc/vector readouts and remaining literal properties are not universally restyled; qualify them independently without flattening geometry. |
| Prose and docs | [Documentation styles](../../packages/docs/src/ui/docs.css) already implement 16px/1.8 reading copy, 32px title, 24px h2 and 18px h3, with semantic Markdown rendering. | Reuse this reading profile. Its approved-looking local hierarchy should not be replaced by dashboard leading or shrunk to 13px. |
| Code and streaming | Code size/leading/header aliases consume the technical/foundation roles; ligatures/indentation/copy stay intact. StreamingText inherits typography. | Preserve canonical accessible text, and continue readable syntax/terminal color qualification independently. |

The earlier declared-but-unconsumed boundary gap is corrected. Native Chromium
checks now use actual shared controls and compiled CSS, not just token strings:
ordinary next text is 14px/1.5; compact controls are 13px; responsive inputs stay
16/14px; local role/family changes affect rendered text; unmarked legacy
consumers and their customized Tailwind defaults retain their fallbacks.

Selecting a font stack also does not install that font. Runtime source currently
does not supply a webfont loader or bundled font-face installation. Exact font
fidelity therefore needs an application-owned asset/loading contract.

## Semantic Text Roles

Use the implemented shared role catalog, with presentation profiles for
application, analytical, reading and public UI. The table below retains the
broader adoption targets; the [current reference](../frontend/design-system/typography.md)
distinguishes actual role defaults and wired consumers from later migrations.

| Role or profile | Starting size and leading | Weight and family | Preservation rule |
| --- | --- | --- | --- |
| Body and control label | 14px / 1.4–1.5 | 400 body; 500 action/label | Standard product text. Compact dashboard copy may explicitly use 13px after qualification. |
| Supporting text and metadata | 12px / 1.4–1.5 | 400 body | Secondary hierarchy, not low-contrast decoration. Keep existing 13px DenseList descriptions. |
| Input value | Existing 16px below `md` / 14px at `md` and above | 400 body | Retain the current viewport-based distinction while qualifying compact geometry and real mobile browsers; the breakpoint does not detect device type. |
| Navigation and choice rows | Existing 14px main / 12px metadata | 400–500 body | Preserve sidebar and menu baselines; no hover-driven font-size or weight jump. |
| Section and panel title | 16px / 1.4; explicit compact section 15px | 500–600 body | Reuse one title recipe; labels are not miniature page headings. |
| Product page title | 22px / 1.2–1.3; 28px for roomier composition | 600 body | Keep Inter for these smaller headings, following Arc's body/display distinction. Tighten supporting-copy gaps independently; HTML level follows the document hierarchy. |
| Metric value | 22px or 28px / 1.1–1.3 | 500–600 body, tabular | Existing 24px/bold metrics remain a compatibility baseline until compared. Larger display readouts use the display recipe; values, units and deltas are separate roles. |
| Eyebrow and group label | 12px / 1.4 | 500 body | Optional uppercase/tracking only for true headings, never user names or arbitrary translated content. |
| Modal profile | Existing ~16.3px title, 14px body, ~13.8px description, ~12.8px meta/footer | Existing title 600 and 1.35 leading; body 1.5 | Retain approved shell hierarchy and dynamic materials, rather than restoring the pre-redesign modal. |
| Brief tooltip profile | Existing 12.5px / 1.4; 12px mono; 11px keys | 500 body; rich title 600 | Keep ordinary hints distinct from analytical inspectors. |
| Analytical profile | Existing 14px title/readout; 12.5px labels/rows; 11.5px metadata | Body, tabular for comparable numbers | Inspector remains 12px/1.45 support and 17px/1.3 value; Race Bar's 30px/38px period is a deliberate readout. |
| Reading profile | Existing 16px / 1.8; 32/24/18px heading hierarchy | Existing documentation body family; body 400, headings 600 | Preserve the current family as the compatibility baseline, comfortable reading measure, paragraph rhythm and native h1–h6 semantics. A later Geist/display adoption is deliberate and font-qualified, not an automatic consequence of the 32px title. |
| Technical profile | Existing 13px code / 1.75 | Mono, existing feature policy | Preserve indentation/tab size, selectable text, syntax hierarchy and full values. |
| Public display profile | 36/52/72px / 1.1 | Display, −.03em tracking | Responsive bounded composition; do not import public hero scale into application cards or dialogs. |

Every recipe resolves family, size, leading, weight, tracking and numeric style
together. Casing and wrapping are explicit optional policies. Paint remains a
separate semantic responsibility: changing typography must not recolor terminal
identities, statuses or named chart categories.

Density primarily changes spacing, padding and minimum targets. It must not
shrink readable prose, force mobile input text smaller, compress chart labels or
enlarge the successful sidebar. Start with the existing protected roles, then
compare compact content layouts rather than globally replacing `text-sm`.

## Consumption and Compatibility

CSS-first recipes are implemented separately from the foundation. Pure catalog
and composition exports stay safe for server tools and SSR. Optional Text and
Heading consume the same recipes as native controls and explicit markers;
Markdown and SVG can adopt markers without a second provider or wrapper.
The [reference](../frontend/design-system/typography.md) documents shipped
working-source exports and their native prop/ref/Slot contracts.

Separate visual role from HTML meaning. A card's section-sized title is not
automatically an h1; field labels still require actual label associations.
Preserve forwarded refs, native attributes, `asChild` composition, screen-reader
names and app-owned class/style overrides. Streaming and numeric animations keep
canonical accessible content separate from intermediate painted glyphs.

Resolution is explicit component override → family/profile recipe → foundation
fallback at the consumer. Keep existing `--zero-modal-*`, `--zero-tooltip-*`,
`--zero-chart-*`, `--zero-list-*`, `--zero-code-*`, `--zero-docs-*` and platform
family overrides compatible. Do not freeze aliases at the document root or let
a broader modal owner overwrite a closer trigger's typography. Do not fix
portals by copying arbitrary computed layout properties.

Apply a recipe's properties deliberately; a global `font` shorthand can reset
unrelated feature settings and is not a safe migration shortcut. Root and nested
opt-in scopes, passive density regions, owned portals and local overrides need
separate tests. Merely loading the supplemental stylesheet remains inactive.

## Fonts and Measurement

Keep Inter body, Geist display and an overridable technical mono stack with
system/emoji/script fallbacks. Recognize the actual family names supplied by an
application's font loader; a font variable and a font's marketing name are not
necessarily its registered CSS family. No automatic Google-font fetch or font
provider is required for the pure typography facade.

Qualify an application-owned local/self-hosted loading option with declared
weights and licenses, fallback-first paint and no SSR preference read. Retain
legacy mono choices where apps override them. Avoid invisible text while loading
or synthetic weight assumptions where a required face is unavailable.

Measured highlights, popups, truncation, rolling digits and chart gutters must
retarget after effective font changes, completion/failure and text resizing.
Preserve the existing Sankey/Race Bar/Funnel font subscriptions. Font updates
must not reset data, selection, playback, drafts or scroll position.
Measurement must match the rendered weight, tracking and relevant numeric
features, not just a nominal font-size string. Non-Latin fallback metrics and
combining/emoji graphemes need realistic probes; no per-character infinite loop
or hand-tuned clipping box should be required for ordinary text.

Formatting remains data/controller-owned. Preserve current formatter callbacks
and compatibility defaults; make locale and numbering choices explicit rather
than deriving currency/date formats from a CSS theme. Tabular numerals are for
comparison and changing values, not a substitute for proper locale formatting.

## Qualification Gates

- Small meaningful text, placeholders and hover content require qualified paint
  pairs; do not copy faint reference metadata without checking the actual fill.
  Use [WCAG contrast minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)
  as the acceptance constraint, not font size alone.
- Verify text enlargement through 200% without content/function loss, as
  described by [Resize Text](https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html).
  Test root-font changes separately from viewport resizing.
- Verify ordinary content reflows at a 320 CSS-pixel width equivalent. Tables
  and diagrams may need deliberate two-dimensional layout; that exception is
  not a license for overflowing headings, form labels or individual cells.
  See [Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html).
- Apply user text-spacing overrides together: line-height 1.5, paragraph spacing
  2em, letter spacing .12em and word spacing .16em. These are override tests, not
  required authored defaults. Keep content and controls usable; qualify legitimate
  truncation with a discoverable full value. See
  [Text Spacing](https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html).
- Cover long translations, RTL, CJK, Arabic, diacritics, emoji, signed/currency/
  large numeric values and keyboard-only full-value inspection. Do not scale
  text down to hide wrapping problems.
- Cover loaded, delayed, missing and failed fonts; nested light/dark scopes;
  live owned portals; reduced motion; coarse pointers; SSR/hydration; managed
  styles; package and source-copy consumers. Font-ready events alone are not
  equivalent to a real delayed-font test.

## Delivery Order

1. **Retain the corrected narrow integration behavior.** Follow the
   [second review ledger](./design-token-theme-evolution-plan.md#follow-up-review-and-preservation)
   for the corrected backdrop scope, Sankey mode-dependent radius, tooltip
   precedence and trusted configuration admission. Keep existing owners and
   their permanent regression checks.
2. **Maintain the implemented Arc-based catalog.** Standard scale, semantic
   tuples, explicit exceptions, validation and parity tests are in place. Old
   names/values remain compatible; no global Tailwind size rewrite is needed.
3. **Extend the first product adoption.** Core labels/helpers/errors, controls,
   cards and Select/Command rows now consume roles. Continue screen-level
   section/page heading and compact card composition work.
   Coordinate Morph Select and ScrollArea geometry. Keep sidebar/nav as a
   preservation fixture rather than the first broad restyling target.
4. **Complete specialized adoption.** Existing modal, tooltip, chart, list and
   code alias channels now consume canonical roles. Continue remaining literal
   properties and vector/reading consumers with before/after comparisons. Keep
   the slightly dynamic modal theme, approved motion and analytical differences.
5. **Qualify complete compositions.** Use synthetic equivalents of the supplied
   dashboards, not patient/account data. Include long-content settings, dense
   tables, charts, readable docs and public display with the gates above.
6. **Document and promote deliberately.** The role/API catalog, source-only
   Doctor diagnostics, managed next default and fresh installed-package checks
   are implemented. The user authorized application activation before later
   visual testing; screen/font/accessibility qualification remains pending.
   Retain old files until a separate reviewed removal step.

The consumer baseline is implemented and covered by pure, native-type, SSR,
compiled-CSS browser and source-copy checks. Broader adoption values remain
subject to screen and font/accessibility comparisons; this is not a completed
platform-wide typography migration.

## Reusable Changing-Number Presentation

The [NumberField and RollingNumber plan](./number-field-rolling-number-plan.md)
places generic changed-digit presentation with typography, while the field
organism owns editing and the table adapter retains count/save authority. This
is a proposed display component, not an implemented Text/Heading extension.

Use the existing analytical/control role appropriate to the consumer and
tabular numeric paint. Preserve signs, fractions, locale/grouping and affixes
without installing another font scale. Stable digit-place identities and
interruptible animation must not change the business value. Standalone display
needs one accessible value; table compositions retain their existing complete
sentence and hidden digit paint. Fast tickers do not announce every frame.
Actual field/display APIs and adopted tokens belong in their full manual after
implementation and consumer qualification.
