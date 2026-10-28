---
id: zero.messaging.workspace-review
type: reference
audience: [agent, developer, maintainer]
owner: messaging
status: in-review
visibility: internal
system: messaging
feature: native-workspace
maturity: experimental
applies_to: ["feature/messaging-backend; source and isolated synthetic tests, not stable-release qualification"]
---

# Native Messaging Workspace Review

[Work index](./index.md) · [Frontend manual](../frontend/messaging/workspace.md) · [Backend configuration](../backend/messaging/configuration.md) · [Earlier correction](./messaging-configuration-correction.md)

## Current Completion Pass (2026-10-28)

The continuation adds native [website support](../backend/messaging/website-support.md),
entry-specific Guardian staff routing, expiring single-conversation visitor
capabilities, private file integration, shared-pool bidirectional typing, real
assistant job activity, explicit model-requested human handoff, operator review
UI and assigned-human resolve/reopen. This record separates implementation from
the installed/archive/release gates below. Check `zero-release --status` for the
actually selected committed archive; older chronological remaining-work lists
are not claims that these source capabilities are still absent, nor proof that
an older installed package has them.

The support archive bug was real: support members have customer/staff roles, not
group-owner roles. Only the current human owner may resolve/reopen, and both
transitions advance the owner epoch. Former staff owners cannot hand back another
person's chat. Queue pagination is now indexed oldest-first and filter-bound.
Private migrations 008/009 are additive; 001–007 remain unchanged. A real retained
v7-shape actor test preserves messages, reactions, identities and exact receipts.

Public website entries do not reuse the legacy external-delivery `channel_id`;
doing so would invent provider delivery jobs. They have a separate native entry
field, fixed configured origin/scope, cookie-only random capability, in-memory
CSRF/session fences and private source-transaction admission/quota checks.
No fake Guardian user, directory, generic Sync grant or email bridge is created.
Expiry/revocation also fence provider publication inside the source transaction.

Review details use the existing modal manager and bounded ScrollArea. Live review
projections and optional private review counts do not expose drafts to customers.
Retries preserve immutable attempts, explicitly acknowledge uncertainty/possible
cost and choose the conversation's named bot, not the unrelated support default.
Current job state, rather than timers, drives assistant activity. An optional
empty-argument model tool can request triage, never select a staff/tenant/member.

Source evidence is retained under
`/Volumes/code-bank/artifacts/zero-platform/diagnostics/messaging-support-review/`.
`completion-native-regressions-1.log` records 83 tests/746 assertions in 20 files;
`completion-browser-sync-regressions-1.log` records 28 tests/300 assertions in four
files, including the five native browser flows, existing ephemeral policy and
icon catalog guard. These sets overlap other focused checks; they are not summed
into an invented full-suite total. Root TypeScript and the 873-page reachable
documentation graph passed at that checkpoint. Later source changes require
their final reruns.

The browser continuation caught a real typing-burst bug: clearing after Send did
not reset the throttle timestamp, so a fresh immediate draft could be missed.
Clear now resets that timestamp. Initial focus/cookie-selector attempts and their
failed logs are retained. The final two-way native browser case proves visitor
activity reaches staff and normal staff activity reaches the restricted visitor
projection. It does not claim real operating-system focus/device qualification.

The installed Linux fixture lives in
`src/messaging/test-support/managed-deployment/`. It must pass against the final
archive before this branch is selected for normal updates. Unit/browser source
success is not substituted for worker/process/bundled-package evidence.

### Final Native/Deployment Continuation

The committed runtime `3f7c12f` passes the isolated official-build Linux/amd64
fixture on Bun 1.3.14. Evidence is in `linux-3f7c12f/`: source-prepared retained
Guardian/messages/private bytes survive the official bundle, a killed private
writer recovers with the same intent, two held provider calls overlap, and an
ordinary foreground write completes while both wait. After main SIGKILL, the
interrupted call is retained as unknown review/triage without provider repetition.
Private bytes, exact once-only message replay and strict logging health survive
restart. Both main boots are distinguished from 29 worker launches; matching
source actors inherit neither the synthetic provider secret nor dotenv secret
and never execute the main application entry.

The first Linux attempt (`linux-cf7864f/`) is retained as failed evidence: it
tried replacing a killed workflow owner before Torrent's normal 30-second lease
expired. The corrected fixture waits 31 seconds; it does not clear the lease,
steal ownership or relax runtime admission. The later passing run's 1,148ms
foreground write is a five-second nonblocking acceptance result on the synthetic
container, not a production throughput promise.

`package-3f7c12f.log` passes the fresh installed public consumer (46 assertions),
including types, aliases, SSR, browser isolation and matching packaged source.
The archive SHA-256 for those two checks is
`b9248f349a313d25adf4a42fcec979aff873f79c2e864725306ca6ab0c8259fb`.
The final native/controller/protocol set in `completion-native-regressions-2.log`
passes 87 tests/765 assertions in 21 files. Visitor lifecycle now has explicit
bounded requests, aborted-body retirement and isolated cleanup observers.

The opt-in real-window test (`ZERO_MESSAGING_HEADED=1`,
`headed-lifecycle-2.log`) passes with no synthetic lifecycle event or overridden
document API. Actual macOS Chromium window focus loss retains one unread message;
returning visible/focused and completing dwell acknowledges it. The first attempt
incorrectly required a separate native window to be hidden and is retained as a
failed harness premise. This passing case qualifies real window focus, not every
tab/minimize/mobile-device/browser lifecycle. The ordinary headless geometry,
event-fence and revocation cases remain separate.

### Peer Notification Recovery Correction

The final cross-reference review found a real remaining gap rather than merely
stale wording: ordinary peer notification failures could reach `needs-review`
without a sender-visible recovery surface. Native count/list/point queries now
share a sender/history-bound predicate; the write repeats that boundary inside
the canonical transaction. Only a sender's own public native-notification job is
admitted. A group owner cannot inspect another sender's work, provider drafts
are never returned, and explicit dismissal records a resolution without resend
or rewriting the old job outcome. Existing support and internal-bot authority
is unchanged. The native workspace hides this peer control when no work exists.

`peer-review-canonical-2.log` passes the actual actor test (19 assertions),
including a non-owner sender, owner non-disclosure, removal/rejoin history and
retained exact dismissal replay. `peer-review-native-1.log` passes actual
HTTP/SDK/Torrent failure discovery and no-resend dismissal (13 assertions).
`peer-review-browser-1.log` passes the real AppProvider/workspace/modal flow
(five assertions), not a fake populated review array. The first actor test
omitted its add-member `contactsOnly` input and failed; it is retained, and the
corrected fixture asserts both removal and readmission succeeded.

The early frozen `ef73511` full run was intentionally interrupted while this
gap was corrected; its output/summary is retained and is not a full-suite pass.
New source/package/Linux qualification is required after the peer admission
change. Final frozen source/local release gates and updater selection remain
explicit, not implied by focused evidence or an unchanged `2.6.0` version.

The deployment review also reproduced a real TLS-termination gap: an exact
configured HTTPS origin was rejected on a legitimate private HTTP hop with its
public Host preserved. The corrected parser admits that transport shape while
retaining exact browser Origin, CSRF/session and host admission, Secure cookies
and canonical source checks. It does not trust arbitrary forwarded headers.
`public-proxy-origin-before.log` retains the failing regression; the corrected
parser and actual native HTTP/session/send tests are recorded separately in
`public-proxy-origin-after.log` and `public-proxy-native.log`. This is backend-hop
qualification, not a claim about an operator's external proxy/certificate setup.

### Intermittent Linux Gate, Not A Hidden Pass

The final peer/proxy runtime pack `eb54817` passes its installed public consumer,
clean physical-dependency typecheck/build/docs and dependency audit. Its Linux
attempt fails with `LOGGING_OUTCOME_UNKNOWN`; the pre-diagnostic fixture did not
identify the exact stage. A diagnostic-only follow-up (`da86922`) then reaches
source-prepared state but reports an incomplete messaging coordinator shutdown.
Both are retained failures, not a demonstrated fix or a reason to weaken audit
admission or accept an unacknowledged actor close.

The same `da86922` runtime subsequently passes the full source-to-bundle/crash
fixture with resource counters (`linux-da86922-resources/`): two main boots,
29 worker launches, retained private bytes/review, no repeated uncertain call and
a 776ms foreground write during two held provider calls. That synthetic run peaks
near 2.37 GB and 135 tasks with no OOM/process-limit events. It does not prove the
earlier failures were resource exhaustion. The fresh source lifecycle probe also
passes eight independent setup/stop sequences. That diagnostic wrapper preserves
failure outcomes and deadlines, but is not a substitute for the normal runner.
The first probe attempt used an unavailable import alias and is retained as a
failed diagnostic harness attempt, not a framework failure.

An intermittent failure with no confirmed cause must remain visible. These
focused successes do not by themselves select the stable updater or establish a
complete frozen-framework release pass. Existing applications/production and
the current stable archive remain untouched.

The SDK-only deployment fixture also needed the same real heartbeat lifetime as
the existing publishing fixture: one initial acknowledgment is not a collector
for a long setup/provider/recovery sequence. It now copies/reuses that tested
helper from the exact installed archive, uses the returned policy interval,
joins it before intentional faults/stop and establishes fresh admission after
restart. Collector errors remain failed gates, without protected-operation
retries or raised TTLs. This repairs the fixture contract; it does not establish
that every earlier unconfirmed-acknowledgment/shutdown failure had this cause.
The `9681220` whole-suite attempt was interrupted for that fixture correction;
its retained partial result is not a full-suite pass.

The `3998e11` frozen run then exposed an omitted qualification prerequisite:
the separate payments plugin's committed lockfile dependencies were not installed
by the root install. Five native plugin files failed on a missing `stripe` import
before their assertions could run. The run is retained as failed/partial, not
reported as a payments behavior failure or a whole-suite pass. The release guide
now requires the plugin's own frozen, script-free install before the complete
inventory; no files, assertions or deadlines are excluded or relaxed.

### Complete-inventory follow-up

The prepared `a14abe4` run caught a real shared-layout regression: the full-height
recession bridge also applied to empty host-only managers. A controlled dialog's
fallback host could therefore consume its flex parent's height and collapse the
Data Studio grid. The bridge now applies only to nonempty surfaces. A new native
Chromium regression checks both zero-height empty hosts and bounded scrolling in
wrapped full-height content. The unchanged nine-case Data Studio workspace browser
file then passes (50 assertions), rather than relaxing its visibility checks.
Evidence: `modal-empty-host-focused.log` and `modal-studio-layout-after.log`.

The preservation guard removes only the exact admitted CSS appendix and still
checks the original stylesheet hash; the installed-scroll guard pins the entire
corrected file. The machine-service projection test now includes the additive
`messaging` facade and asserts it is null when absent. The migration freeze adds
only the already-introduced 049–051 definitions. No earlier migration definition,
checksum, identity or application state is changed. Those three guard files pass
11 tests/66 assertions in `final-preservation-guards.log`.

The native messaging browser and fresh installed consumer pass in the prepared
run, including 49 installed-consumer assertions. The complete run also reports
a phone-consumer timeout after all 11 functional assertions; its awaited cleanup
remains required and the failed result is retained. Added payload-free stage
timings distinguish pack/install/verify/assertions/retirement without raising
the existing functional deadline. The Resource-array consumer likewise finishes
its four assertions before its combined lifecycle deadline. Both now retire
their captured synthetic consumers in an independently awaited 120s hook; the
functional/child deadlines remain unchanged, and hook failure still fails the
file and holds its installed-consumer slot. This explicitly separates fixture
retirement budgets, not a claim that aggregate execution fits the old single
deadline or that production database performance improved. Final qualification
and stable selection remain pending;
these follow-up successes are not a replacement whole-suite pass.

The prepared `a14abe4` inventory subsequently finishes all 1,370 files once:
1,361 pass, nine fail, none are unrun (3,258,282ms). Its failed result and complete
output remain `frozen-a14abe4-suite.jsonl` / `.stderr.log`. The failures are the
Data Studio layout regression, three modal CSS preservation guards, the machine
service allowlist, two migration-list expectations and the two retirement
timeouts described above. The packed fresh-app smoke's exact registry expectation
now includes 049–051 as well; it still checks clean application and idempotency.
All other files, including the separate admitted Chrome source-preview tests,
run normally. The corrected candidate requires its own frozen verification;
this failed inventory is not described as a release pass.

### Notification feedback and final qualification continuation

The next complete frozen checkpoint, `ee161375dfbd3cf9d0d76ca39a999dcca14ef7f5`,
finishes all 1,370 files once: 1,368 pass, two fail, none are unrun
(3,010,632ms). Its isolated candidate passes Linux/amd64 official-build/native
worker/restart qualification and the real saved-updater smoke, but the failed
full inventory means it is **not selected as stable**. Retain
`frozen-ee16137-suite.jsonl` and `.stderr.log` as failed evidence.

The two remaining findings have different boundaries:

- The installed publishing source preparation reports
  `DATABASE_EXECUTOR_START_FAILED`. The old error has no safe lifecycle phase,
  so it does not establish whether this was a spawn, startup deadline,
  handshake, disconnect or early exit. New diagnostics preserve only those five
  allowlisted phase literals, never a command, path, environment or raw cause.
  Dedicated source fixtures now use the additive `logging/actor` and
  `messaging/actor` package subpaths rather than app/server barrels. A package
  graph regression verifies that these entries do not pull in the app factory,
  React or AI service. Deadlines, leases and authority checks are unchanged.
  This avoids unnecessary worker imports; it is not proof of the original
  unclassified failure's cause. Fresh installed source preparation, official
  build and two publishing generations pass in the focused follow-up.
- The adaptive-profile installed consumer prints its qualification and finishes
  all 30 functional assertions before its combined 180s lifecycle deadline
  expires during dependency retirement. Like the two previously identified
  consumers, it now awaits its exact owned fixture's cleanup in a separate 120s
  afterAll hook. Its existing 180s functional/90s child budgets are unchanged;
  failure still fails the file and holds the slot. The focused follow-up records
  60,048ms functional work and 13,967ms cleanup. This is not a database-speed
  improvement, skipped cleanup, or a claim that the earlier inventory passed.

`actor-profile-retirement-source.jsonl` records both focused installed consumers
passing (173,505ms). These are source-tree archive checks, not a replacement for
the next exact committed/frozen candidate's full inventory.

The user additionally requested optional, distinct chat/general audio and no
interruptions from the conversation currently being used. One AppProvider-owned,
scope-fenced feedback arbiter now handles native message notices and optional
NotificationProvider toasts. Chat classification uses only an opaque, versioned
conversation/message tuple, not title/URL guessing. New permanent effect hashes
bind that tuple; exact old receipts reconcile without rewriting/resending them.
The browser suppresses sound/toast for the actual visible/focused transcript,
not merely a selected ID. It does not write read/seen/dismiss receipts.

Both cues default off, load as same-origin hashed assets, obey mute/volume and
browser user-gesture admission, and share a 750ms burst fence. There is no audio
backlog or replay on unlock, reconnect or unmute. Live arrival hooks consume
only admitted notification INSERTs, not snapshot/catchup/cache/receipt history.
Cross-tab device-wide arbitration and browser desktop notifications are not
claimed. The [public guide](../frontend/notifications/sounds.md) documents the
API, scope, composition, assets and limits.

Focused source evidence under the same external `messaging-support-review`
directory is deliberately reported separately:

| Check | Result | Evidence |
| --- | --- | --- |
| Audio/presentation/receipt unit boundary | 11 tests / 83 assertions, no failures | `notification-policy-audio-unit.log` |
| Worker admission/diagnostics, public imports and native job-protocol set | All seven files pass, no excluded file or retry | `notification-worker-focused-regressions.jsonl` / `.stderr.log` |
| Managed native HTTP/SDK lifecycle, peer notices and current authorization | 18 tests / 251 assertions, no failures | `notification-managed-browser-copy.stderr.log` |
| Actual AppProvider/workspace browser, public support, uploads, review, both media files and quiet active/mobile/background cases | All nine tests / 90 assertions pass, including the two workstation opt-in cases | `notification-managed-browser-copy.jsonl` / `.stderr.log` |
| Public source-copy boundaries | Both selected files pass | `notification-managed-browser-copy.jsonl` |
| Normal browser asset emission/static route and unchanged route-generation cases | 4 tests / 30 assertions, no failures | `notification-build-static-assets.log` |
| TypeScript and documentation graph | TypeScript passes; 874 pages/IDs reachable, no problems | `notification-reviewed-final-types.log`, `notification-reviewed-final-docs.log` |

The original optional headed test's second CDP session did not reliably retire
Playwright's own focus emulation. Failed focus/attachment attempts are retained
in the `notification-headed*`, `notification-real-window*` and related diagnostic
logs, not reported as passing browser evidence. Workstation qualification now
launches a disposable native Chromium profile and uses Playwright's public CDP
transport with `noDefaults: true` on its actual default context. A second new
context would reintroduce the override. Both real-window tests pass without
replacing document getters or emitting synthetic lifecycle events; the audio
case minimizes/restores its real test window. The old and new read/dwell/security
assertions remain. `notification-native-cdp-transport.log` records the separate
two-case 23-assertion check; it overlaps the later nine-case run and is not added
to that count. No user browser/profile, application, provider or production data
is used.

Per the latest user direction, the logging UI is queued for a joint design and
usability review **after blogging and messaging are finished**. Existing logging
functionality/tests remain; this continuation does not redesign that screen or
treat the current presentation as approved. Final frozen release gates and
normal updater selection remain required before calling the whole feature
deployment-ready.

This pass completes the ordinary managed conversation workspace over the
existing native backend. It does not merge the branch, select a stable updater
archive, modify a consuming application or qualify a deployment. Prior private
migrations, SYSTEM identities and application data are not rewritten.

## Defects Found And Addressed

| Boundary | Finding and correction |
| --- | --- |
| AppProvider → ephemeral client | The ordinary provider omitted `ephemeralClient` from Sync wiring. Hand-built fixtures had supplied it themselves. Native typing now receives the existing SDK owner through the normal provider; no second client/tracker is created. |
| Shared modal surface → full-height layout | The receding-surface wrapper did not carry its parent's height. The real transcript stretched the document to over 6,000px instead of scrolling in its own pane. The wrapper now preserves height/min-height, with native workspace and existing modal/drawer regressions. |
| SSE authorization errors | Explicit invalidation/denial was treated as an endlessly reconnecting generic transport failure. Native frames now carry only safe status, and the SDK exposes terminal versus retryable typed errors. No response body/raw URL leaks through the error. |
| SSE framing | UTF-8 and CRLF can be fragmented; a network chunk can coalesce several valid frames. Decoding handles both, bounds each individual frame and treats malformed envelopes/observer bugs as terminal. |
| Direct-message privacy | Canonical `addParticipant` previously allowed expanding a direct conversation. New requests are rejected; use a new group instead. Existing retained conversations are not relabeled or migrated. |
| Identity discovery | Active-but-unfinished provisioning/token-ineligible accounts could enter directory/group candidates. The managed directory now reuses Guardian's canonical eligibility and excludes pending provisioning; names/optional public avatars are bounded exact-scope projections. |
| Exact reconciliation | Added authorized `messages.get` and `conversations.people` through the public service/SDK/native routes. A content-free own receipt is not permission to bypass current history or membership. |
| Live contacts | Added `watchContacts` over the same authorized, bounded, committed projection mechanism. No private table sync or app-fabricated row events are required. |
| Unknown writes | A send or management command keeps one exact request identity, coalesces duplicate clicks/checks and handles synchronous adapter throws. Explicit same-key retry never invents a new intent after a lost response. |
| Private-note drafts | Public replies and private notes formerly shared the workspace's one draft. They now have distinct visibility-bound banks and upload/typing lanes, including after conversation replacement. Stale input handlers cannot write into another lane. |
| Historical reactivity | The latest and active historical viewport use at most two transcript streams, not one per retained page. Off-screen cache refreshes when observed. Equal message revisions retain identity while reactions update. The bounded window can slide earlier indefinitely instead of making history before its first cap unreachable. |
| Coalesced membership changes | Native history pages carry a versioned canonical lower bound and staff/public view. Changed grants clear the prior view; stale frames cannot restore it even if removal/readmission occurred between snapshots. A reappearing list row cannot resurrect a denied transcript without fresh admission. No timestamp or new migration is needed. |
| Append-only motion | Only newly appended keyed message rows animate using the shared entry timing/easing. Initial history, backfill, edits and unchanged live snapshots do not replay an entrance; reduced motion disables it. |
| List recovery | Temporary list outages remain visible rather than appearing to be a successful empty result. Explicit recovery after terminal denial recreates the selected transcript subscription, not just its header metadata. |
| Read evidence | Selection/fetch/presence do not clear unread counts. The managed policy checks actual end geometry, focus/visibility and a 750ms dwell, rechecks on completion and cancels on lifecycle changes. A blur fence survives incoming snapshots; focus-in can restart a healthy observation. |
| Leave/recovery UX | Unknown management outcomes remain visible outside their originating popover. Native departure and Zero router admission warn about unfinished in-memory work without claiming cancellation. Auth retirement masks data instead of waiting for UI cleanup. |

## Source Map

- [Managed organism](../../src/components/messaging/messaging-workspace.tsx),
  [React ownership hook](../../src/components/messaging/use-messaging-workspace.ts),
  [headless controller](../../src/components/messaging/messaging-workspace-controller.ts).
- [Exact sends](../../src/components/messaging/workspace-send.ts),
  [management intents](../../src/components/messaging/workspace-command.ts),
  [history windows](../../src/components/messaging/workspace-transcript.ts),
  [private stages](../../src/components/messaging/workspace-uploads.ts),
  [viewport policy](../../src/components/messaging/use-messaging-transcript.ts).
- [New conversations](../../src/components/messaging/workspace-start.tsx),
  [membership/ownership controls](../../src/components/messaging/workspace-manage.tsx),
  [native message actions](../../src/components/messaging/workspace-message-actions.tsx),
  [existing shared presentation](../frontend/messaging/index.md).
- [Stream reader](../../src/frontend/client/messaging-watch.ts),
  [native stream](../../src/messaging/stream.ts),
  [public native routes](../../src/messaging/plugin.ts),
  [service boundary](../../src/messaging/service.ts).

## Verification Record

Evidence is under
`/Volumes/code-bank/artifacts/zero-platform/diagnostics/blog-publishing/`.
Only synthetic loopback accounts/messages/files/providers are used. Old failing
logs are retained; their existence is not hidden by replacing a filename.

The first fresh-package attempt reached its 240-second test limit and is retained
as `messaging-workspace-package.log`, not counted as passing. The isolated archive
was inspected against all 34 changed runtime files (no mismatches), its installed
consumer reran successfully, and a final newly packed/freshly installed proof
passed in 74.6 seconds. Stage labels now distinguish pack/install/typecheck from
SSR/browser-build work. No timeout or assertion was weakened to obtain that pass.

| Check | Result recorded in this pass | Evidence |
| --- | --- | --- |
| Messaging native/backend/client/presentation/controller regressions | 92 passing tests, 699 assertions with the versioned grant and bounded historical connection regressions | `messaging-workspace-grant-regressions.log` |
| Focused actual Guardian/Fabric/Storage/Sync integration | 19 passing tests, 220 assertions, included in the broader run | `messaging-workspace-native-regression.log` |
| Existing shared modal manager and drawer browser behavior | 12 passing tests, 70 assertions | `messaging-workspace-modal-regression.log` |
| Native workspace Chromium integration | 2 passing tests, 27 assertions, including actual private download bytes and append/reduced-motion behavior against grant-aware native queries | `messaging-workspace-browser-grants.log` |
| Fresh installed public aliases/types/SSR/browser consumer | 1 passing test, 39 assertions from a final grant-aware pack/install; helper deep imports remain blocked | `messaging-workspace-package-grants.log` |
| Bounded-history overlap follow-up | 16 passing tests, 135 assertions; the smallest retained window keeps enough overlap while paging earlier | `messaging-workspace-history-overlap.log` |
| Root TypeScript and documentation structure | TypeScript passed; 872 pages/IDs reachable, no structural problems | `messaging-workspace-typecheck-grants.log`, `messaging-workspace-docs-grants.log` |

The browser scenario uses actual AppProvider, SDK, WebSockets, native routes,
private Fabric and Storage. It verifies identity loading, bounded desktop/mobile
panes, retained message DOM, native live append/backfill, private bytes, typing
without draft text, interrupted accepted-send reconciliation, reactions/editing,
group creation/settings and native confirmation. Read-policy coverage includes
real off-screen geometry/dwell and a deliberately simulated window blur/focus
event fence. Native membership removal must erase retained history.

Headless Chromium/Playwright force document focus. Switching to another test tab
did not change `document.hasFocus()`, even after disabling the explicit focus
emulation override. Those failing attempts are retained. The final event-fence
scenario must **not** be described as qualification of real operating-system
tab/window focus or device lifecycle. A headed/browser-device pass remains a
release gate; no production-only override of `hasFocus()` was added.

## Remaining Work, Not Simulated Success

1. Installed Linux/amd64/native worker/restart and full package/update release
   qualification. A source run and a public-import consumer are different facts.
2. The later support continuation below adds native content-free queue/discovery
   and customer handoff. A provider-job review dashboard remains incomplete.
3. Public visitor capability and configured human destinations. Email bridging
   is not required. Do not add an external-provider connector to Zero
   to stand in for these requirements; such connectors are app-owned.
4. Group assistant participation, admitted live assistant-run status and broader
   AI context/tools/RAG. Current native assistants have their own conversations
   and bounded text context; files are not silently read by a model.
5. Full multi-profile/browser/device and load/resource matrix, including real
   OS focus/visibility, contact pagination under churn and maximum-size transcripts.
6. No unique-direct-conversation-per-user-pair contract is introduced. Durable
   request receipts prevent duplicate **intents**, not every separately requested
   conversation with the same participants.

Keep the stable updater untouched until those applicable release requirements
are satisfied. Do not delete the old presentation APIs or reset retained private
database files to make acceptance easier.

## Support And Icon Continuation (2026-10-28)

The clarified scope is website/customer-portal chat with AI-first, human-first
or AI-to-human escalation. Email threading/bridging is not a requirement. This
pass adds authenticated customer handoff and a scoped, live, content-free staff
queue through the existing native facade, ownership epochs, canonical Fabric,
AppProvider and workspace. It does not implement anonymous visitor capabilities
or select a stable archive. Private migration definitions remain unchanged.

Native backend evidence includes a real loopback model call held across a
customer escalation: its stale answer cannot publish after human takeover.
Native browser evidence covers human-first creation, live non-member queue
discovery without transcript disclosure, explicit claim, human reply, private
note isolation and a narrow-screen conversation. A first browser attempt failed
because its text locator matched both the legitimate sidebar preview and the
transcript; the corrected assertion targets the transcript, not fewer outcomes.

The icon audit corrects covered imports throughout messaging and blog. Small
already-completed icon-only corrections to logging, command palette, presence
settings and pagination are retained. The central native-consumer regression
reads the actual Zero catalog, admits only explicit missing-glyph exceptions
and rejects covered aliases such as refresh/spinner/trash/user variants. The
remaining older framework consumers have not been mass-converted. No new
parallel icon set, theme, auth client or email bridge is introduced.

Evidence for this pass is under
`/Volumes/code-bank/artifacts/zero-platform/diagnostics/messaging-support-review/`.
The completed focused checks are:

| Check | Result | Evidence |
| --- | --- | --- |
| Native messaging/runtime/SDK/controller regression set | 74 tests, 624 assertions, no failures; includes the held real loopback AI response and native queue/handoff | `native-regressions.log` |
| Icon policy and affected presentation/controller cases | 35 tests, 617 assertions, no failures | `icon-consumers.log` |
| Native AppProvider/workspace browser | 3 tests, 32 assertions, no failures | `native-browser.log` |
| Blog and logging browser consumers | 20 tests, 83 assertions, no failures | `icon-browser.log` |
| Root TypeScript and documentation graph | TypeScript passed; 872 pages/IDs reachable, no problems | `typecheck.log`, `docs.log` |

The sets overlap and are not summed into a fictitious unique full-suite count.
These are focused source checks, not a fresh installed/archive or Linux proof.
The native support queue remains a bounded discovery/claim surface; dedicated
review/resolve dashboards, configurable destination routing, queue prioritization
and the public visitor/widget admission boundary require further work.

The source/browser evidence remains distinct from the pending installed
Linux/worker/restart, full resource/device matrix and final updater qualification.
