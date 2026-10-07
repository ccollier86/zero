---
id: zero.audit.guardian-profile-qualification
type: operations
audience: [agent, maintainer]
owner: guardian
status: in-review
visibility: internal
---

# Guardian Profile Upgrade Qualification

[Audit index](./index.md) · [AuthClient](../../frontend/guardian/auth-client.md)
· [Scope transitions](../../frontend/runtime/scope-transitions.md)
· [Documentation index](../../index.md)

## Source And Release Boundary

The current implementation checkpoint is
`bfc763919aeffa43d84556d6076ea18097b2cff1`, package 2.6.0, October 7, 2026.
It contains the committed adaptive Guardian upgrade and the preserved main CLI
setup kit plus the focused closing corrections recorded below. Its complete
inventory is 944 files. The earlier 942-file candidate pass and subsequent
failed clean run are historical evidence, not this checkpoint's release gate.
Exact clean-checkout/publication gates remain pending;
this checkpoint is not yet the saved stable release or a Pantheon deployment.

This ledger records implementation evidence for the adaptive-profile upgrade.
The baseline paragraphs and earlier gates below are historical; the expanded
implementation and final release gates are recorded separately. The
session-recovery correction was checked on October 6, 2026, in
the working tree based on `55ca1e6b649f5652831714ad93749918bd92a6bd`, branch
`feature/adaptive-profile-settings`, package version `2.5.0`. The correction
was committed as `43b718a5fdf6fec4acf61524ba8d490da784e747`; at that historical
checkpoint it was not merged, tagged or published as a new release. Temporary qualification archives
are not release artifacts.

At that baseline, phone inputs, schema/form integration, read-only input behavior and MFA
settings gating were committed. Extended profile persistence,
avatar uploads/cropping, contact-possession verification, regional preferences,
required completion, first-class presence and feature-provisioning rollout
remain separate implementation stages. A proposed API or a checked plan is
not evidence that those stages are available. The historical gates below are
followed by the current expanded implementation evidence; they are not a claim
that the new services remain unimplemented.

## Session Correction

The post-rebuild recovery screen previously retried a document reload without
repairing browser credentials and the server page cookie. A temporary restore
failure could also look anonymous despite retained refresh proof, and the
automatic-attempt marker could be cleared during provisional restoration.

The correction adds bounded real credential recovery, user hydration and live
authorization before reload. Definite credential rejection reaches sign-out;
network, temporary HTTP, body/protocol and deadline failures retain proof for
Retry. Startup current-user rejection clears the newly minted page cookie
before advertising a fully signed-out result. Explicit signed-out recovery
uses the ordinary logout route. Remote cookie deletion is not promised while
the server is unavailable.

Credential-lock admission and each recovery network/body operation have their
own 15-second deadline. A timed-out queued callback cannot later adopt proof
or issue a request. Existing local Sync-baseline barriers remain separate.
Family, request epoch, mount generation and disposal fences discard late work.
Intentional sign-out retains a single pending owner through cookie cleanup.

The related live Sync correction retains retryable proof during refresh
outages while clearing and read-fencing cached rows. Definite rejection still
signs out. Older socket work cannot reset a newer read-authority epoch.

## Executed Checks

Counts are overlapping gates, not additive coverage totals. All checks used
synthetic identities, local disposable HTTP/browser fixtures and the existing
isolated browser test lease. No Pantheon accounts, live databases, environment
credentials or external providers were used.

| Gate | Executed evidence |
| --- | --- |
| Integrated focused SDK/session/controller/router tests | 155 passed, 0 failed, 717 assertions across nine files. Includes bounded lock admission, streaming-body deadlines, same-family rotation, replacement/disposal, transient failures, definite rejection, live Sync proof retention and late-epoch isolation. |
| Real browser recovery plus existing provider boundaries | 18 passed, 0 failed, 147 assertions across two files. Fifteen recovery cases use real HTTP, rotating proof, HttpOnly cookies and actual document reloads; three existing cases retain provider-boundary behavior. |
| Existing server page-session and route boundary tests | 15 passed, 0 failed, 95 assertions across three files, including actual ephemeral server page-cookie policy. |
| Independent focused UI/SDK review | No concrete blocker found; the read-only repeat passed 43 tests /177 assertions. |
| Project TypeScript | `bun --no-env-file x tsc --noEmit --incremental false` completed with exit 0 after the final session sources were frozen. |
| Diff hygiene | `git diff --check` completed with exit 0. |

Commands for the principal source gates:

```sh
bun --no-env-file test src/frontend/client/auth-session-recovery.test.ts src/frontend/client/auth-session-recovery-request.test.ts src/frontend/client/auth-client.test.ts src/frontend/client/auth-browser-coordination.test.ts src/frontend/client/auth-authorization-controller.test.ts src/frontend/client/authorization-scope-display.test.ts src/frontend/client/authorization-scope-recovery.test.ts src/frontend/client/sdk.test.ts src/frontend/router/authorization-route-boundary.test.ts
bun test src/frontend/client/session-recovery.browser.test.ts src/frontend/client/authorization-scope-hooks.browser.test.ts
bun --no-env-file test src/auth/page-session.test.ts src/frontend/server/page-session-app.integration.test.ts src/frontend/router/authorization-route-boundary.test.ts
bun --no-env-file x tsc --noEmit --incremental false
```

Source logs are under `/Volumes/code-bank/logs/zero-platform`:
`guardian-session-recovery-final-focused.log`,
`guardian-session-recovery-final-typecheck.log` and
`guardian-session-page-boundaries.log`. Browser test results are also reported
by their source fixtures; this ledger does not invent an archive identity.

## Reusable Profile-Settings Presentation

The follow-up source based on `43b718a` adds
[Avatar Group](../../frontend/components/avatar-group.md),
[Settings Matrix](../../frontend/components/settings-matrix.md) and
[Integration Settings List](../../frontend/components/integration-settings-list.md).
These reuse Zero primitives, tokens, lifecycle guards and observability.
They do not implement connected profiles, avatar upload/cropping, verification,
notification delivery, OAuth providers or first-class presence persistence.

Executed against the final frozen component source on October 6:

| Gate | Evidence |
| --- | --- |
| Combined helpers/SSR/controllers/real browser | 57 passed, 0 failed, 318 assertions across eight files. This includes 24 styled-browser cases; the counts overlap family-specific gates below. |
| Avatar family | 11 tests /65 assertions; optional add/count actions, disabled presence, keyboard/touch, stable member keys, square rings, tokens, RTL and reduced motion. |
| Matrix family | 28 /118; controlled unavailable/read-only choices, pending/retry, per-cell locks, scoped cancellation, live boundary admission before notification, keyboard/320px/tokens and both control variants. |
| Integrations family | 18 /135; flat/grouped keys, read-only and live capability retirement, confirmed destructive actions, menu/dialog focus, safe error callbacks, long-copy/narrow/RTL geometry and inherited theme metrics. |
| Fresh installed temporary package | 1 /16 after source freeze; root/React/focused export identity, actual browser build, DOM-free SSR, included guides/notices, session-recovery method and disabled presence. No exact release/archive identity is inferred. |
| Project TypeScript | Final integrated `tsc --noEmit --incremental false` completed with exit 0, including the final browser fixtures and public facade types. |
| Actual UI Markdown examples | The public-source fragment compiler passed 1 test /66 assertions, including both avatar examples and the matrix/integration examples. It does not execute app callbacks. |
| Documentation navigation and catalog placement | 724 pages/IDs/reachable with zero problems; 963 catalog records assigned to 157 existing guide homes with zero problems. These are coverage/navigation measures, not release qualification. |

Review corrected new-component issues before release: overlapping menu/dialog
focus and pointer-lock cleanup, long-label mobile overflow, a native HTML
`contextMenu` type collision, and flat/named-group key identity. Theme metric
defaults use inherited public variables rather than shadowing parent values.
Matrix's live SDK getter is defense-in-depth: ordinary notified transitions
did not reproduce stale admission, while the stronger before-notification
regression verifies its new fence. None of these is a claimed old-release defect.

Root inspected settled avatar light/dark, matrix light/mobile and integration
desktop-menu/mobile screenshots under the designated external diagnostics root.
Logs: `guardian-profile-ui-final.log`, `guardian-profile-ui-final-package.log`
and `guardian-profile-ui-final-typecheck.log`. Installed consumers and browser
fixtures are disposable synthetic checks, not application migrations.
Documentation logs: `guardian-profile-ui-final-examples.log`,
`guardian-profile-docs-check.log` and `guardian-profile-catalog-homes.log`.

## Expanded Guardian Services And Settings

The historical working source based on `ae85a4b6efe11eeb74ab89b15ed02a23e982c59f`
implements typed own-profile and regional settings, separate contact-possession
ceremonies, private staged/cropped avatars, restricted first-use completion,
shared acknowledged save/leave interactions and SDK-owned presence. These are
uncommitted feature-stage changes at the time of those checks, not a released
version. They are now committed in the checkpoint identified above; the guides
retain explicit source/release boundaries:

- [Own profiles](../../backend/guardian/user-profiles.md),
  [contacts](../../backend/guardian/contacts.md) and
  [avatars](../../backend/guardian/avatars.md).
- [Required completion](../../backend/guardian/profile-completion.md) and
  [presence](../../backend/guardian/presence.md).
- [Adaptive settings](../../frontend/guardian/profile-settings.md) and
  [save/leave composition](../../frontend/forms/save-and-leave.md).
- [Post-bootstrap opt-in upgrade](../../guides/upgrade.md#opting-into-adaptive-profiles-after-provisioning)
  and [read-only Doctor inspection](../../cli/doctor/infrastructure-inspection.md).

SYSTEM migrations039–043 install exactly validated private schemas. They do not
let a browser run DDL, drop disabled fields or activate an optional service with
`migrate: false`. Bootstrap installs the current generation-bound feature policy;
overlapping retired runtimes cannot write an old editable policy, and A→B→A does
not reactivate the original A runtime. Required-completion policy adoption is
atomic with this generation. The ordinary account/session lifecycle remains
separate from the optional-feature policy guard.

Avatar writes recheck actual live authority after provider I/O and normalized
raster decoding. Immutable private receipts and shared profile revisions prevent
an old upload from replacing a newer profile. Cancellation and shutdown retain
tracked cleanup work rather than abandoning provider writes or deleting the
current avatar. The custom-provider settlement limitation is explicit in the
avatar guide; these tests do not promise forced cancellation of external I/O.

Presence uses an actual SYSTEM owner/outbox and admitted Fabric SQL projection,
including owner epochs, freshness and before-use barriers. The browser uses one
SDK tracker rather than per-avatar heartbeats. Presentation browser fixtures
and live Gateway/Fabric integration fixtures are distinct evidence levels.
Notification and integration organisms remain controlled UI contracts; app-owned
delivery/OAuth services are not newly invented Guardian endpoints.

| Focused gate | Executed evidence |
| --- | --- |
| Shared profile-policy, contact, completion, migration and Doctor boundary | 127 passed /742 assertions across ten files; final exact policy-schema/Doctor repeat21 /132. Actual HTTP and multiple isolated Guardian bootstraps prove delayed proof rejection, stale writer rollback and A→B→A retirement. |
| Avatar image/store/HTTP plus adjacent Storage/native boundaries | 74 passed /638 assertions across ten files. Actual private raster processing, retirement during provider I/O, lease/cleanup, upload-grant commit fences and explicit native ceilings; log `guardian-avatar-storage-boundaries-final.log`. |
| Profile/contact/avatar styled UI | 32 browser cases /171 assertions, including actual crop preview and 320px light/dark layout. Combined unit50 /211 and transport15 /59 were separate overlapping gates. |
| Presence UI/SDK/activity/AvatarGroup | 24 passed /141 assertions across four files, including styled browser cases and standalone320px light/dark public-token overrides. Real SDK owner/hooks with synthetic scoped receipts; no claim that this UI fixture is a live Gateway. |
| Required-completion source/HTTP/browser | Backend26 /215 plus adjacent112 /928; final frontend gate17 /115 includes required-only field rendering, actual HTTP/browser, CAS review and scope replacement. Continuation proofs remain out of URL/storage and the final writer retains session/MFA/native/tenant fences. |
| Presence service/Gateway/Fabric | Reproduced current pure service/store gate15 /124; actual Fabric subprocess gate4 /30; managed HTTP/WebSocket gate4 /63 exits successfully on Bun1.3.14. Actor reads expose a usable stable-ID cursor, and include same-scope bounded paging/isolation. Earlier summary-only counts without a retained successful log are not included. |
| Ordinary/replacement refresh bounds | 120 passed /658 assertions across five files. Held headers/body, lock admission, replacement before notification, disposal and late-result retirement. |
| Application-owned page-cookie HTTP/native/router/first-use | 111 passed /936 assertions across nine files. Actual two-app browser isolation, validated legacy migration, canonical precedence and disk-backed namespace stability. |
| Current recovery and actual persisted restart browser | 18 passed /144 assertions. Same-origin SYSTEM close/reopen preserves valid sessions; explicit server invalidation reaches usable login. Neither path paints stale loaders or requires manual cookie clearing. |
| Final shared keyboard hints and strict avatar parsing | 21 passed /135 assertions, including five styled browser cases. Compact upstream metrics, public token overrides, actual Tooltip composition and no-coercion enum guards; actual Markdown examples1 /75. |
| Final frozen Guardian backend | 247 passed /1892 assertions across32 files, including configuration, generation policy, profiles, contacts, required completion, avatars, page cookies, migrations, Doctor and presence/Sync/Storage boundaries; log `guardian-final-backend-freeze-complete.log`. |
| Table page-size position | Focused43 /149 across six files, including21 styled browser cases; whole table family107 /372 across18 files. Local/complete-collection/offset anchors, explicit cursor reset, shrinking counts, controlled selection and source/auth/query resets; logs `table-page-size-final2.log` and `table-page-size-all-table.log`. |
| Relocated native avatar builds | 12 passed /110 assertions across deployment, native-loader and raster tests. Actual managed registration, staged PNG upload, private 64×64 WebP finalization/delivery work without application/plugin/node_modules sources, for JavaScript and executable builds. Disabled fixtures launch without the optional payload. Host macOS ARM64 only; not every platform. |
| Doctor project-root admission | Full Doctor family: 117 passed /421 assertions across 12 files. Mismatched explicit roots refuse inspection, canonical aliases remain supported and source walking follows the app config. The proof's separate configuration-only fixture passes 1 /24 without creating seven runtime paths or touching retained example databases. |
| Durable Sync revocation and Torrent proof | Final focused gate: 9 passed /50 assertions across three files, including the authenticated Guardian/Fabric/Torrent proof. Before-use revocation closes both stale sockets; a fresh authorized subscription sees no rejected write. |
| Browser fixture lifecycle | HoldButton and table-search cases pass together: 16 /49. Manually advanced animation-frame fixtures use timer polling so their own assertions do not add frames and deadlock. This is a test-fixture correction, not a production timing change. |
| Append-only current migration registry | Full family: 137 passed /990 assertions across44 files. Pins extend through043 and both new version-local helpers; released001–038 bytes and existing helper pins are unchanged. Import inspection distinguishes erased type declarations from mutable value imports. Historical upgrade fixtures retain their named target rather than assuming an obsolete registry tail. |
| Source-copy helper and storage inspector contracts | Canonical three-file gate23 /115 proves the public browser-safe query-helper subpath and copied DataTable state/server adapter. Styled storage gate6 /55 retains scope retirement and permission checks while supplying the updated shared editor fixture contract. |
| Native completion admission and durable local-updater rollback | Canonical six-file gate52 /437; three additional real updater concurrent repeats8 /169 each. New profile-completion guards remain mandatory; local rollback rebinds the restored archive through targeted frozen Bun update, and a subsequent ordinary frozen install retains old installed bytes/dependency graph plus unchanged app/manifest/lock/archive. Synthetic caches stay populated and private to each fixture. |
| macOS compiled admission and native avatar deployment | Current four-file gate23 /162 includes strict signature checks before/after relocation, actual enabled/disabled compiled app startup, private image normalization/delivery, JIT, and bounded signing-command kill/reap with safe observability events. This is host macOS ARM64 qualification, not Developer ID signing, notarization or cross-host Gatekeeper acceptance. |
| Project TypeScript | Full project checks exited0 after shared-policy and page-cookie source freeze. Final component/package/release checks still follow. |
| Documentation navigation | Final732 pages/unique IDs/reachable and995 catalog records/165 existing homes, zero problems. All452 inventoried feature groups across37 systems have a drafted destination. Navigation validates structure, not source accuracy or artifact contents. |

Logs are under the designated external diagnostics root. Principal additional
logs: `guardian-profile-policy-final.log`,
`guardian-profile-policy-schema-final.log`,
`guardian-profile-policy-typecheck.log`,
`profile-contact-avatar-qualification-browser.log`,
`profile-contact-avatar-unit.log`,
`page-cookie-final-qualification.log`,
`session-recovery-current-final-browser.log` and
`page-cookie-restart-final-typecheck.log`.
The reproduced presence commands are recorded in
`guardian-presence-bun-hash-final.log`,
`guardian-presence-real-fabric-final.log` and
`guardian-presence-managed-http-final.log`.

## Deployed Pantheon Incident Boundary

The user reports the recovery screen on `pantheon.collabmd.com`, not localhost.
These tests reproduce independent framework recovery/lifecycle defects and
qualify their fixes; they do not identify the deployed build or prove the live
incident's root cause. A credential-free production check returned a Cloudflare
Tunnel530 response, so no application-session response was inspected. No live
deployment, app configuration, account or database was changed. A local installed
package version is not evidence of the production deployment's version.

## Remaining Release Gates

Before publication, record the clean implementation commit, rebuilt archive
identity and installed-package/production-hydration evidence. Keep the profile
and presence feature qualification separate from this session correction.
The source tests above do not qualify every Guardian/Fabric mode or every
unrelated frontend feature.

The first whole-suite attempt did not qualify the release. The parallel command
used Bun's default five-second test timeout: an argument appended to the chained
root script only reached its final actor phase. Native work timed out, a Bun
worker crashed and hundreds of queued files were consequently aborted. Other
real build, Doctor and fixture failures were addressed above. The parallel
command now declares its own bounded 120-second integration timeout; explicit
shorter deadlines and timing assertions remain unchanged. A focused native
worker repeat passes 11 /63 without a crash, but the whole suite and exact clean
release still need their own successful runs. Do not count aborted files as
hundreds of independent defects or treat the focused repeat as a full-suite pass.

The corrected-timeout whole-suite attempt also did not qualify the release:
3,310 cases passed, seven were skipped and 458 were failed/aborted after native
worker failures. Matching macOS reports show two separate signatures: a guarded
file-descriptor close in the long-lived presence worker and a pointer-authentication
trap in a nested Worker during durable ownership qualification. Sharp/libvips
were not loaded in those two faulting processes. Earlier native history includes
a direct zvec addon crash; no single timeout explanation covers all three.

Fresh presence HTTP/Sync runs pass both normally and with four Bun test workers
(4 cases /63 assertions each). A framework-free raw `bun:sqlite` nested-worker
probe can fail even without Zero or broad-suite carryover. The qualification
correction therefore retains real concurrent SQLite ownership assertions using
two independent Bun subprocesses, matching Fabric's process architecture, and
runs the whole inventory in bounded fresh per-file processes. No production
SQLite policy or encoded Bun minimum changes; no affected file is omitted,
crash retried into a pass, or concurrency assertion changed into sequential
acquisition. Those changes still require their own successful full-run evidence.

### Fresh-Process Whole-Inventory Check, October 7

The canonical per-file process harness passes two focused checks (18 cases /
3,663 assertions each), including interruption, inherited output pipes and
owned-process-group retirement. A separate concurrent real subset passes the
HoldButton, table search, managed presence HTTP/Sync and durable Torrent-owner
files. The durable ownership fixture retains the original fifteen cases and
adds six harness cases; its final serial and four-process checks pass 21 /96,
with three additional complete concurrent repeats. No production SQLite policy,
assertion of concurrent acquisition or encoded Bun requirement was relaxed.

The first canonical complete run executed all 937 discovered files exactly once:
929 passed, eight failed, zero were aborted/not run and no file process crashed.
It exited1 and **does not qualify the release**. The failures were:

- Source-copy imports for DataTable helpers lacked a supported package path.
- The native-session and storage browser fixtures omitted newly required mock
  methods/exports. Production admission guards remain mandatory.
- Historical migration checks assumed an old registry tail; the import regex
  also incorrectly combined a local value import with a later type-only import.
  New migrations039–043 and their local schema dependencies need append-only
  source pins; already released migration hashes must remain unchanged.
- The matching-override/workspace-peer updater fault check restored manifest,
  lock and archive bytes but observed the replacement installed package after
  its staged-install failure. Installed-tree rollback remains a required gate.
- One relocated compiled executable never evaluated its entry within its
  admission deadline. Exact host AMFI/SystemPolicy logs rejected its signature;
  other compiled cases passed. A later same-binary diagnostic launch succeeded,
  which is useful diagnosis, not a retry into a release pass.

Principal evidence: `guardian-2.6-full-process-suite.log`,
`test-suite-harness-focused-final2.log`,
`test-suite-harness-focused-final-repeat.log`,
`test-suite-real-four-file-subset.log` and
`compiled-same-binary-admission.log`. Corrections need focused qualification,
then another complete frozen-source run and the clean-checkout release gates.

The local updater investigation subsequently separated two issues. Parallel
synthetic archives initially selected another fixture's package from Bun's
shared locator-keyed extraction cache, before the updater captured its baseline.
After strict initial archive/installed admission and per-fixture retained-cache
isolation, a stronger matched-fixture check reproduced a real recovery defect:
an ordinary frozen reinstall after rollback selected that fixture's new payload.
The targeted local rollback rebind above repairs this qualified path without
deleting global caches or changing original manifest/lock/archive bytes. It does
not claim to fix Bun's general concurrent local-archive cache behavior.

Additional evidence: `guardian-2.6-migration-family-final.log`,
`source-copy-query-subpath-isolated.log`,
`storage-studio-boundary-fixture-focused.log`,
`guardian-native-updater-final-process.log`,
`guardian-update-rebind-process-repeat-1.log` through `-3.log` and
`guardian-native-build-signed-final.log`.

### Closing Review

The backend review reproduced retained profile/contact handles accepting edits
while an earlier worker drain was pending. Both domains now retire admission
synchronously before the first shutdown await. After retirement their retained
handles fail with typed unavailable errors, not a cleared-guard TypeError. An
already pending trusted phone verifier may settle, but its result cannot attach
proof after retirement. Existing admitted recovery work still drains.
The completion inspector also checks retirement before entering a UserStore
transaction or touching the raw database. A valid retained continuation stays
unconsumed, with unchanged profile revision and no issued refresh token, during
held drain and after the service graph has been cleared.

The focused real shutdown/profile/contact/completion check passes 44 cases /
356 assertions (`guardian-profile-contact-shutdown-final.log`), and the final
policy/provenance/schema admission check passes 25 /175
(`guardian-backend-closing-admission.log`). These focused gates overlap earlier
family counts; they are not an additional whole-suite claim.
The independent completion/disposal/lifecycle repeat passes 24 /212
(`guardian-auth-feature-retirement-review-final.log`). The new updater byte
comparison uses Bun byte reads/deep equality; its canonical five-file repeat
passes 43 /377 (`guardian-update-bun-bytes-final-process.log`).

Frontend closing review also reproduced a correctable username conflict being
mistaken for a stale revision, foreign-account profile receipts being admitted,
and a Retry request racing policy reload. The correction retains the shared
revision-conflict classifier, full account/scope receipt fences and sequential
policy/data retry. Avatar accepted-notification promises are observed without
turning an accepted media mutation into a failed/repeated write; late retired
callbacks cannot report into the replacement scope. Inline pending indicators
respect reduced motion. Exact source-copy/public-path checks remain part of
final qualification rather than assuming an import from the broad React facade
exists.

The final frontend closing source gate passes 38 actual styled profile/browser
cases /216 assertions, nine inline-edit browser cases /24, and 29
unit/schema/transport cases /132. The complete source-copy file passes
11 /101; the seven public-export browser cases pass too. Evidence:
`closing-profile-full-browser.log`, `closing-inline-edit-motion-browser.log`,
`closing-profile-final-unit.log`, `closing-source-copy-full-file-final3.log` and
`closing-package-exports-full-file.log`. The exact generated DataTable fixture
failed with Bun's in-test resolver but built with a fresh consumer Bun process;
the copied broad-React build checks now use that bounded real consumer boundary.
All original copied-source/import assertions remain in place, with no production
resolver workaround, skip or retry into a pass.

Final complete frozen-source and exact clean-checkout evidence is still required
before publication. This review does not claim to qualify every unrelated
platform subsystem or resolve the live Pantheon incident without deployment.

### Second Complete Candidate Run

The corrected candidate's full typecheck and package gate pass. The package gate
includes 54 cases /4,057 assertions, the two real updater files8 /169, the
packaged Fabric schema-loading startup, and the Cascader/SignaturePad/group-menu
archive consumers. Principal logs are
`guardian-2.6-frozen-candidate-typecheck.log` and
`guardian-2.6-frozen-candidate-package.log`.

The second complete fresh-process run executes all 940 files exactly once:
939 pass, one fails qualification, zero are not run/aborted and no file crashes.
The SQLite persistence file exits0 but is marked `outputIncomplete`; the final
output is not fully admitted by the runner. This is not a complete green result
or proof that missing output is harmless. Retain the run for diagnosis and
qualify the output boundary before the exact clean release run. Evidence:
`guardian-2.6-frozen-candidate-full.log`.

A separate manifest review confirms the updated docs reader statically imports
the new shared keyboard hints. Its declared framework floor must therefore be
2.6.0, not 2.5.0, and the optional preview plugin needs its own new patch identity.
Normal framework updates do not replace an application's independently installed
docs plugin. Historical 2.5.0/plugin0.1.0 artifact identities remain historical.

The optional plugin's corrected 0.1.1/2.6.0 pair passes installed qualification
2 cases /141 assertions, five actual compiled-reader browser cases /51 and
the source reader/SSR/browser/title check20 /121. Its archive identity is
derived from actual declared/packed/installed manifests and provenance; it is
not inferred from a stale hardcoded version. These are still candidate archives
from a dirty checkout. Logs: `docs-plugin-0.1.1-installed.log` and
`docs-plugin-0.1.1-reader.log`.

The single incomplete-output result has not reproduced in finite focused
checks and its cause remains unknown. The runner now reports payload-free
per-channel read/EOF/sink progress on an incomplete result. Its strict one-second
drain, failure, cleanup and no-retry rules are unchanged. The diagnostics gate
passes22 /3,684 (`runner-output-diagnostics-final-focused.log`). Passing focused
probes does not reclassify the original failed run as green. The log's NUL byte
was a legitimate unsafe-route test name, not evidence of output corruption.

### Third Complete Candidate Run

The next complete fresh-process run executes all 940 files exactly once:
938 pass, two fail, zero are not run or aborted, and no file crashes. The earlier
incomplete-output result does not recur in this run; its original cause remains
unresolved. This run still does not qualify the release.

The group/context-menu and adaptive-profile installed-package tests both finish
their functional assertions and emit archive qualification before exceeding
their existing 120-second test deadlines while removing their newly allocated
consumer directories. The group fixture retains its external package provenance;
the profile fixture reports the same frozen candidate archive hash. Cleanup is
part of the test lifecycle, so completed feature assertions do not turn these
timeouts into passes. Retained failure evidence and disposable fixture ownership
are being inspected before any correction. No deadline increase, skipped
assertion or automatic retry is used to qualify the candidate.

Evidence: `guardian-2.6-final-candidate-full.log`. The matching full TypeScript,
build, dependency audit and four public Markdown-example checks pass separately;
they do not replace the failed complete-suite gate.

The final consistency scan found one additional finite-read gap in the new
first-use completion transport. Its inspection and completion calls now reuse
the existing bounded request owner for both response headers and JSON bodies,
with a 30-second default. Timeout or cancellation leaves the current restricted
proof and draft available for explicit inspection/retry; it is not evidence
that a server mutation did not commit. No automatic replay or optimistic
credential acceptance is added, and replacement still retires late results.
The narrow source gate passes 32 cases /226 assertions, including thirteen new
held-header/body, cancellation, replacement and explicit-retry regressions.
Evidence: `profile-completion-bounded-final-focused.log`; the corresponding
documentation structural check still reports 732 reachable pages, zero problems.
These changes require the next complete candidate run; they do not alter the
recorded outcome of the third run.

Fresh-owned copies of the retained package fixture graph do not reproduce an
asynchronous-removal defect: in-process async, isolated-child async and
isolated-child synchronous removal all complete in approximately 0.36–0.61
seconds once warm. Cold/shared I/O varies substantially, and the failing full
run spent roughly 92–98 seconds in functional package qualification before
cleanup. The correction therefore bounds concurrent admission of the ten
reviewed full-framework pack/install/compile consumers instead of replacing
cleanup, increasing deadlines or retrying tests. Ordinary files still run in
parallel with up to four total fresh processes.

The focused scheduler/catalog/options gate passes 20 cases /142 assertions.
The real four-file mixed gate passes all four files, ten cases /57 assertions:
group/menu47.830s, phone42.958s, profile66.933s and ordinary exports6.918s.
Actual ordinary exports run alongside the first package consumer, and the
installed consumers do not overlap. Awaited recursive cleanup remains part of
the passing tests. Evidence: `guardian-package-cleanup-copy-probe.log`,
`guardian-package-resource-scheduler-focused.log` and
`guardian-package-resource-mixed-final.log`. The added resource-catalog test
raises the next complete inventory to 941 files. These focused passes do not
reclassify any earlier failed full run as qualified.

### Fourth Complete Candidate Run

After the final completion and resource-admission corrections, full TypeScript
and `test:package` pass again. The next canonical run executes all 941 files
exactly once: 940 pass, one fails, zero are not run or interrupted, and no file
process crashes. Both formerly timing-out installed consumers pass with their
ordinary awaited cleanup: group/menu58.285s and profile88.953s. The SQLite
output check also passes; the original incomplete-output failure remains
historical and is not silently reclassified.

The one remaining failure is the actual macOS compiled/JIT signing test. Strict
signature verification succeeds, but the freshly compiled process does not
exit within its existing 20-second launch bound and is killed by its owned
deadline. Host logs show that exact process waiting in ASP security admission;
the terminal policy-denial entry follows interruption by the test's SIGKILL.
The same ad-hoc AMFI warning also occurs in an earlier successful case, so it
does not establish a malformed signature. A concurrent policy-service network
timeout has no proven link to this process. The fixture already removed its
binary, preventing exact-binary inspection. A separate bounded retained probe
is being prepared; no production signing change or deadline increase is
justified by these observations alone.

This run exits1 and does not qualify the release. Evidence:
`guardian-2.6-closed-candidate-typecheck.log`,
`guardian-2.6-closed-candidate-package.log` and
`guardian-2.6-closed-candidate-full.log`. No merge, tag, publication or Pantheon
update has occurred.

The single retained standalone probe executes the expected JIT result in
802.73ms with a strictly verified ad-hoc signature. It compiles to a fresh
nonexistent output, unlike the actual fixture's prewritten placeholder; that
parity difference is recorded in its provenance. It does not reproduce,
resolve or replace qualification for the failed actual test. The artifact is
`mac-admission-probe.Kb2xfd` under the external diagnostics root.

The actual native test now fixes the evidence-loss gap: failed binaries are
retained by rename with exact source snapshots/hashes, signature/xattr data and
bounded captured-process observations. Sampling requires the captured live PID
and exact executable path; diagnostic errors preserve the original failure.
Passing fixtures still clean up normally. The placeholder, JIT assertions,
strict verification and hard 20-second launch bound are unchanged. No signer,
host-policy setting, quarantine, retry or success criterion changed. Helper
regressions pass5 /34 and the actual signing/native file passes6 /16, recorded
in `mac-native-fixture-diagnostics.log` and
`mac-native-signature-fixture-focused.log`. These are focused checks, not a
reclassification of the failed fourth run. The added fixture regression file
raises the next complete inventory to 942.

### Fifth Complete Candidate Run

The frozen candidate passes the complete fresh-process inventory: all 942 files
run exactly once, 942 pass, zero fail or remain unrun, zero are interrupted,
and the runner exits 0 after 615,315 ms. The actual macOS compiled/JIT signing
case passes within its unchanged 20-second launch bound. Neither the earlier
incomplete-output result nor either installed-consumer timeout recurs. No file
is retried, excluded or admitted as a pass after a failed assertion.

Evidence: `guardian-2.6-retained-candidate-full.log`, completed October 7, 2026
at 08:11:32 UTC, and the final full TypeScript gate
`guardian-2.6-retained-candidate-typecheck.log`. The matching package, build,
dependency-audit, PDF-readiness and public Markdown-example gates also pass
in `guardian-2.6-closed-candidate-package.log`,
`guardian-2.6-closed-candidate-build.log`,
`guardian-2.6-closed-candidate-audit.log`,
`guardian-2.6-closed-candidate-pdf.log` and
`guardian-2.6-closing-markdown-examples.log`.

This qualifies the frozen implementation candidate, not publication. The
earlier macOS admission delay and incomplete-output cause remain unknown;
their failed runs remain recorded above. Implementation commit, preserved-main
merge, final documentation metadata, exact clean-checkout qualification,
tag/push, committed-main archive refresh and the stopped normal-updater smoke
are still required. No live Pantheon app, credentials, database, configuration
or deployment was changed.

### Documentation Freeze

The final documentation pass reviews 58 canonical pages against the committed
implementation checkpoint `c5656b306051b04ec6adc641b7057a0672fd7a3e`.
All retain internal visibility: 52 describe supported capabilities, two are
planned roadmaps and four describe the separately versioned optional docs
preview. Twenty-five focused guides record implementation-verified evidence;
33 broader guides record source-observed evidence. Their example code fences
are byte-identical to the qualified implementation checkpoint.

The structural check reports 732 pages, unique IDs and reachable pages with
zero problems. Catalog placement reports 995 records in 165 existing homes;
all 452 feature groups across 37 systems have guide destinations. Review-evidence
regressions pass six cases /27 assertions. The one inbound MFA link changed
with its stable heading, and obsolete working-source phone/MFA anchors are gone.
No runtime source, test or example-code contract changed in this pass.

The next frozen commit must still pass exact clean-checkout qualification and
publication. Artifact-specific identities and completion evidence are recorded
in the external release/provenance records; never infer a deployed Pantheon
fix from a documentation review or a source-only checkpoint.

### First Exact Clean-Checkout Run

The detached clean checkpoint
`f55c5ccce17d12d886f3e6fc53f99a74b8a94416` passes its frozen install,
TypeScript, build, dependency audit, PDF readiness and full package gates. Its
complete inventory is 942 files, including ten tests from the separately
recorded clean Chrome preview fixture. The clean package includes the preserved
CLI kit; its retained inspected archive has 4,270 entries and SHA-256
`c003dc016f1b64e66b1f3260f4f1723ade1e23f2e40eaec55970912139673592`.

The complete clean run nevertheless fails: 936 pass, six fail, zero are unrun
or interrupted, exit 1 after 660,428 ms. Evidence is
`guardian-2.6-clean-full.log`. The actual compiled/JIT signing case passes;
this does not resolve the older host-admission delay.

The inline-cell test observes error state before authoritative reload and
deferred focus finish. Inspection also identifies a real missing generation
check inside queued cell navigation. The clause-initials test reads immediately
after scheduling its controlled React list update. Their intended assertions
must be preserved while observing the actual asynchronous completion.

The temporal-control test exits 0 but its stderr drain remains inside the CLI
output consumer for 1,014 ms, so the unchanged one-second boundary correctly
fails it. A finite concurrent/serialized/native-sink probe does not reproduce
that stall; it is not evidence of a proven Bun concurrency defect or an
explanation of the older SQLite output result.

The compiled-avatar fixture can convert an existing but not yet populated
entry-marker file into timestamp 0 and an already-expired deadline. Retained
file timing matches that race, but the exact partial bytes read were not
recorded. Fix marker admission without increasing startup deadlines. Doctor
file inspection and the system-runtime migration fixture also fail; the latter
times out and reports a later SQLite vnode I/O error during cleanup. Their
causes still require diagnosis, not an assumed permission/schema defect.

Publication remains held. No tag, push, saved-package refresh or live Pantheon
update is inferred from the earlier candidate pass or clean package checks.

### Focused Corrections After The Clean Run

The cell repair checks the edit generation inside each deferred interaction,
including accepted saves and rejected saves awaiting authoritative reload. A
held-animation-frame regression fails against the earlier implementation and
passes with the repair: a later edit cannot be navigated away by the older
accepted save. The original failure assertion now awaits actual reload/focus
completion instead of treating the earlier error-state publication as its
acknowledgment. Styled browser checks pass nine cases /54 assertions; related
temporal/unit/SSR checks pass 41 /135. Evidence:
`data-studio-inline-focus-generation-red2.log`,
`data-studio-inline-focus-generation-green.log` and
`data-studio-inline-focus-temporal-unit.log`.

The signature-clause fixture now waits for React's controlled-list render
acknowledgment before reading its completion counter. Its original counter
assertion remains, with added exact item-count and submitted-field checks.
The complete styled signature browser file passes 33 cases /177 assertions in
`guardian-signature-committed-view-focused.log`. No production signature
behavior changed.

The historical SYSTEM fixture had executed each migration's DDL in autocommit,
unlike the production Migrator's per-migration transaction. Its unchanged
isolated migration030 case passes; the complete file previously timed out under
the clean run's combined cold-I/O pressure, with a later vnode cleanup error.
The fixture now uses the existing synchronous-handler boundary and one immediate
transaction per unchanged historical migration. A new failure regression proves
the failed migration rolls back while the preceding committed prefix remains.
No PRAGMA, deadline, migration contents or production admission changed. The
complete file passes eight cases /100 assertions in
`guardian-system-prefix-atomic-focused.log`; the isolated diagnostic remains in
`guardian-clean-workflow-prefix-diagnostic.log` and is not a replacement for
complete qualification.

The synthetic compiled-startup marker is published atomically and admitted only
as a canonical safe timestamp inside that child's startup window. Diagnostics
retain the actual PID, start time and marker admission. Compiled admission stays
60 seconds; app startup stays 20 seconds. The focused helper/build gate passes
nine cases /119 assertions, including the real relocated enabled-avatar
executable and two independent compiled-docs deployments, in
`guardian-build-readiness-marker-final-focused.log`. This repairs a concrete
fixture parser/publication gap, not a proven macOS AMFI cause or a retrospective
explanation of every earlier native delay.

Private fixture paths now honor the qualification host's temporary root rather
than requiring a workstation-specific mounted volume. Existing local artifact
storage is reused only when already present; other hosts have a dedicated
temporary diagnostics fallback and explicit absolute overrides. Cleanup rejects
broad/unrelated paths and symbolic-link directories. The portability/helper
gate passes ten cases /75 assertions in
`guardian-private-fixture-portability-final.log`, retaining the original
binary-inode/error-identity and captured-process checks.

Doctor's failure is reproduced using only native `bun:sqlite`: explicit
`PERSIST_WAL=0` removes sidecars on final close, after which this host rejects
read-only reopening with `SQLITE_CANTOPEN`. Earlier isolated passes depended on
deferred statements retaining a writer and its sidecars. The test's unconditional
schema-readiness assertion therefore assumed native availability it did not
establish. Production Doctor and global WAL cleanup policy are unchanged.

Coverage now preserves the original closed-file byte/schema/row/corruption
assertions on a strictly closed readable rollback-journal fixture. A separate
live-WAL test proves a committed marker present only in WAL is inspected while
main/WAL bytes and writer change counts remain exact. A missing-sidecar test
checks actual native admission: a rejected read yields the truthful unavailable
warning and no invented feature-schema or policy findings; a readable native
file must yield actual missing-schema findings. The full twelve-file Doctor
family passes 119 cases /438 assertions in
`guardian-doctor-readonly-admission-family-final.log`. The native reduction stays
in `guardian-doctor-native-closed-wal-persist0.log`. Canonical and legacy guides
state the limitation and safe handle/runtime alternatives; no read-write,
immutable, no-lock or main-file-only snapshot fallback was introduced.

Runner CLI output now owns one native Bun sink per standard descriptor and one
serialized record lane, awaiting native write and flush as well as final close.
Monotonic elapsed-time checks reject synchronous completions which overran the
unchanged one-second boundary before timers could execute; JavaScript cannot
preempt the synchronous call itself. Queued work cannot publish after retirement.
Native Unicode/merged-output and held-FIFO regressions preserve complete output
and bounded failure without leaving owned processes alive.

A real large-Unicode probe disproves a proposed byte-count equality check:
native write reports short progress while its internal buffer delivers all
bytes. The implementation therefore awaits write/flush and never resubmits a
suffix or misclassifies buffered progress as lost output. Five focused runner
files pass 37 cases /191 assertions; their output is saved as an explicitly
labeled captured-tool transcript in
`test-suite-console-writer-focused-transcript.log`, not represented as an
original redirected process log. Integrated TypeScript catches one test-only
`toSorted()` call outside the existing library target; copied-array `sort()`
preserves its exact comparison without widening compiler settings. The final
writer file then passes sixteen cases /48 assertions in
`guardian-console-writer-types-final-focused.log`, and integrated TypeScript
passes in `guardian-2.6-closing-corrections-typecheck-final.log`.

The closing inventory is 944 files, including the same ten separately recorded
Chrome preview cases. Documentation structure remains 732 pages with zero
problems and whitespace checks pass. None of these focused passes constitutes
the complete clean-checkout release gate or a native-runtime fix claim. The
next committed source must still complete the package/full/build/audit gates
before publication and the stopped normal-updater proof.

### Second Exact Clean-Checkout Run

The detached clean checkpoint
`ef2f7a3f74d914d371698a67c4055efe42cfc390` passes its frozen install,
TypeScript, build, dependency audit, PDF readiness, documentation structure and
complete installed-package gates. Its inspected archive has 4,274 ordinary
entries, every one byte-identical to tracked source, SHA-256
`ea761a601dfaadea3e6c84de1d1b4172d835542f0a5416c9b8bc701c9e416022`.
Manifest, declared exports/private imports, CLI kit, migrations/helpers,
styles and guides are present, without runtime/credential payload. The same
archive identity is reported by the final installed group/menu consumer.

The complete 944-file run finishes with 943 passing, one failing, zero unrun or
interrupted, exit 1 after 651,863 ms. Evidence is
`guardian-2.6-final-clean-full.log` and the external exact-source qualification
receipt. All six failures from the first clean run now pass. The sole failure
is the existing mobile workspace test reading the Record tab immediately after
the return button becomes visible.

A deterministic held-frame proof establishes the lifecycle: the return control
is outside the keyed detail transition and can be visible while the outgoing
table-only inspector still has a disabled, unselected Record tab. Releasing
normal frames admits the new selected Record pane and exact accepted value.
The test now acknowledges that actual pane before its unchanged assertion and
adds the held-exit regression. The focused complete workspace passes seven
cases /33 assertions in `data-studio-workspace-acknowledgment-final.log`, with
the separate proof in `data-studio-workspace-held-exit-isolated-proof.log`.
Organization replacement remounts the workspace boundary; this is not
permission to animate stale cross-organization contents.

The initial proof attempt encounters a separate in-process broad-graph build
failure for two tracked, present relative targets. Their existence/hashes and
the failure are preserved in `data-studio-workspace-build-targets.log` and
`data-studio-workspace-held-exit-proof.log`. The fixture uses the established
one-shot isolated builder with the identical entry, output, browser/IIFE options
and production stylesheet builder; no missing source, retry, assertion or
deadline is waived. Its underlying runtime cause is not claimed resolved.

These are test-only corrections, not a production selection/animation change.
The failed exact clean run remains failed. The corrected committed checkpoint
still requires clean release qualification before merge/tag/push and saved
archive/updater verification. No live Pantheon mutation or publication occurred.

The isolated build child now owns a native timeout and SIGKILL within the
original sixty-second setup budget, including output capture, cancellation and
reaping. Cleanup attempts both stream cancellations and lock releases, surfaces
rejected results, and preserves a primary build failure if cleanup also fails.
Directory removal cannot race a still-live captured builder. The exact final
helper passes success, nonzero exit, timeout/reap, cleanup rejection and combined
primary/cleanup failure probes in
`data-studio-workspace-builder-lifecycle-final-probe.log`; its helper SHA-256 is
`0cc93db3998b361450c8d78fdaded0b35c8bf06a36a121a2c6b69d7eb02e861e`.
The earlier seven-case browser receipt is explicitly pre-this final cleanup
correction; integrated TypeScript passes in
`guardian-2.6-workspace-final-typecheck.log`, and the next exact clean run must
qualify the final complete browser file. No retry, skip, animation or test
deadline changed.
