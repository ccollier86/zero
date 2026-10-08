---
id: zero.audit.calendar-field-editors
type: operations
audience: [agent, maintainer]
owner: frontend-components
status: verified
visibility: internal
---

# Shared Calendar And Studio Field Editors

[Audit index](./index.md) · [Documentation index](../../index.md)

## Scope And Baseline

Framework 2.6.0, committed main
`ec65204aaf9392dbc2db87a0edc021231b2801a7`, October 7, 2026.
The prior DataTable/auth release is already merged, pushed and selected as the
saved main package. This follow-up is separate work on
`feature/calendar-field-editors`; it must not delay that existing update.

The user requested shared Calendar, DatePicker and TimePicker modernization,
functional month/year drill-down, corrected navigation/dismissal, anchored
validated JSON-cell editing, compact Studio dialogs and icon-first management
actions. Reference interaction is the user-supplied HTML picker, informed by
Arc's public calendar/date/time examples. Visual styling remains Zero's tokens;
no global theme redesign, persistence contract or live application change is in
scope. Use existing Zero controls, popovers, JSON editor and mutation controller.

## Reproduced Baseline

- Calendar already delegates selection, modifiers, bounds, range/multiple mode,
  locale and controlled month to `react-day-picker`; Studio already composes
  Zero DatePicker/TimePicker. A parallel app-only calendar is not the correction.
- Default Calendar caption has no clickable month/year view picker.
- Calendar's absolutely positioned arrow buttons have no correct containing
  header. In an isolated Chromium fixture, a third calendar starts at 678.375px
  while its Next button appears at page y=0. The focused pre-fix gate fails both
  drill-down and navigation geometry tests; receipt `calendar-before.log`.
- Baseline JSON cells enter a native single-line editor and blur-save. The
  shared JsonEditor already provides structured editing, retained raw JSON,
  validation and local commit; Studio should compose it rather than invent it.
- Shared RecordNavigationBar already declares `actionLabelMode='expand'` and
  both management workspaces inherit it. Verify actual disclosure before
  assuming its public default must change; do not fabricate a defect or add
  caller-specific CSS overrides.

## Implementation Boundaries

1. Preserve DayPicker's existing selection/policy engine and public callers.
   Customize shared presentation with accessible days/months/years views,
   correctly positioned header navigation, bounds, focus and keyboard behavior.
2. Share theme-resolved picker motion: 160ms fast, 580ms supplied spring and
   the supplied standard/spring curves. CSS and WAAPI resolve the active theme;
   reduced motion removes perceptible timing. Do not copy reference colors,
   fonts, radii or global CSS resets.
3. Retain DatePicker typed/invalid controlled buffers. Add reliable nested
   popover dismissal and optional trigger/value presentation. Modernize
   TimePicker without changing its canonical `HH:mm` transport value.
4. Date/JSON cell popovers edit a local draft. Explicit Apply validates and
   awaits the captured revision-aware writer; pending operations prevent
   duplicate/dismissal. JSON validation cannot discard unfinished text.
5. Preserve organization retirement, expected revisions, acknowledged mutation
   results, conflict reconciliation and content-free error/observability paths.
6. Inspect management-button rest/hover/focus/touch behavior at its shared owner.
   Compact layouts must not overflow the page or move the anchored bar.

## Verification And Handoff

Only changed UI interactions need focused browser tests; unrelated auth/whole
platform browser suites are not repeated. The in-app browser connection failed
before execution, so the repository's existing Bun/isolated Chromium harness
provides targeted evidence. Synthetic fixtures never use live Pantheon cookies,
users, files or databases.

Committed implementation: `b003d5b8f738a17d4f0d84bf2643eed615b2c543`.
The separate clean detached checkout and freshly installed archive consumer
exclude unrelated working documentation drafts. This is the source/local
2.6.0 channel, not a public npm publication or a live Pantheon deployment.

Closing review additionally caught and fixed these concrete integration gaps:

- DayPicker `navLayout="after"` and custom MonthCaption lost their arrows when
  the default embedded header was not present. Native Nav is retained for those
  extension points; after/around/custom caption/label controls are exercised.
- The DatePicker footer could fall below a 360×320 viewport. The whole popup is
  height-bounded with an anchored footer and exactly one scrolling owner per
  active view; the year list receives the actual available viewport height.
- TimePicker's first virtual-list scroll ran before its deferred Radix portal
  mounted. The selected accessibility-pinned row masked missing neighboring
  minutes. The real mounted scroll owner now drives initial positioning; all
  four exposed Studio integration regressions pass after the source correction.
- JSON text Escape could discard the buffer before the outer dirty-close
  decision. The shell now owns that decision; invalid text stays intact.
- Selected Today colors collided in dark mode. Existing DayPicker attributes
  and Zero semantic tokens now keep selected text readable through hover.
- Native dropdown captions use downward carets, not right navigation arrows.

Verification receipts under `/Volumes/code-bank/logs/zero-platform`:

- `calendar-field-editors-committed-pure.log`: 59 tests, 255 assertions,
  zero failures across ten focused value/SSR/composition files.
- `calendar-field-editors-committed-typecheck.log`: full TypeScript check exits 0.
- `calendar-field-editors-committed-browser.log`: 60 of 61 changed-UI cases pass;
  one schema-retirement case exceeds its runner timeout without an assertion
  failure. Its isolated clean-commit rerun passes all three assertions in
  `calendar-field-editors-committed-schema-retirement.log`. The timeout receipt
  is retained, not rewritten as an all-green aggregate run.
- `calendar-field-editors-package-clean.log`: installed archive consumer passes
  all 15 assertions, six public export identities, ten required runtime modules,
  browser build and SSR without DOM globals or native date/time fields.
- `calendar-field-editors-doc-examples.log`: actual public Markdown UI examples
  compile, including both date/time examples; 80 assertions.
- `calendar-visual-compatibility-qualified.log`: focused Calendar compatibility
  and light/dark visual checks pass. Screenshots also cover compact JSON cells,
  create-record dialogs and both real action-bar callers at mobile/desktop sizes.

Documentation graph admission reports 736 unique/reachable pages with no
problems in the working checkout (including one unrelated unpublished draft).
Catalog placement reports 997 records across 166 canonical homes without
problems. The final committed main check excludes that unrelated draft.

Clean implementation archive receipt:
`/Volumes/code-bank/artifacts/zero-platform/diagnostics/studio-storage-package-VuE7S7/provenance.json`;
SHA-256 `b2998677063427a4f3ee0b825030ed1a3f8de239c6936e483f3142f6a749ba28`.
Final main's saved archive additionally includes the updated docs and therefore
has its own checksum; use `zero-release --status` for the selected update.

Public additions are optional picker presentation/open-state controls,
Calendar drill-down settings and JsonEditor `density="compact"`. Existing typed
date buffers, DayPicker selection policy, `HH:mm` storage, permission/scope
fences, captured revisions and acknowledged mutation contracts remain intact.
Operational action bars already use shared icon-first disclosure by default;
no fabricated default change or consuming-app override was introduced.

## Canonical Documentation

- [Date/calendar/time primitives](../../frontend/components/primitives/dates-and-time.md).
- [Studio inline cells](../../frontend/data-studio/inline-cell.md).
- [Studio dialogs](../../frontend/data-studio/dialogs.md).
- [List/detail and action bars](../../frontend/components/primitives/list-detail.md).
- [JsonEditor](../../frontend/components/json-editor.md).
