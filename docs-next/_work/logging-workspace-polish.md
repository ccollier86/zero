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
applies_to: ["feature/logging-human-readable-workspace; source/UI qualification, not a selected stable update"]
---

# Logging investigation UI repair

[Working index](./index.md) · [Supported component](../frontend/components/logging.md) · [Logging foundation](./logging-foundation-review.md)

Historical UI implementation and verification record. The
[logging and auditing replacement](./logging-auditing-replacement-plan.md)
now owns the product correction: useful automatic capture, explorable record/list
identity, changes, duration, correct totals and no idle transport activity. The
checks below do not establish acceptance of those newly specified behaviors.

## Scope and ownership

Keep the existing private Fabric logging system, current-scope Guardian checks,
cursor query source, genuine batched INSERTs, native incoming-record control and
strict delivery admission. Improve the investigation interface, not an unrelated
metrics dashboard. Do not add a second table, body search, fake totals, replay
the initial-load animation, or label a connected stream as verified compliance.

The prior interface had a flat raw-code table, buried exact filters, a legacy
modal with no visible managed header, and undifferentiated metadata. Its live
DataTable foundation was functional and must remain so.

## People-first continuation (2026-10-28)

The user rejected raw actor IDs/punctuation-expanded action codes as the normal
investigation interface. The current pass adds:

- Current minimal Guardian names/usernames and authorized private avatar reads;
  system, API-key/service and anonymous activity remain visibly different.
- Plain-language record create/edit/delete/read-stage and browser activities,
  plus `LoggingPresentation` mappings for app-specific actions, tables and
  resources. Exact IDs/codes remain in the default-collapsed native Collapsible.
- Server-backed User / Activity / Table / Outcome controls, current-scope remote
  user search, click-a-person investigation, and friendly applied chips. Drafts
  do not change the query until Apply; technical/date/category criteria remain
  available without pretending to support free-text or OR queries.
- A minimal logging-read-protected directory and declared schema catalog.
  Tenant names require current active membership, table catalogs exclude
  platform-only schemas, and pending provisioning is not discoverable.
  Suspended identities remain identifiable without implying avatar access.
- Existing capture/catalog table identities now share the exact same
  legacy-compatible normalizer. No retained target, migration or ledger changes.

Current presentation is separate from signed historical events and exports.
Missing/deleted/out-of-scope people remain unavailable rather than being invented
or resolving to an unrelated current account. Images use native authenticated
directory/delivery, shared per scope/user/revision. Effect replacement shares one
cleanup turn; zero-reference scope retirement aborts and revokes URLs. There is
no timed cross-account image cache or public-image publication.

The actual browser pass found dynamic native form controls resetting invalid
draft criteria, duplicated photo fetches during cell replacement, and cmdk's
hidden label overriding the intended user-search name. The explicit Apply
boundary, reference-counted image ownership and correct command label address
those cases. Failing attempts remain in the diagnostic directory; they are not
described as passing checks.

The focused combined run passes **43 tests / 287 assertions across 10 files**,
including seven Chromium scenarios and a real managed `createApp` HTTP test of
Guardian directory/read authority, minimal responses and exact table/activity/
user filters. SQL tests cover literal wildcard search, cursor bounds, current
membership/provisioning isolation, legacy core users without profile revisions,
normalized aliases and descriptor-safe validation. Browser checks cover actual
filter interactions, retained live rows, keyboard modal/focus recovery, mobile
width, photo fallback, URL retirement and a deliberately late old-scope photo.
The browser's directory/photo responses are **synthetic adapters**, not evidence
of a deployed Linux avatar service; that is distinct from the native managed
HTTP/backend checks. No production data or private app was accessed.

Evidence: `logging-readable-combined.log`,
`logging-readable-typecheck-complete.log`, `logging-readable-public-docs.log`
and `logging-readable-ui/` under
`/Volumes/code-bank/artifacts/zero-platform/diagnostics/messaging-support-review/`.
Root TypeScript passes. Three public-export/documentation checks pass (123
assertions), including compilation of the two actual LoggingWorkspace Markdown
examples. The frozen original frontend contract digest remains unchanged; the
new logging types and prior notification-audio exports have explicit additive
assertions rather than being folded into a new baseline.

The exact clean source commit `1849e34ae7a36fbfaa07ea05aa946ae38a1b347c`
repeats the 43-test/287-assertion regression set successfully in
`logging-readable-committed-regressions.log`. Its original combined compiler
run hit the existing 60-second public-type guard and was interrupted before
the other compiler checks finished; this failed/incomplete evidence is retained
in `logging-readable-committed-public-docs.log`. No timeout, assertion or
contract baseline was changed. Separate serial runs on the same clean commit
pass the two public-contract tests (28 assertions, 20.44 seconds), the actual UI
Markdown examples (95 assertions, 18.20 seconds), and root TypeScript:
`logging-readable-committed-public-contract-serial.log`,
`logging-readable-committed-ui-docs-serial.log`, and
`logging-readable-committed-types-serial.log`. The documentation graph also
passes: 874 pages/IDs reachable, no structural problems. This records controlled
source verification, not a diagnosis of the earlier timeout or a full-suite pass.

This is feature-branch evidence, not a qualified selected archive. The separate
pending messaging/native-worker release gates remain in
[the messaging review](./messaging-workspace-review.md). Do not promote the UI
branch by bypassing those gates or imply a successful stable update.

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

Final exact-archive qualification and selected-update promotion remain release
gates. The frozen blog candidate is independent and is not changed by this pass.
