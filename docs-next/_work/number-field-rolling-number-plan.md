---
id: zero.number-field-rolling-number-plan
type: roadmap
audience: [developer, agent, maintainer]
owner: frontend-components
status: draft
visibility: internal
system: frontend-components
feature: numeric-controls
maturity: planned
applies_to: ["2.6.0 working source; existing table digit presentation; proposed numeric control and reusable display"]
modes: [browser, SSR, light, dark, package-imports, source-copy]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "335b27372b0b8ef57a1e92cf93cec378923fe50b"
  snapshot: dirty
  date: "2026-10-10"
  evidence_level: source-observed
---

# NumberField and RollingNumber Plan

[Working evidence](./index.md) · [Component organization](./frontend-component-organization-plan.md) · [Typography plan](./typography-system-plan.md) · [Theme evolution](./design-token-theme-evolution-plan.md)

Add an Arc-inspired numeric field and a reusable display that animates only
changed digit positions. Keep the existing DataTable digit presentation and
acknowledged edit lifecycle intact. NumberField, RollingNumber, their new public
routes and table configuration described below are proposed, not implemented.
The current phase is documentation and organization only. The earlier feature
request remains captured below; this phase does not implement numeric controls.

The reusable display is presentation only. It must work for application totals,
table counts, chart readouts and other changing numbers without installing a
provider, subscribing to a database, interpolating a fictional count or submitting
a mutation. Its caller supplies the actual number and owns data authorization,
freshness, completeness and accessible context.

## Existing Numeric Owners

The current [table roller](../../src/components/data-table/data-table-rolling-number.tsx)
exports `DataTableRollingNumber`, its props and the imperative
`updateDataTableRollingNumber` helper. It renders grouped `en-US` characters,
retains unchanged visual slots, animates changed characters, captures the incoming
digit's current pose when interrupted and retires callbacks using a generation
counter. Its first render is still, its visual span is `aria-hidden`, and the
caller supplies the accessible sentence.

The roller and [motion constants](../../src/components/data-table/data-table-motion-tokens.ts)
retain 75% vertical travel, 350ms outgoing motion, 525ms incoming motion, 30ms carry
stagger from the right and `cubic-bezier(.2, 0, 0, 1)`. Roller clipping and tabular
numerals belong to [the table skin](../../src/components/data-table/data-table-motion.css).
The [pager](../../src/components/data-table/data-table-pagination.tsx) and
[new-record indicator](../../src/components/data-table/data-table-new-records-button.tsx)
consume this roller. Changing the digit renderer must not change count authority,
page progress, incoming-record eligibility or those controls' semantics.

The current [numeric editor](../../src/components/data-table/editable-cell-editor.tsx)
uses Input with `type="number"`; nonempty input becomes a number. An optional
empty field becomes wire `null`, while a required empty field remains `''` for
rejection. Min/max come from FieldMeta. Enter, Tab and blur request a save;
Escape cancels when no save is pending. The
[cell lifecycle](../../src/components/data-table/use-editable-cell-save.ts)
closes or advances only after its writer and configured refresh succeed, retains
the exact failed request for Retry and deduplicates an active attempt.

Write and refresh failures are distinct. The
[mutation controller](../../src/components/data-table/data-table-mutation-controller.ts)
distinguishes a rejected write from an accepted write followed by refresh failure.
The cell lifecycle retains the editor after either failure. Once the write is
accepted, a subsequent refresh failure does not undo that write; Retry runs the
refresh without submitting the mutation again. The
[hook's safe error copy](../../src/components/data-table/use-data-table-mutation.ts)
reports that the change was saved. Visible reconciliation can remain stale until
refresh succeeds; the numeric adapter must not promise rollback.

[FieldMeta and the number builder](../../src/schema/field-types.ts) expose min,
max and required state. The builder can validate integers, but FieldMeta currently
has no step, largeStep, integer, locale or display-format field. A UI step cannot
establish a server integer rule. Optional empty, required rejection and pending
receipt behavior already have
[numeric browser coverage](../../src/components/data-table/editable-cell-numeric.browser.test.ts).

## Arc Reference Contract

### API and Keyboard Reference

The [Arc Markdown API](https://uiarc.dev/components/number-field/markdown)
defines the following field contract.

| API group | Reference contract |
| --- | --- |
| Value | Required string `label`; `value`, `defaultValue=0`, `onValueChange`. |
| Bounds and stepping | `min=0`, `max=Number.MAX_SAFE_INTEGER`, `step=1`, `largeStep=step*10`. |
| Copy and state | `description`, `disabled`, `id`; `prefix`/`suffix` strings or functions; `limitHint=true` or a copy function. |
| Formatting | `locale="en-US"`; fraction digits and grouping in `formatOptions`; step precision supplies default fractions. |
| Presentation | `size` is `sm`, `md` or `lg`, default md; `scrub=false`. |

Arrow keys step; Shift/Page keys take larger steps. Enter commits/selects, and
Escape restores the edit start. Home/End target bounds outside draft editing.
Spinbutton attributes and polite announcements convey values and limits;
rolling visuals are hidden from assistive technology.

### Registry Interaction and Geometry

The [registry source](https://uiarc.dev/r/number-field.json) contains 478 TSX lines
and 72 CSS lines, depending on `motion` and `lucide-react`. Place-keyed Latin
digit wheels wrap with the change direction; large jumps take a shorter route.
Affixes/helper copy and measured widths/heights morph. Reduced motion removes
travel; limits use strain, shake and warning copy.

Calibrations: successful hold delay 400ms; repeats
`max(40,150*.86^count)`ms; refused first/repeat 360/240ms; scrub 6px/step;
limit hint 1500ms; under-minimum warning 700ms. Source End handling requires
max below `Number.MAX_SAFE_INTEGER`.

Geometry: widths 164/196/228px; steppers 28/34/40px; vertical wheel feather .2em.
The CSS suppresses outlines. The API lacks nullable values, native name/ref and
readOnly; drafts strip characters then snap/clamp, and step precision splits
the decimal string.

Observed 2026-10-10: TSX SHA-256
`ad4bba584f4626939c76e61d04eac1d20c2d33b46425df6406414a94a38237c2`;
CSS SHA-256
`3898aa73a014b3f7aee2a7d0f99999ceaa95e789e8a299bcc5eaa0323f03702a`.
The CSS matches [the existing inventory](./arc-design-token-inventory.json);
its older TSX identity remains separate.

### Shared Motion Reference

The [Arc motion dependency](https://uiarc.dev/r/arc-motion-tokens.json)
sets snappy 260ms/.12 bounce, smooth 400ms/zero bounce and morph 420ms/.16 bounce.
Its duration roles are instant/fast/exit/standard/considered =
120/160/180/240/480ms. Enter easing is `[.16,1,.3,1]`; standard is
`[.22,1,.36,1]`. These source calibrations inform proposed Zero roles, not
interaction deadlines or replacements for the established table timings.

### Zero Adaptation Boundaries

Zero's proposed contract must preserve malformed/empty drafts and finite-value
validation, including exponent-sized steps. Optional clear cannot become zero or
the last value. Retain visible keyboard focus, native refs/forms, active theme
inheritance and caller overrides. A visual clamp cannot establish schema
acceptance, and a locally valid edit cannot acknowledge a server write.

## Proposed Component Ownership

| Responsibility | Proposed canonical owner | Boundary |
| --- | --- | --- |
| NumberField organism | `src/components/controls/number-field/number-field.tsx` and curated `index.ts` | Numeric input, stepping, draft and interaction state. |
| Numeric admission and stepping | `src/components/controls/number-field/number-field-model.ts` | Pure finite-value, bound, precision, parse and step rules. |
| Numeric field skin | `src/components/controls/number-field/number-field.css` | Scoped semantic tokens and reference geometry, not a new theme. |
| Reusable number display | `src/components/typography/rolling-number.tsx` | Changed-slot rendering, interruption and visual lifecycle only. |
| Place-value model and skin | `rolling-number-model.ts` and `rolling-number.css` in the same typography owner | Pure formatted-part identity and shared visual slots. |
| DataTable adapter | Existing table roller/editor/helper owners | Table recipe, schema projection and accepted-write integration. |

Keep `DataTableRollingNumber`, `DataTableRollingNumberProps` and
`updateDataTableRollingNumber` compatible at their current path, including slots,
class names, accessible ownership and timing. The existing implementation should
become a table recipe of one canonical display engine, not coexist with an
independently maintained duplicate. If a public identity alias is adopted, old
and canonical exports must resolve the same function; otherwise preserve an
explicit adapter's existing signature and verify its behavior.

## Proposed NumberField API Obligations

Preserve the reference's core stepping, size, affix, formatting, description,
scrub and limit-copy capabilities. Add native input ref/attributes, form name,
readOnly and clear semantics deliberately. A compact table appearance must not
require adding an oversized visible label to every cell; its accessible name
still comes from a real label or explicit ARIA input name.

Separate a committed `number|null` from the editable text draft. Provide controlled
and uncontrolled values, plus a controlled draft/callback contract where the table
needs to retain empty, incomplete or invalid text. Determine controlledness from
prop presence rather than truthiness: zero and null are meaningful values. Draft
editing must not remove the input, move its ref, reset its caret or create a
second submitted field.

Pure model rules must cover finite values, ordered finite bounds, positive finite
steps and large steps, decimal precision including exponential notation, and
explicit behavior for off-step inputs. Keep empty, incomplete, malformed,
nonfinite and valid numeric results distinct. Locale grouping/decimal separators
must be parsed deliberately; do not strip arbitrary text until it looks numeric.
Support negative values only under the declared bound policy, not by accidental
coercion. Avoid floating-point drift during repeated fractional steps.

For the standalone field, document whether Enter/blur snaps or clamps a valid
out-of-range draft. For the table adapter, preserve the schema/write policy:
do not silently clamp a typed value into an accepted value, turn malformed input
into `null`, or treat a locally valid step as a successful mutation. Presentation
validation and a request to change the value are not server acceptance.

Compose keyboard handlers with the host editor. IME composition must not trigger
save/step/cancel. The table owns Enter, Tab, Escape and accepted advancement; the
field owns applicable arrow/Page stepping. ReadOnly remains form-submittable but
cannot type, step or scrub; disabled controls cannot edit or submit. Stop hold
timers and release capture on release, cancellation, lost capture, blur,
disable/readOnly transitions and unmount. Prevent a pointer hold from also
producing a duplicate click step.

Proposed table-helper options may expose step/largeStep, affixes, locale/format,
scrubbing, size and numeric display configuration without replacing caller cell
renderers. Thread admitted options through `DataTableColumnOverride`, column meta,
the native grid row and EditableCell to the numeric editor. Decide separately
whether schema metadata needs extending; display formatting never changes the
stored number or grants permission to write it.

## Digit Position Contract

Key integer digits by distance from the decimal boundary, fractional digits by
their fractional place, and signs/separators/affixes by their semantic role.
Unchanged digits retain their DOM slot and resting glyph; they must not restart
because the whole number changed. Column insertion/removal may use one explicit
width/layout treatment, but it must not masquerade as a digit change.

| Change | Required digit behavior |
| --- | --- |
| `407 → 408` | Only the units digit changes; hundreds and tens stay still. |
| `409 → 410` | Tens and units change; the hundreds digit stays still. |
| `499 → 500` | All three digits change. |
| `408 → 407`, `410 → 409`, `500 → 499` | Same changed places with decreasing direction. |
| `9 → 10`, `99 → 100`, `999 → 1,000` | Retain lower-place identities; insert only new higher-place/separator slots. |
| `1,000 → 999`, `100 → 99`, `10 → 9` | Remove obsolete higher-place/separator slots without rekeying lower places. |
| `12.39 → 12.40`, `1.9 → 2`, `2 → 2.01` | Distinguish integer and fraction places; changed precision cannot repurpose a fraction slot as units. |
| Negative values and crossing zero | Give the sign its own identity; define negative-zero formatting and visual direction explicitly. |
| Locale, grouping, currency and percent formatting | Derive place identities from formatted parts; validate digit glyph mapping instead of assuming every locale uses ASCII digits. |

Format the supplied value rather than animating an invented intermediate business
value. Larger jumps may change several digits, but unchanged places still remain
still. A format/locale change may rebuild affected semantic slots without animating
unchanged numeric places unnecessarily. Provide an explicit motion-off option;
reduced motion and first hydration show the correct final number without travel.

During rapid updates, continue from the currently visible pose, cancel only this
display's own animations and invalidate superseded completion callbacks. Removed
slots must finish or cancel cleanly; no duplicate glyphs, stale values, NaN
transforms, timers or observers may survive unmount. A missing browser animation
API falls back to ordinary correct text.

The generic display should expose one accessible value by default, with hidden
visual slots. Table compositions retain their existing complete sentence and
hidden numeric paint. Live announcements are opt-in and rate-appropriate; a
rapid ticker must not flood assistive technology. Fractions, affixes and separators
must remain understandable without hover or color.

## Token and Motion Integration

Map the field's paint and geometry onto existing Zero semantic and typography
families. Use the reference calibrations above as overridable component roles,
not fixed application density. Keep readouts tabular and inputs legible.
Resolve adopted width, helper-height and digit-motion roles through the active
theme and scoped overrides. Preserve the accepted table recipe; reduced-motion
preferences must not change validation or event order.

Keep motion and typography controls independent of query/transport options.
No global shortcut, global animation manager, automatic database subscription,
font download or alternate backend service belongs to either new numeric component.

## Qualification and Migration Gates

Use the following gates when the numeric implementation phase resumes.

1. Define pure parse/step and place-value models. Test zero/null/empty/incomplete,
   invalid/nonfinite input, signs, negative zero, fractional/exponent steps,
   bounds, off-grid values, grouping, locales and configuration changes. Include
   every digit transition above and stable unchanged-slot identity.
2. Implement one reusable display and preserve the table recipe. Qualify still
   SSR/hydration, rapid increase/decrease and interruption, first render, reduced
   motion, disabled motion, missing WAAPI and cleanup. Retain
   [existing footer SSR tests](../../src/components/data-table/data-table-footer-motion.test.tsx)
   and [exact animation browser contracts](../../src/components/data-table/data-table-footer-motion.browser.test.ts).
3. Compose the field with a real native input. Browser tests cover controlled
   parent acceptance/rejection, uncontrolled defaults, raw drafts, caret/ref
   stability, forms/reset, disabled/readOnly, keyboard/IME, pointer and keyboard
   holds, cancellation, scrubbing, bounds, focus visibility and announcements.
4. Add the table adapter without replacing mutation ownership. Retain optional
   wire null, required-clear rejection and pending receipts; add valid decimal,
   invalid draft, min/max, failure/Retry, refresh failure, Tab advancement,
   cancellation and boundary retirement cases. A rejected write leaves the editor
   open without emitting acceptance or locally replacing the canonical value.
   An accepted write followed by refresh failure keeps the editor mounted and
   preserves the accepted change; Retry refreshes only, without resubmitting.
   Qualify eventual visible reconciliation, not a rollback promise.
5. Qualify compact/mobile/light/dark layouts and scoped token changes. Long
   affixes, extra places and active animation must not introduce a temporary
   horizontal scrollbar or overlap table neighbors. Large tables use only
   active edit fields; read displays do not create field observers per cell.
6. Admit bounded source-copy closures and public routes. Proposed routes are
   `@zero/framework/components/number-field` and the existing typography family
   entry for RollingNumber; add only agreed root/React exports. Retain old table
   helper/CSS destinations, exact public types, native refs and single-engine
   identity. Default copy skips customized old files. Test direct requests,
   transitive copies, a fresh installed-package consumer and a fresh browser
   consumer; no directory/test-fixture sweep.
7. Publish canonical field/display documentation, full table examples, helper
   configuration, native-form and accessible-display examples. Update discovery,
   source ownership, token/motion inventories and compatibility records. Mark
   runtime capabilities implemented only after their corresponding gates pass.
8. Extend Doctor only where static target evidence warrants it. Missing admitted
   exports/assets are required findings; adopting the new numeric control is a
   recommendation, and customized copied editors require manual review. Do not
   flag every native numeric input as broken, evaluate app configuration, rewrite
   parse policies or overwrite custom source. Add detector/catalog regressions
   before advertising numeric-specific upgrade guidance.

The current [Doctor catalog](../../src/doctor/source-only-upgrade-catalog.ts)
and [capability types](../../src/doctor/source-only-upgrade-types.ts) do not yet
declare numeric-specific upgrade capabilities. Existing named-export and
relative-asset checks remain the implemented safety boundary. Archive, package,
browser, source-copy and documentation checks must record their actual results;
this roadmap does not satisfy those future gates.
