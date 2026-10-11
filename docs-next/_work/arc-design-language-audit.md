---
id: zero.arc-design-language-audit
type: inventory
audience: [developer, agent, maintainer]
owner: design-system
status: draft
visibility: internal
system: design-system
feature: arc-led-theme-evolution
maturity: planned
applies_to: ["Future Zero theme and effects; public Arc source observed on 2026-10-09"]
modes: [browser, SSR, light, dark, application, public-pages]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "335b27372b0b8ef57a1e92cf93cec378923fe50b"
  snapshot: dirty
  date: "2026-10-10"
  evidence_level: source-observed
---

# Arc Design Language and Effects

[Working evidence](./index.md) · [Theme evolution plan](./design-token-theme-evolution-plan.md) · [Design system roadmap](../frontend/design-system/roadmap.md)

Arc is the user's selected leading reference for Zero's future overall visual
language, not just its chart library. Carry its quiet surfaces, fine typography,
restrained color and continuous interactions into ordinary application UI and
public pages. Preserve the supplied visualization references and explicitly
approved Zero behavior while resolving small differences into one shared system.
The user's 2026-10-10 clarification makes existing Zero magnetic hover highlights
mandatory to preserve and expand, not merely a candidate Arc effect. Follow the
[magnetic-highlight contract and coverage ledger](./design-token-theme-evolution-plan.md#required-magnetic-highlight-contract)
for sidebar/public navigation, calendar cells and menu/option surfaces.
The same clarification selects compact dashboard content, Arc Morph Select as
the default select visual direction, and Arc UI ScrollArea's exact overflow
treatment. The [approved requirements](./design-token-theme-evolution-plan.md#compact-dashboards-rich-pickers-and-shared-overflow)
separate these decisions from still-unimplemented migration/API work.

This analysis records upstream choices and proposed mappings. It does not install
Arc's foundation, adopt a new effects API, change global tokens or replace any
component. The [machine-readable inventory](./arc-design-token-inventory.json)
holds exact values and source identities; the existing
[Arc chart inventory](./arc-chart-token-inventory.json) and
[Zero-authored chart inventory](./native-chart-token-inventory.json) remain separate
evidence for their respective implementation slices.

## Source Scope

The public [Arc repository snapshot](https://github.com/kuratlielia/arc-library/tree/86330cc9270c4acc55b7204c9583fcbaa378192c)
contains **109 component directories and 18 block directories**, covering 273
TS/TSX/CSS files in this inventory. These are directory/file counts, not a claim
that they equal the website's advertised catalog counts. Token-reference indexing
covers every captured file; detailed interaction reading concentrates on controls,
inputs, navigation, overlays, information surfaces, text effects and public blocks.
It is not an exhaustive runtime review of every component.

The inventory also records 97 distinct foundation custom properties, 252
declarations in source order, shared JS motion presets, and 27 published CSS assets
referenced by the homepage, Button page and Theming page. Source links pin commit
`86330cc9270c4acc55b7204c9583fcbaa378192c`; dated website asset hashes distinguish
this observation from future builds. Assets include demo-specific paint, which
must not be mistaken for a universal component theme or access to Pro implementation.

The current public registry's foundation and motion definitions match this
snapshot. Sample Button and Morph Select CSS matches too; their registry TSX differs
only in rewritten motion-token import paths. Repository source, installation
transforms and website styling therefore have distinct identities.

The 2026-10-11 [Floating Button Group adoption plan](./floating-button-group-plan.md)
now makes the user's full-component requirement explicit. Its
[token supplement](./floating-button-group-token-inventory.json) reconciles all
35 captured CSS references, 26 declarations and eight motion references. The
current CSS remains byte-identical to this pinned inventory; TSX installation
changes only the motion-token and Tooltip import paths. That dated reference
coverage remains unchanged. A separate [Zero family implementation](../frontend/components/controls/floating-button-group.md)
now consumes 57 scoped roles and the existing Tooltip on all four sides; it does
not change the pinned directory counts or import Arc's private side-tooltip.

Primary foundations are [foundation.css](https://github.com/kuratlielia/arc-library/blob/86330cc9270c4acc55b7204c9583fcbaa378192c/registry/foundation.css),
[motion-tokens.ts](https://github.com/kuratlielia/arc-library/blob/86330cc9270c4acc55b7204c9583fcbaa378192c/registry/motion-tokens.ts),
the [Theming guide](https://uiarc.dev/docs/theming), and the
[Motion guide](https://uiarc.dev/docs/motion). No private component code was acquired
and no upstream application code was executed.

## What Creates the Arc Character

The strongest recurring pattern is **stable content inside a moving surface**.
Labels keep natural metrics while one highlight, panel or outline follows the
interaction. Geometry springs toward its target; opacity, color and small blur
changes finish on shorter tracks. A new target retargets the existing motion
instead of replacing it with a fresh entrance. This principle matters more than
copying one curve or applying bounce everywhere.

Surfaces stay mostly neutral. Fine separators, aligned text and quiet state fills
organize information; stronger color marks selection, progress, categories or
status. Elevation belongs to actual floating layers. Hover effects tend to be
fine-pointer-specific, while touch and keyboard have explicit behavior. Public
headlines and showcase scenes are more expressive than compact product controls.
These patterns are supported by the source recipes below, not inferred solely
from promotional screenshots.

## Foundation Token Ledger

Pixel equivalents below assume a 16px root font size. Arc's rem values remain
scalable; these conversions are not fixed-pixel requirements for Zero.

| Family | Observed Arc values | Proposed Zero direction |
| --- | --- | --- |
| Neutral scale | Achromatic OKLCH lightness 100, 99, 97.8, 95.8, 91.5, 84, 72, 59, 46, 34, 23, 15%. | Leading reference for quiet depth. Decide deliberately whether Zero keeps a slight cool undertone from its existing theme and Pantheon references. |
| Surfaces | Light background/surface/raised white; muted 97.8%. Dark background 19%, surface 21.5%, raised 24%, muted 26%. | One semantic depth hierarchy across components; separate inset wells from muted interaction fills. |
| Content and borders | Light text 15/46/59%; borders 93.5/96.5/82%. Dark text 96/77/64%; borders 29/25/40%. | Primary/supporting/hint roles plus default/subtle/strong borders; qualify actual text and control contrast before adopting values. |
| Accent and states | Neutral action ink 33% light/80% dark; strong 24/91%; subtle alpha .10/.13. Eight neutral/violet/blue/green/amber/orange/coral/rose accents; separately tuned success/warning/danger. | Brand ink/fill, brand wash, status pairs and category colors are different responsibilities. Exact accent and state values are retained in the inventory, not selected global defaults. |
| Selection controls | Separate on fill, glyph, track, hover track, resting/on thumb, slider fill and thumb shadow. Neutral-dark on thumb inverts; colored dark fills differ from pastel text accents; amber glyph is dark. | Candidate shared selection-control roles. Do not make every selected surface, check and thumb use one undifferentiated brand color. |
| Typography | Geist display, Inter body; tracking −.03em/−.01em; leading 1.1/1.4. Sizes 12/14/16/18/22/28/36/52/72px. | Shared display/body/technical roles; meaningful ordinary-font numeric hierarchy and tabular values. Fonts remain application-owned, with SSR-safe measurement and fallbacks. |
| Spacing | 4/8/12/16/20/24/32/40/48/64/80/96px equivalents. | Coherent base scale with named compact/product/public density mappings, not dozens of unrelated padding constants. |
| Shape and targets | Foundation control/panel/surface radii 18/26/34px; pill 9999px. Control heights 36/44/50px. | Softer silhouettes where useful, with separately selected dense analytical geometry and comfortable hit targets. These are not universal component radii. |
| Elevation | Light resting 1×2px/.035; raised 6×18/.065 + 1×3/.035; floating 20×48/.105 + 3×10/.045. Dark resting 1×2/.18, raised 8×22/.22, floating 22×55/.34. | Named resting/raised/floating elevation. Preserve the already unified compact analytical inspector rather than adding another chart-specific shadow. |
| Brand washes | Lavender/peach stops, distinct soft background, line and ink gradients, separately tuned dark variants. | Optional public/brand/celebratory treatments. A gradient background and gradient text require different semantic and contrast contracts. |

The exact [foundation source](https://github.com/kuratlielia/arc-library/blob/86330cc9270c4acc55b7204c9583fcbaa378192c/registry/foundation.css#L1)
and inventory preserve selectors and repeated overrides. A token's root declaration
is not necessarily its effective value under an accent, dark mode or component scope.

### Website and Product Density Are Different

Arc's [published homepage stylesheet](https://uiarc.dev/_next/static/css/6aadd1c7196f605a.css)
adds neutral action ink even when another accent is configured. Its hero uses
30px corners, a warm `#f8f7f5` canvas with pink/blue/gold radial washes, and 48–78px
light-weight display type with −.057em tracking. Photographic showcase backgrounds
use blur and scene-specific color. These are public-page composition choices,
not a reason to recolor every input or analytical card.

The [published demo stylesheet](https://uiarc.dev/_next/static/css/33309aae510ab8d2.css)
also contains a compact dashboard frame: 232px sidebar, 52px top bar, 32/36px small/
medium controls, 13px body text and 16px cards. A scoped analytics theme uses 13px
body/12px metadata/15px titles/22px figures, 6px controls, 8px panels and 10px
surfaces, with a local rose accent. Demo dialogs override controls to 6px and
surfaces to 10px. These scoped values coexist with the much rounder foundation.

Zero should have one role system with intentional density/presentation variants,
not separately drifting palettes copied from each demo. The inventory records
these scoped declarations and source assets without adopting their local names.

## Motion Vocabulary

Arc's [JS motion definitions](https://github.com/kuratlielia/arc-library/blob/86330cc9270c4acc55b7204c9583fcbaa378192c/registry/motion-tokens.ts#L3)
and [CSS foundation](https://github.com/kuratlielia/arc-library/blob/86330cc9270c4acc55b7204c9583fcbaa378192c/registry/foundation.css#L73)
are related but not interchangeable:

| Role | Exact upstream setting | Appropriate use |
| --- | --- | --- |
| Feedback durations | JS 120/160/180/240/480ms for instant/fast/exit/standard/considered; CSS 120/160/240/480ms plus 580ms spring. | Paint, opacity, retirement and rare introductions. CSS does not declare the JS exit-duration token. |
| Easing | Enter (.16,1,.3,1); standard (.22,1,.36,1); exit (.7,0,.84,0); in-out (.65,0,.35,1). | Separate arrival, departure and already-visible movement. |
| Snappy | 260ms visual duration, .12 bounce. | Small toggles, thumbs, presses and indicators. |
| Smooth | 400ms visual duration, zero bounce. | Height, layout and clipping-sensitive geometry. |
| Morph | 420ms visual duration, .16 bounce. | Shared highlights, shape and content-driven width. |
| Pointer springs | Responsive stiffness/damping 520/38; gentle 340/34. | Direct manipulation versus larger calm movement; not millisecond durations. |
| Stagger and blur | Character/word/line/item 16/40/80/35ms; blur 2/4/8px. | Bounded reading-order reveals or short text handoffs, not a perpetual tax on ordinary text. |

Arc's CSS sampled spring and component-local opening/closing curves are not
identical to every JS preset. Keep explicit units, independent tracks and one
owner per animated property. Do not flatten Zero's selected modal, tooltip,
table, calendar and chart contracts into one global timer.

## Reusable Product Effects

The classification is a proposed adoption policy, not a newly implemented API.
Each recipe needs Zero composition, lifecycle and accessibility qualification.

| Recipe and source | Observed behavior | Proposed place in Zero |
| --- | --- | --- |
| [Button state continuity](https://github.com/kuratlielia/arc-library/blob/86330cc9270c4acc55b7204c9583fcbaa378192c/registry/components/button/button.tsx#L19) | 120ms press; scale .96/.97/.985 by width; label blur4 with short vertical handoff; width morphs only after actual label change. Loading preserves geometry. Popup triggers do not scale. | Common control recipe with restrained paint/press defaults. Label replacement remains selective; pending state follows the actual action. |
| [Shared toolbar highlight](https://github.com/kuratlielia/arc-library/blob/86330cc9270c4acc55b7204c9583fcbaa378192c/registry/components/button-group/button-group.tsx#L159) and [floating tray](https://github.com/kuratlielia/arc-library/blob/86330cc9270c4acc55b7204c9583fcbaa378192c/registry/components/floating-button-group/floating-button-group.tsx#L123) | First highlight appears at its target; subsequent position/size moves together. Snappy joined row versus Morph floating tray; separate pointer/focus/menu precedence. | Zero's existing magnetic handoff is a required retained/expanded behavior. Arc supplies additional composition evidence, not permission to replace Zero's tuned spring with a different default. |
| [Tabs](https://github.com/kuratlielia/arc-library/blob/86330cc9270c4acc55b7204c9583fcbaa378192c/registry/components/tabs/tabs.tsx#L35) and [segments](https://github.com/kuratlielia/arc-library/blob/86330cc9270c4acc55b7204c9583fcbaa378192c/registry/components/segmented-control/segmented-control.tsx#L24) | Instance-scoped moving selection, no label weight/scale jump; directional panel handoff with measured height; real overflow masks and roving focus. | Standard selection vocabulary. Auto-height panels must not replace fixed-height modal tabs or their retained scroll state. |
| [Switch](https://github.com/kuratlielia/arc-library/blob/86330cc9270c4acc55b7204c9583fcbaa378192c/registry/components/switch/switch.tsx#L15) and [checkbox](https://github.com/kuratlielia/arc-library/blob/86330cc9270c4acc55b7204c9583fcbaa378192c/registry/components/checkbox/checkbox.tsx#L16) | Switch 42×24px, 18px thumb/travel; press stretches toward destination. Checkbox 18px visual inside larger hit area; check/dash path morphs without moving the target. | Standard candidate for tactile selected state; preserve a stationary comfortable hit target and separate glyph/fill contrast. |
| [Morph Select](https://github.com/kuratlielia/arc-library/blob/86330cc9270c4acc55b7204c9583fcbaa378192c/registry/components/morph-select/morph-select.tsx#L69) | One trigger/options material; open radius22px; grow400/.12, shrink340/0, glide280/.08, width420/.16; selected text flies from option to trigger. Search above eight options. | User-approved default select visual direction. Adapt to Zero's form/portal/collision/owner system; source uses inline absolute positioning, not a general overlay engine. Density remains independently qualified. |
| [Date range morphology](https://github.com/kuratlielia/arc-library/blob/86330cc9270c4acc55b7204c9583fcbaa378192c/registry/components/date-range-picker/date-range-picker.tsx#L26) | Trigger-to-panel grow480ms/.12 bounce, shrink380ms/0; month/range/endpoints move in date order; 36px calendar cells and responsive two-to-one calendar layout. | Picker-specific variant, not a new global dialog entrance. Preserve actual selected dates and keyboard semantics. |
| [Number field](https://github.com/kuratlielia/arc-library/blob/86330cc9270c4acc55b7204c9583fcbaa378192c/registry/components/number-field/number-field.tsx#L80) and [counter](https://github.com/kuratlielia/arc-library/blob/86330cc9270c4acc55b7204c9583fcbaa378192c/registry/components/animated-counter/animated-counter.tsx#L23) | Stable digit-place identity, independently measured width, directional numeric rolls. Number bounds resist rather than fake a value beyond the limit. | Selective readout/value-change effect. Batch rapid updates and keep exact data accessible; interpolated paint is not a new database value. |
| [Inline edit](https://github.com/kuratlielia/arc-library/blob/86330cc9270c4acc55b7204c9583fcbaa378192c/registry/components/inline-edit/inline-edit.tsx#L43) | Display/editor metrics match; width/height retarget without wrapping jumps; pending text subdued; failure opens a true-zero error slot and reverses content handoff. | Compose with Zero's acknowledged form/draft controller. Cosmetic optimism must not overwrite canonical data or claim a successful save. |
| [Expandable surface](https://github.com/kuratlielia/arc-library/blob/86330cc9270c4acc55b7204c9583fcbaa378192c/registry/components/expandable-card/expandable-card.tsx#L22) | Actual width/height use Smooth400; content stays at natural width; inactive content inert; interrupted direction reverses from current pose. | Strong disclosure/detail-area candidate. Avoid spring overshoot of constrained heights and text stretching. |
| [Scroll area](https://github.com/kuratlielia/arc-library/blob/86330cc9270c4acc55b7204c9583fcbaa378192c/registry/components/scroll-area/scroll-area.tsx#L17) | Native scrolling, conditional overlay bars only for real overflow; 28px fades, 900ms linger, 11px hit track and 5→7px visual thumb. | User-approved shared overflow treatment for bounded scrolling content. Preserve one actual viewport and Zero table horizontal-bar/pagination policy; exact defaults are recorded in the theme plan. |
| [Sortable table](https://github.com/kuratlielia/arc-library/blob/86330cc9270c4acc55b7204c9583fcbaa378192c/registry/components/sortable-data-table/sortable-data-table.tsx#L155) | Freeze measured widths before position-only reordering; opaque cells avoid transparent passing rows; 52px desktop rows, 44px chrome and narrow two-line records. | Stability/paint reference for existing DataTable, not a replacement local-state data API. Preserve live counts, sorting and incoming-record semantics. |
| [Hold](https://github.com/kuratlielia/arc-library/blob/86330cc9270c4acc55b7204c9583fcbaa378192c/registry/components/hold-to-confirm/hold-to-confirm.tsx#L46) and [inline confirmation](https://github.com/kuratlielia/arc-library/blob/86330cc9270c4acc55b7204c9583fcbaa378192c/registry/components/confirm-morph/confirm-morph.tsx#L15) | Fill edge switches text contrast; linear hold clock, smooth release; inline idle/confirm/pending/done/error/undo faces keep one surface. Defaults differ: standalone1200ms versus inline1000ms. | Optional destructive-action composition; keep Zero hold-to-delete policy, Cancel-first dialogs and real async acknowledgments. Do not copy source's synchronous standalone completion policy. |
| [Text morph](https://github.com/kuratlielia/arc-library/blob/86330cc9270c4acc55b7204c9583fcbaa378192c/registry/components/text-morph/text-morph.tsx#L14) | Character/occurrence matching, short blur/travel, width follows Morph420; plain accessible text separate from visual glyphs. | Optional short status-label effect, not all labels/body copy. No repeated accessibility announcements from per-glyph animation. |
| [Work shimmer](https://github.com/kuratlielia/arc-library/blob/86330cc9270c4acc55b7204c9583fcbaa378192c/registry/components/text-shimmer/text-shimmer.tsx#L10) | Visible/in-view active state runs 1.8s band with pause; finishing glides out and restores solid text; forced-color fallback. | Optional work-in-progress paint driven by actual operation state; no looping decoration over ordinary content. |
| [Chat continuity](https://github.com/kuratlielia/arc-library/blob/86330cc9270c4acc55b7204c9583fcbaa378192c/registry/components/chat-thread/chat-thread.tsx#L465) | Follow only near bottom, show unread/new-message pill, clipped incoming growth, stable compact bubble and reaction anatomy. | Collaboration organism reference tied to Zero streaming/reactive state; new content must not steal a reader's scroll position. |
| [Header navigation](https://github.com/kuratlielia/arc-library/blob/86330cc9270c4acc55b7204c9583fcbaa378192c/registry/blocks/site-header/site-header.tsx#L89) | Shared muted hover, 2px active line, one measured panel; grow440/.12 versus shrink340/0, 70ms intent/180ms leave grace. | Public/product header language; preserve existing magnetic sidebar, animated icons and compact/hide modes rather than replacing them. |

Use real operation state for loading, errors, success, undo eligibility and
completion. The reusable layer owns paint/geometry only. Zero's existing forms,
reactive subscriptions, modal/overlay ownership, notifications and workflow
controllers retain their domain responsibilities.

### Approved Picker and ScrollArea Adaptation

The user's screenshots favor compact content around the existing polished
sidebar. Arc's Morph Select source has a **44px foundation trigger**, 36px option
minimum, 272px panel and 296px maximum list; its selected-label transfer uses a
300ms/.06 spring. These are observed defaults, not a requirement to enlarge
dashboard fields. Qualify compact trigger geometry separately while retaining
the selected visual/material behavior. The
[Morph Select skin](https://github.com/kuratlielia/arc-library/blob/86330cc9270c4acc55b7204c9583fcbaa378192c/registry/components/morph-select/morph-select.module.css)
and public [component guide](https://uiarc.dev/components/morph-select) are the
reference, not a reason to replace mature Zero controllers.

| Existing Zero boundary | Source-observed gap and required adaptation |
| --- | --- |
| [Select](../../src/components/ui/select.tsx) and [form fields](../../src/components/forms/field-renderer.tsx) | Radix owns selection, typeahead, form behavior, trigger ref/blur/autofocus and one real Select.Viewport. Add morphology/rich slots/magnetic active-row presentation while preserving that contract and owned portals. Arc's inline z30 and outside-event root checks cannot be copied unchanged into a portalled surface. |
| [Command](../../src/components/ui/command.tsx) and [Combobox](../../src/components/ui/combobox.tsx) | Active fills and list scrolling are local/static. Preserve cmdk keyboard/search authority, server-results filtering mode and current multiple-value behavior; share row/highlight/overflow presentation. Do not silently substitute flat single-selection semantics. |
| [ContextMenu](../../src/components/context-menu/context-menu-content.tsx) | Rich icons/checks/radios/shortcuts/separators already exist. Active fills are static and root/submenu content portals directly without the owned-floating hook. Add shared magnetic scopes and verify inherited container/theme/layer/inert handling. |
| [DropdownMenu](../../src/components/animate-ui/components/radix/dropdown-menu.tsx) | Root highlight exists; submenu lacks a local highlight boundary and bounded scroll policy. Main/sub wrappers inherit owner styling/registration but need owned-container propagation review. Keep Radix action/check/radio/submenu semantics. |
| [Popover](../../src/components/animate-ui/components/radix/popover.tsx) and [Cascader](../../src/components/cascader/cascader.tsx) | Popover does not own menu rows or a bounded body automatically. Cascader's real CommandList already keeps search/breadcrumb/footer outside scrolling. Share trigger/row/scroll recipes without replacing tree/path, async scope/cancellation or leaf-selection authority. |
| [ScrollArea](../../src/components/ui/scroll-area.tsx) | Existing Radix wrapper has no edge mask or explicit viewport-ref facade. Add Arc's exact effect through the primitive or an adapter on already-owned native/Radix/cmdk viewports, not nested competing scrollers. |
| [Managed modal shell](../../src/modals/modal-shell.tsx) | Body and nav scroll independently; headers/footers and edge-dependent dividers already have ownership. Apply content-only masks/overlay bars while preserving panel refs, tab scroll restoration and current scrollbar-option compatibility. |
| [TimePicker](../../src/components/ui/time-picker.tsx) and [calendar choices](../../src/components/ui/calendar-month-presentation.tsx) | Virtualizers consume existing viewport refs. Keep those refs and one actual scrolling element; do not add a second focusable ScrollArea region inside the picker. |

Use common layout/token responsibility for leading media, title/description,
trailing metadata/checks/branch affordances and noninteractive group separators.
Each semantic adapter keeps its own interaction authority. Scope the magnetic
surface per root/submenu/list, with one owner per animated property; match the
existing Zero sidebar handoff rather than treating every Arc spring as a mandate.

Arc ScrollArea is explicitly selected. The
[exact defaults and qualification sequence](./design-token-theme-evolution-plan.md#required-arc-ui-scrollarea-treatment)
include content-only conditional masks, subtle overlay thumbs, real-overflow
detection and reduced-motion behavior. Correct RTL/overscroll/dynamic measurements,
protect focused rows at masked edges and preserve explicit scrollbar overrides.
The look is shared; menu focus and modal/overlay registration remain Zero-owned.

Public/package and source-copy delivery must agree. The current
[`zero add` registry](../../src/add/registry.ts) does not register direct directory
targets for Cascader/context-menu/dropdown/popover despite package subpaths.
New shared helpers and picker-family targets require explicit registration and
dependency/style copying tests, packed-consumer tests and polished migration docs.
None of these adaptations is marked implemented by this source audit.

### Effects That Should Remain Explicit

[Expanding action pills](https://github.com/kuratlielia/arc-library/blob/86330cc9270c4acc55b7204c9583fcbaa378192c/registry/components/expanding-button-group/expanding-button-group.tsx#L46)
change width and have reveal-then-act touch behavior. [Card Stack](https://github.com/kuratlielia/arc-library/blob/86330cc9270c4acc55b7204c9583fcbaa378192c/registry/components/card-stack/card-stack.tsx#L43)
is a triage/swipe organism, not ordinary list motion. Treat these as named variants.

Public headlines can use [word/line/blur/tracking/wipe reveals](https://github.com/kuratlielia/arc-library/blob/86330cc9270c4acc55b7204c9583fcbaa378192c/registry/components/in-view-title/in-view-title.tsx#L25),
whose local 760–1000ms choreography differs from everyday feedback.
[Hero mesh/glass](https://github.com/kuratlielia/arc-library/blob/86330cc9270c4acc55b7204c9583fcbaa378192c/registry/blocks/hero-section/hero-cadence.module.css#L3)
and [39-second logo marquee](https://github.com/kuratlielia/arc-library/blob/86330cc9270c4acc55b7204c9583fcbaa378192c/registry/blocks/logo-marquee/logo-marquee.module.css#L44)
belong to opt-in public presentation with pause/static reduced-motion behavior.
Photographic blur, mesh palettes and decorative preview glass are not ordinary
popover surfaces or proof that a backend operation is running.

## Differences to Resolve Before Promotion

1. **Semantic names collide.** Arc strong `--accent` is not Zero's existing soft
   accent background. Map action ink/fill to a brand/primary role and quiet washes
   to interaction-surface roles. Arc `surface-muted` is not automatically Zero's
   darker `surface-inset`. Never import competing root definitions unchanged.
2. **Density is a family decision.** Reconcile foundation18/26/34, compact demo6/8/10,
   user modal14, tooltip8 and analytical inspector10px. Standardize within each
   role; do not force one radius, shadow, font size or target across unrelated jobs.
3. **Control paint needs pairs.** Text accent, on fill, glyph and thumb are different
   in dark/color presets. Root aliases alone can freeze ancestor-resolved values;
   preserve live scoped overrides at the consumer, including SVG/canvas measurement
   and portals.
4. **Layers are Zero-owned.** Arc uses local z30/50/51/60/80/90/1000 and some inline
   pickers instead of portals. Reuse [Zero overlay scope](../../src/components/overlays/overlay-scope.tsx)
   and the modal manager, child-first dismissal, exact owner identity, inert lower
   layers and inherited theme. If adding accent attributes, qualify their live
   projection too; do not assume the current attribute observer watches them.
5. **Pointer focus is not keyboard focus.** Arc suppresses pointer rings, but also
   uses broad global `!important` exclusions and inconsistent per-control rules.
   Zero should remove unwanted pointer-click outlines while keeping visible
   keyboard focus, field-error distinction, forced-color support and useful targets.
6. **Contrast needs correction where necessary.** Analytically, Arc's neutral
   light `oklch(59% 0 0)` muted text on white is approximately **4.11:1**: using
   achromatic linear luminance `L³`, `(1.05) / (.59³ + .05)`. It falls below the
   ordinary-text 4.5:1 threshold. Do not use that exact pair for readable small
   metadata/placeholders without adjustment. This calculation is not a browser
   audit of every scoped Arc theme. See [CSS Oklab](https://www.w3.org/TR/css-color-4/#ok-lab)
   and [WCAG contrast minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).
7. **Reduced motion is not universally proven upstream.** Detailed source reading
   found exceptions needing Zero review, including chat unread-label blur and
   counter first-view arming. Keep actual content immediately available; disable
   travel/blur/parallax/loops as appropriate, suspend off-screen work and fence
   stale completions. A fallback reveal must not delay important information.
8. **Action truth must remain correct.** Standalone Hold marks done before its
   synchronous callback, while inline Confirm supports async states. Inline
   destructive autofocus can select Confirm, unlike Zero's Cancel-first policy.
   Borrow appearance, not weaker acknowledgment or destructive-action admission.
9. **Overflow policies vary upstream.** ScrollArea hides native bars; chat uses thin
   native bars and stable gutter; desktop sortable tables use horizontal auto.
   Arc ScrollArea is now the approved Zero shared treatment; adapt actual viewports
   instead of importing each demo's different policy. Keep table horizontal bars
   off by default. Animation must not create transient overflow, blank placeholder
   rows or a fake pagination progress percentage.
10. **Keep approved motion contracts.** Modal origin → Rise fallback, reverse exit,
    dim+6px blur, receding page and duration multiplier1.5 remain authoritative
    (975ms origin, 900ms Rise). Keep the smaller14px X glyph separate from its
    target. Tooltip Grow400ms/arrow-on and chart inspector10px/9×12px/17px-value/
    120ms-feedback/arrow-off remain distinct, related presentations. Arc's Dialog
    and Tooltip defaults do not silently supersede them.
11. **Category identity is not theme decoration.** Arc derives series from accent
    via relative OKLCH with fallbacks. Preserve Zero's named chart categories and
    stable data identity. Trusted application CSS may derive tokens; this is not
    authority to widen the resource-free public chart-color admission grammar.

These proposed mappings build on [current Zero tokens](../frontend/design-system/tokens.md),
[actual global styles](../../src/frontend/styles/globals.css),
[modal tokens](../../src/frontend/styles/modal-tokens.css),
[tooltip tokens](../../src/frontend/styles/tooltip-tokens.css), and
[unified chart tokens](../../src/components/charts/chart-tokens.css).
No new API or completed compatibility check is implied.

## Ordered Theme and Component Work

1. Keep this pinned upstream evidence beside the other reference ledgers. The
   magnetic, compact-dashboard, Morph Select and Arc ScrollArea requirements are
   approved; select other additional variants before porting their implementation.
2. Choose the shared light/dark neutral direction, display/body/technical roles,
   readable content pairs, subtle borders, elevations and density families. Give
   each mapped token one semantic owner; keep compatibility aliases explicit.
3. Map the effect vocabulary onto existing Zero primitives: shared highlight,
   measured resize, state-text handoff, selected-control movement and optional
   numeric/work-status effects. Specify interruption, reduced-motion, SSR,
   keyboard/touch, lifecycle and property ownership before making any default.
4. Qualify the foundation on representative AppShell/sidebar, form/DenseList,
   DataTable, modal, tooltip/popover, chart/vector, chat and public-page compositions.
   Check narrow/zoom/long content, actual overflow and contrast for every active state.
5. Port selected components as smaller compositions plus an organism under Zero's
   existing facades and service boundaries. Resolve incidental source differences
   into shared roles; retain genuinely meaningful geometry and behavior locally.
6. Add reliable migration diagnostics, token/override compatibility guidance,
   packaged/source-copy checks and polished docs before changing app-wide defaults.

Arc's visual direction and the picker/overflow requirements above are selected.
Exact global values, compatible facade additions and other default-effect
promotions remain pending this qualification sequence. This audit changes
documentation and evidence only; no runtime theme/component was replaced.
