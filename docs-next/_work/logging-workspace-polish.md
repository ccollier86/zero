---
id: zero.work.logging-workspace-polish
type: roadmap
audience: [developer, agent, maintainer]
owner: observability
status: in-review
visibility: internal
system: logging
feature: investigation-ui
maturity: experimental
applies_to: ["feature/logging-workspace-polish; not yet a selected stable update"]
---

# Logging investigation UI repair

[Working index](./index.md) · [Supported component](../frontend/components/logging.md) · [Logging foundation](./logging-foundation-review.md)

## Scope and ownership

Keep the existing private Fabric logging system, current-scope Guardian checks,
cursor query source, genuine batched INSERTs, native incoming-record control and
strict delivery admission. Improve the investigation interface, not an unrelated
metrics dashboard. Do not add a second table, body search, fake totals, replay
the initial-load animation, or label a connected stream as verified compliance.

The prior interface had a flat raw-code table, buried exact filters, a legacy
modal with no visible managed header, and undifferentiated metadata. Its live
DataTable foundation was functional and must remain so.

## Implementation

- Shared magnetic Audit activity / Diagnostics tabs, real connection state,
  compact header and safe actionable query errors.
- Closed AND filter composer over native Morph Select/Popover/ScrollArea,
  actor/session/resource/code/severity/source-time constraints, applied chips,
  local validation and visible pinned-window/identity restrictions. No invented
  full-text or nested-OR query support.
- Friendly activity labels with exact original codes in detail; semantic
  outcome badges, explicit evidence certainty and independent source/ingest time.
- Modern `modals.show`, a real inspection trigger, keyboard-native row
  interaction, scope-masked detail and grouped provenance/allowed metadata.
- Readable minimum table geometry inside horizontal ScrollArea; never make the
  document wider to fit desktop columns. No global theme/CSS imports changed.
- Original import paths and public props retained. Export request identities,
  private downloads and bounded-segment warnings retained; unmounted owners may
  no longer finish a stale browser download.

## Qualification

The before/after Chromium fixtures use synthetic IDs and block external network.
The initial three-file run passed presentation, native-source and four actual
browser scenarios, including retained node identity, initial-load non-replay,
older-page incoming-record reveal, filtered live arrivals, scope masking,
stream-failure masking/recovery, invalid query rejection and stream switching.
The final three-file qualification passes 10 tests / 53 assertions, including
five Chromium scenarios. The final pass checks aligned nonzero-width mobile columns, reduced-motion
keyboard inspection/focus return and an already-open dialog's scope retirement.
These browser fixtures do not qualify production custody, providers or a real
tenant's access; those remain the existing backend/service acceptance suites.

Evidence is retained under
`/Volumes/code-bank/artifacts/zero-platform/diagnostics/logging-ui-before` and
`logging-ui-after`; test logs are in the adjacent `blog-publishing` diagnostics
directory. The in-app browser runtime was unavailable (sandbox-state metadata
error), so the repository's existing Chromium harness supplied the visual and
interaction checks. No live PracticeIQ/Pantheon access or data was used.

The combined frozen `c9c5fb9` code candidate subsequently passed all ten
qualification gates, including its complete 1,341-file suite and exact installed
Linux/update proofs. See [release qualification](../backend/blog/qualification.md).
Explicit selected-update promotion remains separate from test execution; this
record does not authorize deploying or changing a live application's configuration.
