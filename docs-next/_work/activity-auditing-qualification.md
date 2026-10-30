---
id: zero.logging.activity-auditing-qualification
type: reference
audience: [agent, maintainer, operator]
owner: observability
status: in-review
visibility: internal
system: logging
feature: activity-audit-release-qualification
maturity: preview
reviewed_against:
  package: "@zero/framework"
  version: "2.7.0"
  commit: "06cd2719ddce6680480845ab46f88eec1b1e0c76"
  snapshot: clean
  date: "2026-10-29"
  evidence_level: implementation-verified
---

# Activity Auditing Qualification

[Working evidence](./index.md) · [Replacement plan](./logging-auditing-replacement-plan.md) ·
[Adoption guide](../backend/logging/activity-auditing.md)

This is a feature-branch qualification record, not approval to update a live
application. No PracticeIQ/Pantheon application, account, database, production
provider or deployment was changed. The normal saved main release remains
separate from the diagnostic candidate below.

## Source And Browser Checks

The implementation is in `feature/activity-auditing-replacement`. Runtime and
native capture were committed in `d702d72`; canonical documentation in
`db4963d`; the additive React contract check in `f4eb4e3`; live intake defaults
and safe deployment-probe bootstrap in `06cd271`.

Preserved diagnostics are under
`/Volumes/code-bank/artifacts/zero-platform/diagnostics/audit-replacement/`.
Failed/intermediate runs remain there alongside corrected reruns.

| Check | Evidence and scope |
| --- | --- |
| Native generated-router browser | The five real Guardian/compliance/private-worker scenarios pass in the canonical run: fresh sign-in, blocked audit retry, session retry, Records → Completed → record → Close → Audit, and live collection/MasterDetail changes. They exercise actual native transport, not mocked table callbacks. The record scenario asserts zero client-navigation document requests, historical ordered versions, no substituted record text and no new audit evidence during 31 seconds idle. |
| Polished record browser | `final-native-activity-after-polish.log`: 1 pass, 28 assertions. Includes history/dialog width bounds and closed-view evidence. The scenario reserves an explicit 120-second budget because its idle check alone takes 31 seconds; no behavior assertion was removed. |
| Workspace browser | `final-workspace-browser.log`: 8 pass, 51 assertions. Production CSS, actual shared controls, user photos, filters, exact rolling totals, retained row identity, scope retirement, narrow layout and failed private photos. |
| Display/selection/security | Private Fabric and native transport tests cover owner/session/tenant/policy binding, original-order selection, empty results, source revisions, exact replay, unknown outcomes, prefetch exclusion, optimistic-copy exclusion, actual committed display order, copy/print binding, revocation and bounded queues. Earlier and final focused runs are recorded in the replacement plan. |
| Activity/export integration | `final-activity-and-export-tests.log`: 21 pass, 260 assertions. Includes correlated evidence, initiator/changed-field filters, reconstruction, retention/holds, durable export formats, unknown/failed stages and source-bound history. |
| Intake defaults | `final-reactive-intake-defaults.log`: 21 pass, 96 assertions. Defaults are 2048 observations and 512 selections/minute; the budget test accounts for two observation facts per displayed revision and view heartbeats. Explicit low/invalid limits remain enforced. |
| Source-copy/public contract | `final-facade-config-and-bounds.log`: 31 pass, 181 assertions. Copied native DataTable components browser-build through the focused public result facade. `final-curated-facade-contract.log`: 2 pass, 28 assertions; original frozen export digest/identities remain unchanged. |
| Fabric reader admission | `fabric-reader-queue-regression-second.log`: 78 pass. Real subprocess tests cover queued cancellation/deadlines, concurrent investigations, independent same-file writes/unrelated databases and closure. |
| Isolated assistant shutdown | `isolated-assistant-shutdown-regression.log`: 1 pass, 26 assertions. The full run's failing named-assistant/revocation/worker-shutdown case passes in isolation; this rerun does not erase the full run's original failure record. |
| Representative activity load | `representative-activity-load.log` and the later activity integration run: 2100 events, eight concurrent investigations, exact pinned 2000/final 2100 totals. The first run measured 11826 ms for 2000 initial appends, 184 ms median/286 ms maximum concurrent read time on this loaded workstation. This is a diagnostic workload, not a production throughput guarantee. |
| Types/docs | `final-source-types-intake.log` passes TypeScript. `final-documentation-graph-committed-source.log` reports 877 reachable unique pages and no problems before this qualification page was added; rerun the graph for the final documentation commit. |

The in-app browser bootstrap was unavailable in this session; browser evidence
comes from the repository's isolated real Chromium harness. Functional runs
without the production stylesheet were not used as visual qualification.
The final historical-dialog screenshot shows bounded content, observed duration,
ordered result selection and one grouped investigation rather than six internal
read-admission rows. Originals remain expandable supporting evidence.

## Installed Linux/amd64 Retained Upgrade

Diagnostic candidate:

- Source commit: `db4963d7029a313d9c948bf4793d21b636c0ea12`.
- Archive SHA-256: `1ae274b43a8cb7fe2e7207f682cb338a5e687837ef2b18c7fd02db67d4c8542d`.
- Archive: `/Volumes/code-bank/artifacts/zero-platform/diagnostics/audit-replacement/candidate/2.7.0/db4963d7029a313d9c948bf4793d21b636c0ea12/d70b23631459d91b5ca223c9c1f563d0c33d6c914c1107cac06d8b640ecd0d0c/zero-framework.tgz`.
- Passing deployment diagnostics: `linux-db4963d-fourth/` under the diagnostic
  root, especially `qualification-report.json`, `source-seed.log`,
  `official-build.log` and `qualification.log`.

The disposable container first installs saved main archive `534e7a0`, starts
that source runtime and creates a real signed synthetic trail. It then installs
the candidate through Bun, uses the official installed `zero build`, and starts
the resulting `dist/server.js` with retained source actors/dependencies. No
migration ledger or original event is manually rewritten.

The passing report verifies Linux x64/Bun 1.3.14, two main boots, supervised
worker retirement, no inherited synthetic provider/dotenv secrets, retained
source evidence, exact duplicate-safe replay after SIGKILL/restart, historical
result manifests/versions after restart, v2 activity export after restart,
private export integrity and mechanically ready compliance owners.

Earlier attempts remain recorded. The first used a mismatched archive filename
and failed installation. Two subsequent source preparations exposed a diagnostic
probe yielding before worker IPC bootstrap. The fixture now invokes the public
actor helper before diagnostic filesystem work, matching the documented startup
order. It explicitly permits a 30-second actor-start budget for emulated x64
qualification; it does not change production defaults or relax the handshake,
realm fingerprint, empty environment, source durability or authority checks.

The later intake-default change and final documentation/test-only commits are
not byte-identical to that candidate. Repack and verify the exact final archive;
do not reuse the candidate's checksum as a claim about another commit.

## 2026-10-30 Qualification Resumption

The source/local release candidate is being prepared as **2.8.0**, distinct from
2.7.0's workspace/UI release. Main has not yet been advanced or selected for the
normal updater. The diagnostics below are additional evidence, not a substitute
for the final committed-tree and exact-archive gates.

- Resource recovery restored development headroom without deleting application
  data or release archives. `resume-20261030-remaining.log` reruns all 37 files
  that did not pass the interrupted inventory: 34 passed and three failed.
  The failed build/scaffold and Guardian/Fabric cases came from a source
  worktree whose dependencies were symlinked to another worktree.
- The clean qualification checkout has its own script-free frozen root and
  payments installs. The separately admitted Chrome source fixture is commit
  `622ef4e4eeb2577510417d0405286c7771765fe4`, tree
  `3a512e1620c18a02bbe4d50cb9b9d569932a5295`; its prefixed Git archive SHA-256 is
  `4b61c262ecab99041b3b0c20995f2fe2c540389a7c566de85fc55bf1e0ecc59b`.
  No SDK dependencies or Git metadata were copied into the checkout.
- Commit `e951bb3` keeps declared build-asset reads on the original admitted
  FileHandle rather than creating a raw-descriptor alias. The added regression
  fails before the change and all five asset tests pass afterward. This is
  defensive admission hardening, not a claim that the shared-install native
  crash's complete cause was established or fixed by this change alone.
- The first clean run was interrupted by host sleep. Its original failures
  remain in `resume-20261030-clean-descriptor-regressions.log`; the macOS power
  log confirms idle-sleep intervals during the test window. The unchanged
  focused cases were repeated with a temporary owned sleep-prevention assertion.
- `resume-20261030-awake-clean-regressions.log` passes all four canonical files
  on Bun 1.3.14: build-app (68,677 ms), scaffold (2,799 ms), declared assets
  (112 ms), and Guardian/Fabric (27,860 ms). The runner reports four passed,
  zero failed/unrun, 96,538 ms. These include real compiled builds and the
  native Guardian/Fabric integration; they are not mocked replacements.

## Remaining Release Gates

The full canonical inventory was interrupted deliberately when the external
development volume fell below 400 MiB. Its retained summary reports 1376 files:
1339 passed, 22 failed/interrupted and 15 not run. This is **not a green full-suite
result**. Earlier missing optional local workspaces, corrected source-copy/export
contract assertions, build filesystem errors, package-test timeouts and a worker
shutdown failure must remain distinguishable. Some now have passing isolated
reruns; the remaining failures need diagnosis/rerun after resource recovery.

Do not publish/select main until:

1. Sufficient development disk space is restored without deleting source,
   application/runtime data, releases, signing identities or retained evidence.
2. Outstanding build/package, Guardian/Fabric and messaging shutdown failures
   are resolved, and the unrun exclusive/package inventory is completed under
   the normal runner. Preserve the original interrupted evidence.
3. Final source types, native browser flows, documentation graph and exact
   clean installed-archive/Linux checks pass for the final package.
4. Feature changes are reviewed/committed, pushed to both framework remotes,
   merged through the normal main workflow, and the saved main archive and
   normal `zero-update --dry-run` select the intended commit/SHA.

Application acceptance is separate. Custom joined/SQL results need the supported
receipt/action integration and domain authorization described in the adoption
guide. No framework test establishes that an application's uninstrumented custom
clinical UI now has complete semantic capture, or certifies legal compliance.
