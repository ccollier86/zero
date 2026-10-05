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

This records the scoped UI implementation and focused review after the
documentation walkthrough. It describes the dirty2.1.1 development worktree
based on `a3a5f726768dac890f241a3899c0a1acb66265d9`, not a committed/installed
artifact or broad security qualification. No app, live database, provider,
deployment or existing documentation was changed by this stream.

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
