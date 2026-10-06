---
id: zero.documentation.data-studio-ui-review
type: operations
audience: [agent, maintainer]
owner: data-studio
status: in-review
visibility: internal
---

# Data Studio Grid And Controller Follow-Up

[Audit index](./index.md) · [Documentation index](../../index.md)

This records the original 2.1.1 grid review and the subsequent 2.2.1 record and
Storage inspector follow-up. Evidence is scoped to the named components and
contracts; it is not a broad platform security or deployment qualification.
No app, live database, provider or deployment was changed. The follow-up updates
both existing documentation and the isolated new guides.

## Record And Storage Inspector Follow-Up (2026-10-05)

The subsequent record-editor branch uses the dirty 2.2.1 development baseline
`95ba0578f6625fc4597a9ec6786ee1d3353f29cd`. This follow-up deliberately updates
both current docs and the isolated draft guides; it does not retarget the new
documentation tree as the public reference or claim an installed release.

The create-record view now composes existing Zero dialog/field/calendar/time
controls, with a bounded body and pinned heading/footer. Stable-ID raw drafts
distinguish untouched defaults, explicit false/zero/empty/null, required input
and typed validation. Schema replacement requires explicit reload; scope/table
lifetimes retire late outcomes. Creation reserves one writer, awaits acceptance,
and retains exact inputs for ambiguous SDK retries. Accepted persistence cannot
be made resubmittable by a failed close notification. Safe centralized failure
events never reflect raw callback messages or submitted values.

Shared temporal editors replace native date/datetime inputs in record creation,
schema defaults, Studio filters and anchored cell editors. The generic table's
date filter retains its existing calendar-date query contract. Cell popup
calendar/time interactions are drafts, not blur-based mutation triggers; keyboard
selection and popup clicks do not dispatch surrounding-row actions. Ordinary
text/numeric/JSON cell behavior remains unchanged.

Drive/object access forms adapt to their pane width. Grant rows use compact,
bounded, keyboard-focusable lists. Public visibility is explicitly explained
when disabled by policy, and private remediation remains available. Source
review distinguishes public-drive inheritance from **exact-object** publication;
ancestor ACL grants do not imply that a public folder publishes its children.

Focused synthetic checks actually run:

| Area | Result |
| --- | --- |
| Record dialog + settings/visibility browsers | 20 tests / 112 assertions |
| Storage Access + inline cell browser + Studio SSR | 18 tests / 111 assertions |
| Final Storage Access + deferred panel lifecycle browser | 6 tests / 55 assertions |
| Public UI/configuration Markdown examples | 1 test / 48 assertions |
| Storage/service Markdown (51 actual TS/TSX fences) | 1 test / 2 assertions |
| Documentation navigation/metadata | 696 pages, 0 problems |
| Final combined frozen-source browser/SSR gate (5 scoped files) | 40 pass / 1 animation-sampling failure; 227 assertions |
| Corrected animation-settling visual/geometry gate | 2 pass / 34 assertions; 15 unrelated cases filtered out |

The final combined run sampled the still-converging dialog spring while
comparing anchored header coordinates: it moved 0.145px before the second
measurement. The test now waits for computed opacity/filter/transform and
stable geometry over animation frames before measuring. Containment and
coordinate assertions were not loosened and no production style/source was
changed for this correction. The isolated visual/geometry rerun passed for
light/dark desktop/mobile and the long form. Other frozen-source behavior,
failure and lifecycle cases passed in the combined run. Counts overlap; they
must not be summed as a unique test total. Deferred permission lifecycle browser
checks exercise the **actual drive panel** and shared ticket mechanism; object
composite target/revoke behavior was source-validated and covered separately by
shared mechanism/SSR checks, not claimed as a dedicated object-panel browser run.

These checks use real production components, CSS, deferred synthetic callbacks
and the existing leased Chromium harness. The official in-app browser bootstrap
was attempted but failed before connection because its runtime lacked
`sandboxPolicy`; no live app/browser session was substituted. Fresh Bun build
processes avoid the known in-test resolver-cache issue. All generated build
and sanitized visual evidence remain in designated external scratch/artifact
locations, outside source. Narrow Access evidence uses an approximately 399px
desktop inspector and computed animation settling. Record evidence includes
both themes at desktop/mobile sizes plus long-form independent body scrolling.

The canonical [dialog](../../frontend/data-studio/dialogs.md),
[typed values](../../frontend/data-studio/values.md),
[inline cells](../../frontend/data-studio/inline-cell.md),
[date primitives](../../frontend/components/primitives/dates-and-time.md),
[drive grants](../../frontend/storage/storage-drive-permissions-panel.md),
[object grants](../../frontend/storage/storage-object-permissions-panel.md),
[Studio inspector](../../frontend/storage/storage-studio-inspector.md) and
[public-read policy](../../backend/storage/public-access.md) now describe these
observed contracts. Final compiler/package/release gates remain root-owned.

### Final Root-Owned Qualification

After the test-only animation wait correction, the consolidated five-file
browser/SSR rerun passed **41 tests / 255 assertions**, with zero failures.
This supersedes the earlier combined sampling failure; it does not erase that
earlier observation or relax the layout assertions. Full `bun run typecheck`
also passed against the frozen production source.
The final related unit/integration gate passed **145 tests / 661 assertions**
across 17 scoped files. Counts overlap with the separately reported SSR/browser
gate and are not a combined unique test total.

A newly packed archive was installed in a separate public package consumer.
That gate passed **1 test / 15 assertions**, covering root/React/subpath export
identity, included runtime modules, browser bundling, DOM-free SSR, public
timezone-bearing datetime parsing and valid empty-grid spans. The exact
development archive SHA-256 is
`cfd8f250a1c2e3774aea6f4104c41543079df178f2aa7ac1e0fc4ecae6b34568`;
its provenance records base commit `95ba0578f6625fc4597a9ec6786ee1d3353f29cd`
plus working-tree changes. It is a qualification artifact, not a published
release. The package check exposed an optional schema-action boolean producing
an invalid empty-grid span; that was corrected and covered by an SSR regression.

Public-download route regressions use disposable in-memory storage and verify
actual anonymous file bytes for a public drive and a published file in a private
drive, rejection of a private neighbor and anonymous deletion, and rejection
after publication is removed. Production storage authorization rules were not
changed to obtain these results.

## Original 2.1.1 Grid Review

The remaining sections describe the original development worktree based on
`a3a5f726768dac890f241a3899c0a1acb66265d9`. Statements about its outstanding
qualification and unchanged current docs are historical, not the status of the
2.2.1 follow-up above.

## Implemented Composition

The grid uses existing Zero Table, Popover, DropdownMenu, AlertDialog, Button,
inline-cell and shared column-editor components. A small additive
`TableProps.containerClassName` preserves default wrapper behavior while allowing
the Studio's one bounded ancestor to own scrolling. TanStack Table owns sizing
and mouse/touch handlers; TanStack Virtual owns visible ranges. There is no
replacement component system or hand-written drag lifecycle.

Schema headings remain visible without records. Header editing/menu/resize
modules stay separate from virtualization and sizing hooks. Record-write and
schema-management flags are independent. Editing/move/remove retain the captured
schema revision; deliberate field-key rename requires explicit acknowledgement
while label/reorder preserve the key and stable column ID. Removing the final
column is subject to the backend, not an invented UI restriction.

Query changes retire editors/focus without discarding same-table widths.
Progressive loading has single-flight pending UI, bounded retries, refresh-needed
feedback and a truthful exhausted result state. Mobile inspection intent is
separate from selecting a cell, so a writable cell does not hide its editor.

## Focused Corrections And Evidence

- The initial externally split TanStack sizing/sizing-info state lost a single
  touch update. The touch regression failed; TanStack's shared state queue
  corrected it. Mouse, touch and keyboard bounds now pass.
- Menu exit autofocus could interfere with reopening or focused editing.
  Reopening waits for exit; edit/remove intent transfers only after close
  autofocus, retaining its captured callback/revision.
- Inline-cell synchronous admission and mounted/save-generation guards prevent
  same-tick duplicate commits or late unmounted presentation/navigation. These
  source-observed risks received synthetic acceptance coverage; no pre-change
  failing run is claimed for that older cell implementation.
- Replacing a progressive SDK surface while scope/query strings matched retained
  the previous source's rows: the new regression failed. A memoized opaque
  presentation-only source identity now retires that window. It is not sent as
  authority, a database selector or a receipt. Continuous drift stops after two
  reconstruction attempts without publishing a mixed prefix.

Checks actually run using Bun1.3.14, with automatic env-file loading disabled:

| Focused command/area | Result |
| --- | --- |
| Grid browser + existing cell browser + Studio SSR, before final short-screen case | 23tests/112assertions |
| Final grid browser, including short popup, field-key copy and empty schema | 11tests/47assertions |
| Progressive hook/window | 14tests/48assertions |
| Actual ClientProvider/controller/SDK parsing-cache with synthetic readiness and in-memory transport | 4tests/19assertions |
| Combined selective controller/progressive/window independent rerun | 18tests/67assertions |
| Shared layout independent six-suite review/rerun | 32tests/168assertions |
| Additional animated Tabs content/fill transition independent rerun | 1test/7assertions |

Counts overlap and must not be added as a unique suite count. Browser fixtures
compile actual components and platform CSS, use only synthetic records and
disposable outputs, and never open Pantheon. Controller integration uses real
SDK parsing/cache and React composition but synthetic authentication readiness;
it does not certify Guardian credential verification. Final global compilation
and whole-workspace review are root-owned gates.

## Documentation And Remaining Qualification

The canonical [grid](../../frontend/data-studio/grid.md),
[inline-cell](../../frontend/data-studio/inline-cell.md),
[Studio index](../../frontend/data-studio/index.md) and
[semantic Table](../../frontend/components/primitives/tables-and-pagination.md)
references reflect the additive contracts. Current docs and package/site entry
points remain unchanged. Installed-artifact imports, release/package docs,
explicit public projection and deployment testing remain separate gates.
