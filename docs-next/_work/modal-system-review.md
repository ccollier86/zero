---
id: zero.modal-system-review
type: inventory
audience: [maintainer, agent]
owner: modals
status: in-review
visibility: internal
system: modals
feature: independent-review
applies_to: ["2.6.0 source; structured-modal upgrade unreleased"]
modes: [browser, standalone, Guardian single, Guardian multi, single-database, Fabric]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "1b5a1fa0281deba69b3809471d2467d596516e4b"
  snapshot: dirty
  date: "2026-10-08"
  evidence_level: source-observed
---

# Modal System Independent Review

[Working index](./index.md) · [Redesign plan](./modal-system-redesign-plan.md)

This is the independent review ledger for the unreleased structured-modal work.
All confirmed implementation findings below are corrected, with bounded matching
source, synthetic, browser or archive evidence. It is not a publication,
deployment, clean-commit qualification, or live consuming-application guarantee.

The audit read the lifecycle, forms, motion, workflow, migration, and qualification
contracts before inspecting source. No application configuration, real environment
file, live database, external provider, or consuming application was used.

## Findings And Corrections

| ID | Evidence and expected contract | Disposition |
| --- | --- | --- |
| M-01 | ModalHost derived recession demand from any active owner, but scene playback also gated it with the top modal's pageRecedes option. A child opting out could restore a page still leased by its parent. | Corrected in scene controller: host-derived demand is authoritative; live reduced motion still suppresses recession. |
| M-02 | Changing provider motion defaults changed each existing renderer's signature and could retarget its in-flight entrance. The approved plan freezes defaults for admitted instances. | Corrected: renderer captures provider defaults per admitted instance. Explicit descriptor motion replacement can still retarget. |
| M-03 | Closing entries were absent from activeModals, so findIndex=-1 gave the exiting top modal a new step-back depth while reverse-origin shell motion ran. | Corrected: renderer retains its last active depth during exit. |
| M-04 | HoldButton intentionally cancels when its action callback changes, but shell supplied a new inline callback on every presentation render. Unrelated changes could restart a hold. Hold primaries were also absent from initial-focus lookup. | Corrected by the shell's stable action-owned hold adapter and primary metadata/focus lookup. Safety duration remains independent of motion pace. |
| M-05 | Self-wired admin mutation adapters awaited post-receipt callbacks/toasts in the same rejected Promise as the actual writer. A notification failure could relabel committed creation/update as failure and offer duplicate retry. | Corrected with independent best-effort post-acceptance notification stages and static frontend.admin_user.notification_failed diagnostics. Controlled handlers remain actual writers. Four focused regressions pass. |
| M-06 | Actual exported facade uses `export const modals = {...} as const`. Doctor's installed-capability inspection only accepted a bare object expression, so actual packed/workspace capability was null while simplified fixtures passed. | Corrected by AST-only unwrapping of parentheses, type assertions and satisfies. No executable package imports are evaluated. Regression and actual installed-archive proof pass. |
| M-07 | Copied modal workflow types retained a relative import to a non-copied workflows/types module. Browser transpilation alone hid this; the fresh copied consumer's TypeScript check failed. | Corrected in the source-copy subsystem with the exact workflows/types→public workflows type-subpath rewrite. Actual copied browser build and consumer typecheck pass. |
| M-08 | A conditionally rendered standalone controlled confirmation could dispose its fallback host as soon as its owner cleared the decision, cancelling queued return focus. The existing IntegrationSettings browser test reproduced this. | Corrected by stable optional host ownership at the IntegrationSettingsList/ApiKeyManagement facades. Nested hosts inherit the existing app host. Integration cancel/success/keyboard focus browser tests pass. |
| M-09 | Controllers cleared controlled confirmation state inside the writer before the manager could accept its acknowledged result. Owner-driven retirement suppresses obsolete focus callbacks, so accepted close policies could be lost. | Corrected for APIKey, Integration, tenant members, platform workspace members, onboarding and pending-invitation confirmations. Writers return explicit acknowledgment; manager acceptance precedes owner close. Eight actual-kernel decision regressions and the existing synthetic auth suites pass. |
| M-10 | New action/header/form failures reused a diagnostic definition whose text claimed a close callback failed after dismissal. | Corrected to generic modal-callback wording; stage metadata remains static and safe. |
| M-11 | A first sibling host can unmount while another host remains. Global modal IDs survive, but the renderer/body React trees move to a different host, resetting body-local drafts, admission snapshots and opener capture. | Corrected with a stable scene lease. Actual owning-host teardown retires its captured instances before a sibling receives the lease; Strict Mode cleanup/replay preserves the current owner. Root Chromium regression verifies retired outcome, no extra body mount, and safe fresh sibling opening. |
| M-12 | CommandDialog is a specialized cmdk overlay, not an ordinary form. Its raw DialogContent/overlay retain z50 and do not inherit managed ownership, token lane or portal container. | Corrected with owned branch registration, inherited container/theme and owner-relative content/overlay layers. Specialized cmdk layout and motion remain intact. Root Chromium regression verifies the child layer and Escape ownership. |
| M-13 | Progress action ownership and observation reload/state ownership compared reusable strings. Selecting A→B→A could let an old A receipt clear a newer A action, revive an old HTTP snapshot, or admit a retained reload callback. | Corrected using the existing monotonic authorization fence and exact action-admission token, with mount/current-incarnation checks. New hook and actual component regressions verify ABA, unmount/reopen and workflow-name ownership without auto-start/cancel/replay. |

Corrections are in the shared dirty working tree. A source-observed correction is
not automatically a browser-verified or released contract; the evidence below
states the actual checks.

## Responsibility And Lifecycle Review

The kernel owns exact instance/generation admission, logical results, child
retirement, single-flight actions, close guards, safe caught-error presentation,
and stale callback suppression. Rendering owns presentation, focus and owned
portal branches. Existing form/save/domain controllers still own validation,
authorized writers, canonical acceptance, and conditional-write semantics.

Accepted, dismissed, and retired results settle before visual cleanup. Descriptor
replacement aborts the prior generation but preserves the result handle.
Presentation projection preserves the native form/controller generation and an
already admitted writer. Parent teardown removes owned descendants, not unrelated
modals. Host cleanup operates on captured IDs, and forced retirement bypasses
advisory guards without authorizing obsolete callbacks.

Native footer submission targets a declared formId or the one visible form in the
active body. It does not use a global Enter handler. Child forms prevent portal
submit ancestry; native validation, textarea/IME and current domain writers remain
in their existing subsystems. Multiple/ambiguous native forms require explicit
targets and deserve a browser fixture, not an inferred writer.

## Exit Paint, Reservations And Focus

ModalExitSnapshot captures before React removes interactive Radix content. Its
clone is inert, aria-hidden, role-free and pointer-disabled; duplicate IDs are
removed, and canvas paint is copied best-effort without serialization/logging.
Only paint survives the exit: the Radix focus/dismissable scope and owned popup
subtrees retire on logical close. Root/current inner composited presentation is
captured before interruption; entrance, stack and scene transforms are separate.

The host retains scroll/inert reservation until both exiting paint and shared
scene restoration finish. Return-focus callbacks are delayed until the current
scene is actually released, checked against a current parent/new-modal owner,
and do not run for obsolete retirement. Owning-host teardown deliberately retires
captured instances instead of silently transferring live body state to a sibling.

The snapshot redacts password, one-time-code and explicit sensitive-input markers,
and masks SecretField paint before mounting a retained clone. This supplements
ordinary teardown; it does not infer arbitrary application-specific secrets in
unmarked custom markup.

Snapshot review does not prove arbitrary embedded video/custom canvas/editor
paint fidelity. It deliberately preserves no interactive listener or domain
operation. Capture/cleanup exceptions must not strand a logical result or lock.

## Executed Evidence

All commands below used Bun with automatic environment-file loading disabled.
Temporary installs/archives/builds used freshly allocated disposable scratch
directories and disabled lifecycle install/pack scripts. Only those exact
temporary trees were removed. Diagnostic artifacts contain synthetic evidence,
not application records or credentials.

| Check | Actual result | What it proves |
| --- | --- | --- |
| Final focused kernel/adapters/motion/reactive-record/form-save/workflow observation/auth-submit/storage run | 162 tests passed across 16 files; 853 assertions, final root run | Exact-ID outcomes, replacement/retirement/guards, acknowledged forms, record/revision fences, safe readiness/model behavior; synthetic/React harness, not live service proof. |
| Admin post-acknowledgment notification regression | 4 tests passed; 22 assertions | Actual writer rejection is preserved; post-receipt callback/toast failure cannot relabel success or leak arbitrary caught payloads. |
| IntegrationSettingsList styled Chromium suite after migration | 9 tests passed; 75 assertions | Pending decision lock, acknowledged completion/cancel, current-target focus, keyboard context route, scope/capability/read-only retirement, light/dark 320px and reduced motion. |
| Admin/auth domain and acknowledgment suite after migration | 71 tests passed across 8 files; 369 assertions | Existing synthetic domain policy/controllers plus eight structured-shell exact-receipt decisions; APIKey/tenant/onboarding/Integration reject or retire without falsely accepting work. |
| Workflow hooks and structured auth decisions after ABA repair | 39 tests passed across 2 files; 213 assertions | Old A reload/snapshot cannot revive after A→B→A; retained refresh is inert after unmount; domain decisions still honor exact current acknowledgment. |
| Progress-component Chromium ABA and lifecycle regression | 3 tests passed; 15 assertions, plus 6 pure model tests / 30 assertions | Current controls remain pending when an earlier A or closed-view receipt completes; old errors do not become new progress errors; reopen does not start/cancel work; capabilities and workflow-name ownership are explicit. The corrected observability assertion checks the public code string. |
| Root final styled manager/ConfirmProvider/PasswordInput/FormSave suites | 29 tests passed across 4 files; 127 assertions, reported by the owning agent | Standard frame/native form receipts, sibling lease teardown, owned Command/Select/Popover Escape/layers, retained panels, required-step feedback, focus/reservation and sensitive exit-paint redaction. These are matching root-run browser evidence, not this reviewer's separate execution. |
| Final styled presentation/motion suite | 5 tests passed; 108 assertions, reported by the owning agent | Left/right/full/custom bounds, custom same-document portal container, hidden/thin scrollbars, live scoped/public/dark and lane-only token changes, six actual WAAPI presets, live reduced-motion changes. |
| Final profile/CRUD consumer qualification | Profile 39 tests / 221 assertions, targeted password 3 / 21, and CRUD 21 / 103, reported by the owning agents | Shared account/avatar/email/security and CRUD presentations preserve acknowledged domain writers and post-receipt notification behavior. Ordinary AutoForm compatibility was checked separately in 7 cases. |
| Root workflow service integration suite | 4 tests passed; 96 assertions, reported by the owning agent | Real ephemeral WorkflowService/ReactiveDB and WebSocket live-monitor/sync integration. No real application database or configuration was used. |
| Source-only Doctor assertion-wrapper regression | 7 tests passed in the combined run before archive stage | AST/static capabilities, path fencing, exclusions/strict policy, no config/env fixture execution. |
| Fresh installed archive + copied-source qualification | 1 test passed; 24 assertions | Public modal/list singleton exports, browser build, DOM-free SSR, consumer TypeScript, copied-source browser build, packed docs/CSS presence, source-only Doctor API and CLI. |
| Full package TypeScript after final migrations and workflow ABA repair | Passed | Current dirty package source compatibility, including the full API-key fixture and progress-browser code-string assertion. This is not a clean release or consuming application compatibility claim. |

The final-source fresh archive was version 2.6.0, SHA-256
`0750691ba44467ba52e2d33fa95eb8eeb589910b5d74e8544d0e295e062b56d2`.
Its public consumer browser bundle was 16,865,713 bytes. It was packed from the
dirty checkout after the workflow/consumer fixes and installed in a disposable
consumer, not published. This proves those bytes, not a future release or later
implementation edits. This ledger's post-run evidence recording is not part of
that archive identity. Sanitized evidence is held outside the repo in the
designated modal-system diagnostic artifact directory.

## Qualification Matrix Reconciliation

| Planned contract | Evidence at this review | Remaining obligation |
| --- | --- | --- |
| Standard shell/X/header/footer | Shared source, final root shell/consumer browser fixtures and installed public contracts | Application-specific custom markup outside the shell and consuming app migrations remain caller responsibility. |
| Viewport/scroll/body/tabs/nav | Bounded root manager/presentation fixtures, retained panels, custom height/full/side, hidden/thin scroll and 320px Integration layout | Real mobile visual-keyboard/browser-chrome behavior is not inferred from Chromium desktop viewport tests. |
| Focus/stack/popup portals | Integration browser route, parent/child kernel tests, root popup fixture; sibling teardown and Command ownership findings corrected with matching browser proof | Remaining stress coverage must distinguish final-source evidence from earlier baselines; unmarked app-specific overlays remain caller responsibility. |
| Exact lifecycle/actions | Final kernel/adapters/native-submit pure set and styled form/decision/hold qualification | Server rollback/idempotency and application-specific input protocols are not supplied by a UI manager; no automatic writer retries. |
| Theme/motion | Exact CSS/TS timing/curve tests and final actual WAAPI preset/origin/Rise/reduced/scoped token/custom-container browser fixtures | Only supported same-document portal roots and explicitly supplied tokens are covered; no cross-document iframe or ShadowRoot style guarantee. |
| Reactive records | Explicit source identity/readiness/revision tests, pending-local masking and canonical acknowledgment | A UI adapter is not CAS. Normal Reactive DB/Fabric adapters must explicitly provide their supported revision/write enforcement and read readiness. |
| Torrent progress | Scoped existing hook/read adapter, pure/synthetic model and ABA tests; actual progress-component tests; root ephemeral live-monitor/sync service tests | These checks do not establish every accepted-start/wait/input/unknown-start-outcome path through a progress modal. The body observes an already admitted run and exposes cancel/pause/resume; application-specific input editors remain composed through existing workflow hooks. |
| Distribution/Doctor | Final-source installed archive, copied-source browser build/TypeScript, DOM-free SSR, public singleton export and source-only Doctor gates passed; final archive identity recorded above | Publication/clean release and consuming application-specific migrations remain separately authorized workflows. Specialized overlays retain their own layout and supported ownership integration. |
| Documentation/release | New guides/source-read compatibility map, 747/747 reachable graph, clean symbol homes and 13-snippet public compiler checks reported by the documentation agent | Final version/compatibility decision, clean commit and authorized release workflow remain separate gates. |

## Review Boundaries And Handoff

No global token-theme redesign, alternate workflow runner, browser auth workaround,
automatic record merge, server rollback, or app-specific migration was introduced
by this review. Permission hints do not replace backend policy, a connected socket
does not prove hydration, an empty local projection does not prove deletion, and a
rounded progress percentage does not prove successful completion.

Confirmed findings are closed for the reviewed source and recorded checks. The
review metadata remains in-review because release/version and live consuming-app
qualification are separate. Do not present source-only Doctor no-findings, an
archive browser build, or documentation compilation as release qualification of
every mode.

## Related Evidence

[Redesign phase gates](./modal-system-redesign-plan.md#verification-matrix) define
completion; [modal migration](../frontend/modals/migration.md) explains consumer
ownership changes; [documentation process](../documentation-process.md) defines
the source/archive/release evidence boundary.
