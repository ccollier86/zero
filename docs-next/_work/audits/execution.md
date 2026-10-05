---
id: zero.documentation-execution
type: operations
audience: [agent, maintainer]
owner: zero-documentation
status: in-review
visibility: internal
---

# Documentation Rebuild Execution Ledger

[Audit index](./index.md) · [Documentation index](../../index.md)

## Scope And Baseline

Documentation is isolated in `docs-next/` on
`feature/production-documentation-foundation`.
Source baseline: framework 2.1.1, main
`a3a5f726768dac890f241a3899c0a1acb66265d9`.
The user subsequently approved fixing all confirmed defects with focused tests.
Those runtime/package working diffs are recorded separately. No app, deployment,
live database, current docs or active agent entrypoint changes are in scope.
Config imports and Doctor are not assumed static or safe against a real project.

## Stage Gates

- [x] Read authoring process, standards, project instructions and storage policy.
- [x] Record branch/version/source baseline and preserve unrelated work.
- [x] Enumerate concrete package exports without module execution.
- [x] Assign systems and individually catalog public frontend symbols.
- [x] Complete and independently review whole-platform inventories (36 systems).
- [x] Reconcile source directories, runtime activation, command dispatch and principal config hierarchies.
- [ ] Resolve/discuss implementation findings and publication decisions.
- [x] Write first-draft system guides, config references, indexes and roadmaps.
- [x] Write first-draft concepts, tasks, Start Here and compact agent onboarding.
- [ ] Validate navigation, metadata, reciprocal links, indexes and coverage.
- [ ] Verify representative examples against exact package artifact.
- [ ] Verify public-only projection/archive/search/agent content isolation.
- [ ] Perform fresh-reader tasks across relevant modes.
- [ ] Obtain separate approval for current-doc/site/package/agent cutover.

## Checks Actually Performed

Static source/package inspection, AST export-name discovery, local source
target checks and baseline/worktree inspection. These checks do not execute
application/config modules, load real env files, access live data or establish
behavioral/security certification.

Selected actual Markdown examples compile against public source facades using
in-memory TypeScript hosts. The final platform example check passed
1 test / 78 assertions, including twelve named organization modules and three
lazy user-owned schema/config/page modules compiled together. The
Torrent/automation check passed 1 / 19, including the three complete targeted
reply modules. The frontend UI check passed 1 / 30 and the Guardian/Storage/
small-service check passed 1 / 2 for 50 actual fences. These are separate,
overlapping checks; assertion counts are not a unique example count. No example
was executed, listener started, configuration evaluated or provider called.
Installed-package qualification remains separate.

The latest complete source TypeScript check,
`bun --no-env-file node_modules/typescript/bin/tsc --noEmit`, completed with
exit 0 after the approved runtime corrections and fixture typing corrections.
It does not qualify an installed artifact or a full application.

## Checks Not Yet Performed

Focused synthetic regressions and typecheck have now been run for approved
defect fixes; the [findings ledger](./findings.md) records scope/results.
No Doctor was run against a real app, and no real application, provider call or
package installation was performed. Public source examples have the checks above;
exact installed-package examples and package contents remain unqualified. Checks record commands,
side effects, artifact identity and expected/observed results before claims
are promoted.

## Latest Detailed-Writing Checkpoint

First-draft families now cover all 428 feature groups in all 36 inventories.
Every backend, frontend, CLI/Doctor and agent/tooling family has its index and
feature destinations. All 866 individually catalogued frontend component,
hook, support and SDK-member records resolve to 144 substantive documentation
homes. Placement counts measure guide existence only, not accuracy or readiness.

Start Here, the reader-first main index, mode selection, task guides and compact
agent onboarding are drafted. The final docs-first walkthrough exposed concrete
assembly gaps, now corrected and independently reviewed before the first-draft handoff. The user has
selected the table-creation UI discussion as the next priority after that
handoff; package/publication qualification is not silently treated as completed
or allowed to extend this writing phase indefinitely.

Actual platform Markdown examples now include Fabric/resources/migrations,
Storage/Data Studio/Sync/Vector and the assembled organization/user-owned modules.
Latest completed compilation passed78assertions
in one test against actual public source facades in memory; no config/database/
provider execution occurred. Actor regression creates/removes only its own
synthetic dotenv, never an existing app dotenv. Exact archive qualification
remains a distinct gate.

Focused actor/executor checks passed45tests/174assertions; final migration checks
including retained checksum compatibility passed38tests/158assertions.
Root independently reran vector scope/capacity39tests/142assertions, Doctor10/
32assertions and generic/page hooks23/58assertions. Counts overlap: do not sum.
The source/example checks remain separate from exact archive qualification.

Final first-draft structural navigation/metadata check passed 690 pages, 690 unique IDs
and 690 reachable pages with zero problems, including the final organization guide.
The coverage and named-symbol-home checks independently confirm the complete
first-draft placement above. Documentation-parser and UI-export checks passed
together (13 tests / 28 assertions); no fixture was imported or mounted.

## First-Draft Handoff

The first draft is complete. All inventoried feature groups and catalogued
frontend symbols have homes; complete task examples and reader entrances are
written, the final targeted example joins compile, and their independent
docs/source reviews have no blocking finding. The root independently reviewed
the matched workflow bridge and organization wiring. This is first-draft
completion, not a verified public release or an exhaustive security audit.

Next user priority: discuss and improve Data Studio's table-creation/schema UI.
No UI redesign was implemented during this closing documentation pass.
Fresh-history reader tasks, exact committed artifact qualification and an
explicit public-only publication projection remain separate later gates.
Current documentation, package/site entries, active agent files, apps and
deployments have not been retargeted. No publication/cutover is implied.

## Subsequent Authorized Data Studio UI Implementation

After the first-draft handoff, the user authorized the full schema-first Studio
and general master/detail improvement on this same isolated branch. This
supersedes the historical next-priority note above; it does not authorize a docs
cutover, package publication, app patch or deployment.

The working source now composes existing Zero Table, menu/popover, typed inline
cells, dialogs, tabs, controls and action-bar primitives. TanStack owns sizing
and virtual rows; react-resizable-panels owns pointer/keyboard splitting. The
selected json-edit-react 2.0.4 component has a token-themed Zero adapter; a
general-purpose code editor is explicitly deferred. No homemade code-editor
overlay or pointer-resize implementation remains.

Connected Studio defaults to progressive batches with a hidden/resizable desktop
inspector; standalone hook paging remains compatible. A same-query sequence
fence prevents joining shifted offsets, while Sync/writes rebuild loaded prefixes
atomically. The read token is additive metadata from the same strong Fabric
query, not a new authority selector or a schema/database migration.

Review corrected source-instance retirement, delayed post-write catalog scope
handling, foreign-table delete admission, stale/duplicate confirmations and a
mobile cell-selection/inspection collision. Captured opening revisions, stable
column IDs, operation IDs, live Guardian fences and Fabric isolation remain.
New production responsibilities are small separate modules; pre-existing larger
typed inline-cell code was not replaced with a monolithic Studio controller.

Focused backend/SDK/read-window/mutation regressions passed 122 tests / 1,022 assertions
across 18 files. The real isolated Guardian/Fabric HTTP actor test additionally
proves equal sequences for repeated reads and an advanced sequence after an
accepted replacement. The final whole-workspace synthetic browser suite passed
6/25 with production styles, including light/dark/narrow geometry, Radix keyboard
tabs, captured targets, query-width preservation and mobile inline editing.
Agent-owned grid, JSON/dialog and general layout checks are recorded separately;
counts overlap and are not a unique suite total.

All current checks are source/synthetic-fixture evidence. The in-app browser
bootstrap failed with a sandbox metadata error; authorized isolated repo browser
fixtures were used instead, never Pantheon or any user's session/data. New guides
remain in docs-next with reciprocal indexes/backlinks and source applicability.

Final source TypeScript check passed with exit 0. Actual UI Markdown examples,
including the new JSON editor and three Studio workspace compositions, compiled
against public source exports (1 test / 37 assertions). Reader structure closes
at 693 pages / 693 unique IDs / 693 reachable pages with zero problems; 870
catalog records resolve to 146 documentation homes with zero problems.
Focused UI-export checks passed 4 tests / 19 assertions, including the new JSON
subpath and existing test/fixture exclusions. Independent grid, dialog/JSON,
layout and mobile reviews completed; sanitized UI evidence is in the
[UI review](./data-studio-ui-review.md). No package was published, branch merged,
code pushed, app updated or live data modified by this UI task.

## Working Findings

The inventory-writing gate is closed: the 12 foundation inventories were
independently reviewed by the AI/backend audit agent, four AI/Torrent/automation/
Scheduler inventories by root, nine Guardian/small-service inventories by the
experience reviewer, six frontend inventories by the new frontend reviewer,
and five tooling/design/modal inventories by the tooling reviewer. Public export,
source-directory, runtime and CLI coverage is reconciled. Configuration coverage
includes 89 selected public interface types/544 direct fields plus nested records,
not every operation/result type. This closes discovery/ownership, not security,
runtime qualification or detailed documentation. Confirmed defects still block
affected guide claims while unaffected systems can now be rewritten.

Source/contract disagreements remain in owning inventories and the linked
findings ledger. An unresolved behavior
defect blocks inaccurate guide claims; it does not become an accepted limitation.

## Experience And Storage Completion Checkpoint

Source-backed first drafts cover Guardian frontend, Email, Notifications
(backend/UI), Rooms (backend/hooks), generic Tokens, Observability (backend/browser),
KV, PDF and the 30-page Storage frontend family. The Storage manual covers
all 18 exported UI pieces, 15 hooks, controller/slots, public SDK helpers,
schema presentation constants, setup and sourced prospective work. Catalog
reconciliation maps the public support aliases to substantive feature guides.

Actual 50 TS/TSX Markdown examples across Guardian/Storage UI and these smaller service
families compile in memory against public source exports (1 test / 2 assertions).
No examples are executed. Guardian/native examples retain their separate
source and independently maintained preview-package qualification records.

Focused approved corrections use synthetic fixtures only. Final independent
reviews/reruns are complete for Notification input (12 tests / 69 assertions),
Rooms metadata/capacity (11 / 81), generic/direct Guardian Tokens (26 / 115),
Observability bounds (24 / 69), PDF ownership/resource/publication (22 / 63),
Storage upload/selection/lifetime (15 / 40), and Storage settings admission/event
failure (3 / 26). Counts overlap and are not a unique suite total.

Independent source/targeted-test reviews also closed the root's Data Studio
calendar validation, modal close callback, and the tooling reviewer's vector
app ownership/publication, icon forwarding and sidebar semantic-color fixes.
Browser connection was attempted per the available skill but failed with an
environment bootstrap error; existing isolated component fixtures were used,
never the running app/session. No real app/config/data/provider or native vector
collection was opened. Exact package/archive, broader real-browser interaction
and documentation publication remain separate gates.
