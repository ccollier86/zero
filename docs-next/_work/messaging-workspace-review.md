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
2. Managed support queue/discovery and job-review dashboard. The native APIs and
   current-owner guards exist, but ordinary workspace options do not make the
   content-free queue or review dashboard complete.
3. Public visitor capability, configured human destinations and native email
   conversation association. Do not add an external-provider connector to Zero
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
