---
id: zero.work.messaging-administration-qualification
type: roadmap
audience: [developer, agent, maintainer, operator]
owner: messaging
status: draft
visibility: internal
system: messaging
feature: messaging-management-qualification
maturity: planned
applies_to: ["Proposed implementation and release gates after 2.10.1"]
modes: [single-simple, single-advanced, multi-simple, multi-advanced, Fabric, source, bundle, Linux-amd64]
reviewed_against:
  package: "@zero/framework"
  version: "2.10.1"
  commit: "7b151069835f841aca1542b2c8f02e7c3a66a6da"
  snapshot: clean
  date: "2026-11-04"
  evidence_level: source-observed
---

# Messaging Management Implementation and Qualification

[Working index](./index.md) · [System design](./messaging-administration-plan.md) · [Management experience](./messaging-administration-experience.md)

Deliver the proposed management facade, persistence, reactive policy boundary
and single AppShell component together. The scenarios below are acceptance
requirements, not executed test results. The planning change does not update an
application, install a schema, select an archive or deploy a service.

## Dependency ordered implementation

### Establish authority and settings contracts

Define deployment delegation, per-action Guardian requirements, approved
membership fields, provenance and supported runtime transitions. Keep defaults
identical when administration is omitted. Define an immutable effective policy
snapshot provider and separate display/settings revisions from security policy
generations. The existing startup-frozen config is not the dynamic store.

Add proposed browser/server admin contracts beside the current messaging
contracts. Keep the browser entry free of private stores/server imports. Use
focused files for pure validation/delegation, effective policy, management
service, realm commands/queries, routes, SDK projections, controller and UI.
Do not grow the participant service or a single TSX file into every layer.

Exit criteria: invalid/undelegated fields fail before side effects; the same
pure rules are used by startup, management preview and apply; no private policy
or capability metadata is exposed to public support visitors.

### Add private persistence and safe upgrades

Allocate the next private messaging schema version from the actual current
registry. Do not edit any historical migration/checksum or the caller's app
ledger. Install bounded settings/definition/preview/reconciliation records in
each existing messaging Fabric realm through its normal lifecycle, not ad hoc
SQL in the component, SYSTEM or the app database.

Existing config groups keep stable conversation IDs, source-locked definitions,
messages, member history boundaries, read positions and private Storage assets.
An explicitly enabled administration feature may seed delegated defaults once;
it must not clone all groups into editable copies or reset state on restart.
Unknown ownership/schema state fails closed with an actionable diagnosis.

Protect mixed-runtime operation: record a compatible realm policy format and
writer generation. A pre-feature runtime cannot ignore active database policy
and keep accepting sends under old config. Design a capability/readiness fence
and coordinated restart requirement before claiming rolling upgrade support.
Until that is qualified, use stop-all, backup, update and start-one semantics
for every runtime sharing a messaging root; do not advertise zero-downtime
cross-version policy changes. A code rollback cannot erase new policy state.

Do not assume adding a new marker makes an old binary understand it. Prove the
existing realm owner, higher-schema and immutable-image admission reject the
old installed package, including when installation is permitted. If that proof
fails, add a reviewed compatible admission mechanism and require exclusive
current-runtime ownership before activating dynamic policy. A documentation
warning alone is not evidence that overlapping old writers are fenced.

Exit criteria: populated old-realm upgrade and source-to-bundle checksum tests
pass; no existing IDs/history/receipts are replaced; restore/rollback uses the
documented backup boundary, not guessed private edits.

### Implement management operations and maintenance

Build current-scope reads, delegated settings changes, manual/automatic group
creation/editing, archive/restore, member pages and bounded previews. Reuse the
existing actor command, intent-receipt, Logging source/outbox and Fabric lanes.
No mutation accepts a client-selected tenant/actor or treats an old receipt as
current permission.

Implement the realm-local generation fence and truthful unknown-outcome
reconciliation before wiring the UI. Commit definition, bounded membership,
generation and receipt together. Guardian changes drive resumable coalesced
membership maintenance; scans run outside leases and callbacks cannot publish
old generations. Normal display-only changes must not invalidate healthy auth
or logging admission.

Exit criteria: all security, concurrency and recovery cases below pass using
actual managed services, not mocked management authorization.

### Wire one native management organism

Add the proposed `MessagingManagement` public export, scoped hook/controller and
small rendering parts under the existing messaging family. Reuse ordinary
AppProvider/client, AppShell, DataTable/MasterDetail, native avatars, shared
inputs, managed drawers/modals, ScrollArea and default motion/tokens.

Implement the Guardian requirement editor over the supported requirement
vocabulary. It is not an invented SQL-filter shortcut. Add server query refresh
and native live projections without remounting the table or manufacturing
INSERT/UPDATE events. Keep group/settings/member drafts independent.

Exit criteria: the single component completes setup/create/edit/settings flows
without app-written fetch, permissions logic, duplicated dialogs or another
auth/typing/Sync provider. All visual/lifecycle cases below pass in Chromium.

### Documentation and qualified release

Create canonical implementation manuals for backend management and the
frontend organism, with exact public imports, defaults, locks, modes, error
and receipt behavior, installation and retained-state upgrade instructions.
Link them from the messaging backend/frontend indexes, configuration, current
workspace, Guardian integration, Doctor and main upgrade guide as appropriate.
Keep this plan as historical design, not an alternate live API manual.

Qualify a clean committed package through the repository's normal release
process. Record the exact version/commit/archive SHA and source, browser,
installed package, Linux deployment and updater results separately. Use focused
checks during implementation; do not restart unrelated full sweeps after each
prose edit. Final qualification follows [release policy](../../docs/releasing.md).

## Security and scope acceptance

- Administration omitted/disabled in a fresh or never-managed scope: prior
  behavior is unchanged; no extra database/worker/client or exposure appears.
- Disable management after saved policies exist, remove delegation, redeploy
  changed defaults and restart: stored policy remains enforced or reports an
  explicit compatibility failure. No permissive fallback or silent rule removal.
- Single/simple admin and non-admin; single/advanced granular requirements;
  multi/simple and multi/advanced independent organizations; no-current-scope
  and Administration Organization boundaries.
- Read-only, group-only, member-only and settings-only actors get exactly their
  admitted controls and server APIs. UI hiding is not the enforcement test.
- A metadata-only manager cannot add people indirectly through a rule change,
  create an active audience or submit extra membership fields with a rename.
  Member management cannot change deployment ceilings or create definitions.
- Guessed IDs, tenant/query/body selectors, extra properties, malformed policy
  input, client counts, unbounded lists and cross-scope preview/receipt reuse
  fail without leaking whether a private record exists.
- An administrator can manage a group without reading its transcript, notes or
  files. A manager does not join automatically. Explicit self-admission still
  requires the same audience ceiling and current membership rules.
- Unapproved permissions/properties, self-editable untrusted properties, platform
  role substitution and nonrepresentable nested logic are rejected by the server.
  Editing a group never grants a role or mutates account property values.
- Guardian/session/account/tenant/policy revocation during directory scan,
  preview, apply, subscription, typing and file delivery remains effective.
- Public support visitors, ordinary participant endpoints, API keys and existing
  native scopes cannot invoke management. Required logging admission remains
  enforced only on the correct protected boundary.

## Group and history acceptance

- Create manual and automatic groups, including an automatic zero-match group.
  Manual activation with no eligible member is rejected without fabricating an
  administrator membership. Duplicate submit/replay creates one conversation.
- Multiple existing/manual/config groups retain their identities. Source-locked
  config groups cannot be edited/adopted silently. Ordinary peer groups and
  direct conversations remain absent from the administrative definition list.
- Rules reuse exact Guardian semantics for current-scope roles, all/any
  permissions and typed trusted properties. Displayed sentence and preview
  match the actual backend membership, including ineligible/provisioning users.
- Changing Guardian authority coalesces to the current desired membership;
  removed users lose history/file/typing access before maintenance can finish.
- Preview/apply distinguish added, removed and unchanged members; expired,
  superseded, mismatched-actor or changed-authority previews cannot apply.
- Changing future-join history never rewrites current users' granted sequence
  boundaries or marks messages read. Rejoin honors the newly admitted policy;
  `all` requires its explicit allowed history choice and warning.
- Archive/restore retains IDs/history/files and does not revive old provider
  work or override current membership. Policy must still govern archived reads.
- Renaming is cosmetic, keeps the conversation selected and creates no auth
  reset. Post-activation membership-mode conversion is unavailable.
- Existing contact/block behavior is preserved for ordinary chats; team-group
  independence is explicit and does not leak block lists.
- 32 groups, 100 participants/group and 10,000 candidates remain real bounds.
  Exceeding a ceiling reports capacity rather than truncating a preview or
  activating a partial audience. All numeric fields reject invalid/oversize input.

## Concurrency durability and performance acceptance

- Two managers edit the same revision: one accepted change, one clear conflict.
  Two different groups can progress without overwriting each other's definitions.
- A manager's accepted policy/settings save returns the exact accepted result
  despite its own intended generation transition. It does not manufacture
  `LOGGING_OUTCOME_UNKNOWN`, retire a healthy session or demand another audit
  handshake. A genuine concurrent Guardian revocation still fences the result.
- A policy-invalidated or uncertain-admission 503 clears old private content;
  an ordinary unchanged-policy 503 preserves authorized transient retention.
  Explicitly test the SDK's error classification rather than status alone.
- Membership/Guardian changes during preview/apply force revalidation; there is
  no partial definition/member commit or stale authorized release.
- A group-specific policy update does not invalidate unrelated direct-chat or
  other-group operations merely because their actor snapshot contained the
  broader policy catalog. Scope pause still withdraws the whole scope correctly.
- Drop the connection before acceptance and after acceptance; reconcile the
  original request receipt without replaying a new create or duplicate audit.
  An unknown commit stays fenced until reconciled, with management recovery
  still reachable. Do not permanently strand the whole app behind a gate.
- Kill/restart the coordinator/actor before commit, after commit and before hint
  delivery. Recover canonical accepted state and outstanding maintenance; do not
  create fake events or rebuild membership from a browser cache.
- A delayed old list/member/SSE/typing/file result cannot cross a generation or
  scope replacement. Test both actor-side and parent-release checks, including
  hint loss/reconnect. Previously delivered bytes are not claimed to be recalled.
- Live policy admission uses no provider/network I/O under SQL or Guardian
  leases. Coalesced scans yield between pages. Unrelated direct messages and
  independent databases remain responsive during the largest supported scan.
- Under deliberate load, measure foreground send/read/management latency,
  membership convergence, actor queue length and audit backlog. Set and record
  workload-specific budgets before qualification; this plan invents no latency
  SLA or claim of unlimited concurrency.
- Pause/read-only and resume fence in-flight AI publication/notification work
  correctly while preserving dispatched-provider uncertainty and original
  Torrent concurrency. No automatic external-effect replay occurs on resume.
- Disk-full, actor capacity, malformed persisted policy, logging unavailable
  and reconciliation failure have safe specific outcomes. Restore from backup
  preserves definition revisions, memberships, receipts and Storage identities.

## Browser and component acceptance

- Mount only `MessagingManagement` inside the normal AppShell/provider. Create,
  search/filter/page/select/edit/archive/restore groups and change delegated
  settings without additional app-owned forms or another authentication client.
- Scope and capabilities adapt the same organism. Modified-click/back/forward
  host navigation remains ordinary supported routing; protected transitions do
  not remount the app shell or flash a successful audit handshake as failure.
- Use keyboard, focus, touch, narrow viewport, high zoom and reduced motion to
  complete the wizard and rule editor. Nested choices/confirmations remain
  owned by the same native modal/drawer manager with correct focus return.
- Native avatars load/refresh under current read authorization; failed images
  fall back cleanly. All icons use Zero's available icon family.
- Unchanged/ reverted forms disable Save and issue zero writes through click,
  Enter or programmatic submission. Unrelated auth/profile/avatar/live updates
  do not erase drafts. Newer typing survives an earlier acknowledgement.
- Rapid submission, partial transport failures, conflict, late responses and
  unmount/account/scope retirement preserve truthful accepted/unknown outcomes.
- Live group/member changes update stable DataTable rows and shared number
  counters. The first-load entry animation is not replayed; page transitions
  remain directional; realtime changes do not reset filters or selection.
- A 403 withdraws rows, cached pages, actions and detail immediately under both
  motion preferences. A 503 retains only previously authorized same-scope
  content with an explicit stale/error state; retry requires a fresh read.
- All specified empty/loading/no-results/locked/capacity/paused/error states are
  visible and honest. Standard page sizes have a real selected default.
- Actual scrollable overlays use native Arc edge fades/scrollbars in both axes
  where needed, with no wheel/scroll ownership fight.

## Audit and release acceptance

- Managed runtime tests cover Logging disabled and actual required logging.
  Accepted admin changes reach source/outbox, private Logging Fabric and the
  native investigator exactly once with readable semantics and correct actor.
- Rejection/rollback/unchanged refresh produces no false success or heartbeat
  flood. Lost acknowledgements/recovery produce no duplicate operation evidence.
- No transcript, raw property values, identity contact fields, credentials,
  private URLs, upload grants or preview payloads appear in event metadata.
- Doctor reports supported configuration/delegation errors, obsolete runtime
  policy format, capacity, compatibility and recovery action without opening an
  app or exposing secrets in its read-only/source-only modes.
- A populated synthetic retained installation upgrades through normal
  `zero-update`; app source/config/public tokens/databases outside the declared
  migration are not rewritten. Older mixed writers cannot ignore new policy.
- The exact installed archive exports the native organism and facade, documents
  them locally, typechecks a normal consumer and runs an actual browser workflow.
- A Bun-first bundled Linux/amd64 managed deployment seeds/migrates once from
  source, builds officially and restarts the retained bundle without migration
  checksum drift, implicit dotenv/provider secrets or actor boot of the main app.
- Tag/main/both remotes, selected archive hash and normal updater receipt agree
  before calling the feature update-ready. No consuming application deployment
  or production data conversion is part of Zero qualification.

## Three design review passes

These are design reviews of the proposed contracts, not independent security
certification or runtime test results.

### Pass one user journeys and composition

The initial direction could have produced multiple disconnected screens. The
revised design specifies one `MessagingManagement` organism, internal navigation,
DataTable/detail composition and one create/edit drawer. Group administration
and ordinary conversation controls are separate responsibilities. Empty states,
disabled Save, current photos and plain language are part of the default view.

### Pass two authority and platform integration

A form over startup-frozen config would not supply real live management. The
design adds scoped durable definitions, immutable effective snapshots and
explicit delegation. Metadata management does not grant transcript access;
automatic rules use Guardian rather than SQL filters. Locked configured groups,
portal mode and AI/support setup are not falsely presented as editable.

### Pass three races recovery and retained state

Cached policy hints alone could leak a revoked audience, a failed Apply could
strand recovery, and old runtimes could ignore new settings. The design adds a
realm-local generation fence, same-commit membership/receipt updates, protected
management receipt recovery, preview revision binding and mixed-writer upgrade
gates. History changes are explicitly future-join-only. A new manager cannot
silently adopt or replace old conversations. These cases must become tests
before implementation can be described as complete.

The review also distinguishes the initiating writer's exact accepted generation
transition from real concurrent revocation, and a policy-invalidated 503 from a
transport-only 503. Group-specific fences do not retire unrelated direct chats.
Disabling management after use cannot undo saved policy or turn old defaults
back into authority. Field-level capability checks prevent a metadata editor
from changing membership indirectly through an automatic rule.

## Related guides and next steps

- [System design](./messaging-administration-plan.md) is the proposed authority,
  storage, API, generation and lifecycle contract.
- [Management experience](./messaging-administration-experience.md) is the one
  native component's default composition and interaction specification.
- [Existing messaging review](./messaging-workspace-review.md) records earlier
  native integration work; it does not qualify these proposed additions.
- [Documentation standards](../documentation-standards.md) govern the actual
  backend/frontend manuals and their truthful release evidence.
