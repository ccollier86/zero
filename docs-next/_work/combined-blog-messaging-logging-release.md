---
id: zero.work.combined-blog-messaging-logging-release
type: roadmap
audience: [agent, developer, maintainer, operator]
owner: zero-release
status: in-review
visibility: internal
system: platform
feature: combined-release
maturity: planned
---

# Zero Blog Messaging and Logging Release

[Working index](./index.md) · [Release procedure](../../docs/releasing.md)

Finish and release one combined update containing native blogging, messaging
and the redesigned logging workspace. The endpoint is a committed, tested
archive selected by the normal `zero-update`, not merely working components on
a feature branch. Existing applications and production data stay untouched;
their owners perform the update and deployment separately.

## Current assessment

| Area | Implemented | Remaining before release |
| --- | --- | --- |
| Blog publishing | Private Fabric content, user-backed authors, revisions, publication, taxonomy, normalized Storage media, indexed search, SEO/sitemap integration, Magazine and sidebar-TOC readers | Growing-blog layouts; loading/empty/error/retry polish; final combined browser and installed-package qualification |
| Blog management | `BlogWorkspace`, block editor, media library, author/category management, private preview, save/conflict/history controls | First-author/first-draft guidance and clear filtered-empty/recovery states; verify the actual default composition |
| Text selection | Native Tiptap selection bubble for bold, italic, underline, strike, inline code and links; keyboard/touch toolbar; `renderSelectionMenu` override | Retest selection, link popover, focus and saved output; no external toolbar component is required to ship |
| Messaging | Everyone/contact-request modes, manual and configured groups, tenant isolation, private files/history, read cursors, typing/presence, internal assistants, website/portal support and human takeover | Final edge-case and accessibility review; retained-state and complete Linux/bundle/crash qualification |
| Notifications | Separate optional chat/general sounds, default off, one cue per event, quiet active conversations, no replay of old notices | Repeat native interaction/lifecycle and static-asset checks against the final archive |
| Logging UI | Current names/private photos, readable activity, real user/activity/table filters, app translations, collapsed exact evidence | Native installed UI smoke and final visual review; the focused source/browser checks already pass |
| Release | Feature changes committed and pushed; previous focused, package and Linux evidence retained | Resolve current failed gates, freeze one candidate, pass the complete inventory, merge/push main and select the verified saved archive |

The selected updater still identifies main commit
`18d84ef66d8ee3b22543e45c37d7de0c46ec51d2`. Local main has later unqualified
commits; publishing it prematurely would not be a logging-only update.
The combined source checkpoint is `690c4ee7f7b97de457ad91df9dffe01c06e6fb4f`.
Continue on the feature branch and preserve existing main history.

The [blog checkpoint](./blog-publishing-implementation.md),
[messaging review](./messaging-workspace-review.md) and
[logging UI review](./logging-workspace-polish.md) retain detailed results.
The logging source passes 43 focused tests, including seven browser scenarios,
plus public-contract, example-compilation and TypeScript checks. That is not a
passing combined release inventory.

## Phase one Complete blog states

Keep the recovered Magazine/article design, Zero tokens, motion and shared
primitives. Skeletons represent an actual pending read, never permanent fake
articles used to fill a new blog.

The source already centers one recent article, balances two recent articles
and suppresses an empty related section. Preserve those working cases. Concrete
gaps are the repeated hero/grid articles and text-only loading in
[the layouts](../../src/components/blog/blog-layouts.tsx), the fixed sparse
grid in [cards and recommendations](../../src/components/blog/blog-cards.tsx), the
public search failure without a retry action in
[the managed reader](../../src/components/blog/blog-public-page.tsx), and
initial publishing capability failures with no explicit recovery control in
[the management workspace](../../src/components/blog/blog-workspace.tsx).
The first implementation slice corrected current-article and duplicate
recommendations and the usable-recent fallback. The following working-source
pass completes sparse layouts and read-recovery states; final combined archive
qualification remains separate.

- [x] Exercise zero, one, two, three and many published posts, with and without
  images. A single article must look deliberate; two should use balanced space.
- [x] Remove redundant featured/grid cards in the default composition without
  losing articles or corrupting server pagination/counts. Hide unnecessary
  headings and pagination when there is no additional section/page.
- [x] Use shared tokenized skeletons for initial loading. Preserve accessible
  status text, reduced motion and consistent layout; do not display a false
  zero count while the result is unknown.
- [x] Give first publication, empty category/tag, no search matches and failed
  retrieval distinct states. Provide clear/reset/retry only when an actual
  callback or native navigation can execute the action.
- [x] Related/recent sections exclude the current article, deduplicate identities
  and use a real fallback. No blank heading, self-link or endless skeleton when
  nothing else is published. Support one/two recommendations without empty slots.
- [x] Cover both the command-palette and anchored search. Loading, no results,
  empty catalog and transport failure must remain distinct. Late/old-query
  responses cannot become selectable results for a new query. Retry repeats
  the current read without requiring the user to alter their search.
- [x] Keep the managed reader's SSR/no-JavaScript search, pagination, canonical
  metadata and sitemap behavior. Failed search must not masquerade as a genuine
  empty publication set.
- [x] Review management first-run states for no active loaded author, no draft,
  filtered empty table, empty media and revision history. Reuse `BlogWorkspace`
  and its native DataTable; expose no action beyond server capabilities and
  never infer a globally empty directory from one bounded page.

Acceptance is real browser coverage of these counts/states at desktop and
narrow widths, light/dark themes and reduced motion; SSR assertions; working
retry/clear and no stale-search selection. Existing reader/editor/media and
publication/privacy tests must continue to pass.

## Phase two Review messaging and logging together

This is a review of the implemented baseline, not another parallel chat engine
or logging service. Fix findings through the existing facades and components.

- [ ] Complete fresh-account flows in both directory modes, direct/group chat,
  membership/ownership changes, blocking and remove/rejoin history. Check empty
  conversation/contact lists, unavailable participants and bounded pagination.
- [ ] Verify committed live insert/backfill/edit/reaction behavior, scroll
  anchors, unread cursors and keyboard/touch interaction without replaying the
  whole transcript's entrance or marking messages read on mount.
- [ ] Exercise private upload/send/download, failure and exact-intent recovery.
  Revocation and scope replacement must remove old messages, typing and files.
- [ ] Exercise named internal assistants independently from customer support,
  human-first/AI-first support, escalation, claim/takeover races, private notes,
  resolve/reopen and the existing manual review surface. Unknown work cannot
  silently resend, republish an obsolete bot response or pretend it failed
  before an effect occurred.
- [ ] Verify availability rings for supported avatar shapes, real typing
  expiry, reconnect cleanup and no invented presence/attention state.
- [ ] Retest the two notification sounds, mute/unmute, foreground/background,
  active versus another conversation, duplicate events, reconnection and scope
  retirement. One message never plays both cues or replays old notifications.
- [ ] Use the real native avatar pipeline in the logging workspace: upload,
  finalize/save, private delivery and refresh. Confirm names/photos, user/table/
  activity filters, app labels and exact collapsed evidence against native APIs,
  not just the presentation fixture's synthetic photo adapter.
- [ ] Verify live logging batches do not blank retained DataTable rows and
  investigation reads do not recursively flood the audit stream. Check denied,
  removed and cross-tenant people, current-scope masking and export permission.
- [ ] Retain Zero icon reuse, token inheritance, native scroll treatment,
  managed dialogs, focus return and accessible loading/error messages throughout.

Acceptance includes single/multi-tenant and simple/advanced Guardian boundaries,
real managed HTTP/SDK/Storage/ReactiveDB interactions and negative revocation
tests. No email/Facebook connector is added to satisfy these scenarios.

## Phase three Resolve shared release failures

The last frozen inventory ran all 1,371 files: 1,365 passed and six failed.
The two documentation/public-export findings have focused corrections; the
failed run remains failed. Four browser files and the Linux startup failure
still require reconciliation before another archive can be selected.

- [x] Reproduce and diagnose authorization-scope, logging AppProvider,
  page-session restart and session-recovery browser failures. Distinguish actual
  runtime/UX defects from fixture admission/lifecycle problems before fixing
  them. Keep document-navigation, scope, blocked-delivery and recovery assertions.
- [ ] Diagnose the isolated Linux source-state
  `DATABASE_OPERATION_TIMEOUT`/unknown outcome at logging coordinator lease
  acquisition. Retain safe worker/phase diagnostics and resource counters;
  do not claim resource exhaustion or a root cause without evidence.
- [ ] Verify worker startup, normal shutdown, actor death/restart, source drain,
  strict audit admission and retained custody without loosening leases,
  authorization, timeouts or uncertain-outcome semantics.
- [ ] Prove independent database writes and foreground writes continue while
  two real loopback AI calls wait concurrently. Long provider work belongs in
  Torrent's bounded pool, not a serialized source automation or SQLite commit.
- [ ] Preserve source-transaction audit atomicity, original migration checksums,
  qualified legacy migration, identities/password hashes, Storage grants,
  private content/history and exact durable receipts. No resets or fabricated
  acknowledgments are allowed to get a test through.

Each finding needs a failing reproducer, a boundary-specific correction and a
passing regression. Keep prior failures and stage timings. A later isolated
pass does not erase an unexplained earlier worker failure.

## Phase four Freeze and qualify the combined package

Select the release version under the existing release policy before freezing;
do not move an old tag or mass-rewrite historical documentation identities.
Use a fresh clean checkout with frozen root and payments-plugin dependencies,
the explicitly admitted Chrome source fixture, and external artifact/scratch
roots. No developer dependency tree or untracked source may qualify the package.

- [ ] Pass root TypeScript, public imports/exports, actual documentation examples,
  reachable manuals, native icons, build, package consumer and dependency audit.
- [ ] Run every discovered normal test/spec file once using the canonical
  process runner. Record the actual inventory count after new regressions.
  No retry-to-pass, omitted file or weakened assertion/deadline. If a failure
  requires source changes, freeze a new candidate and repeat the full gate.
- [ ] Qualify the exact archive in Linux/amd64 with the official Zero build,
  bundled server plus matching retained actor source, strict compliance,
  source-created state, two compiled boots, worker/main crashes and recovery.
  Actors must not inherit provider/dotenv secrets or boot the main app.
- [ ] Repeat the real saved-updater dry-run/update/check/frozen-reinstall smoke
  against a populated disposable app. Verify package-owned hashes and unchanged
  app source/config/public tokens/environment/data. Rehearse supported rollback
  and retained-state migration paths separately; the updater never runs a
  production migration or deployment.
- [ ] Review one final evidence checklist against the exact commit/archive.
  Focused success, an earlier archive's Linux pass or a health endpoint alone
  cannot substitute for the current candidate's qualification.

## Phase five Publish and hand off

- [ ] Reconcile final supported behavior and limits in Start Here, the three
  feature guides, APIs, configuration, upgrade/operations docs and changelog.
  Correct stale source/preview descriptions without deleting historical evidence.
- [ ] Fast-forward or normally merge the verified candidate into main, preserving
  existing history; push the release branch/main and applicable release tag to
  both remotes. No force update of another maintainer's work.
- [ ] Publish the committed-main archive with `zero-release`, then verify the
  selected commit, archive path and SHA-256 through `zero-release --status` and
  the ordinary updater smoke. Existing apps receive it only when explicitly
  updated; do not mutate their repositories or production data.
- [ ] Deliver the exact update commands, version/commit/hash, opt-in feature
  configuration, component locations, tested upgrade behavior and explicit limits.

## Outside this release

Scheduled publishing, translations, Gutenberg interchange, extra editorial
approval flows, group-bot participation, general bot tools/RAG, token-by-token
assistant streaming, cross-origin support embeds, external messaging/email
connectors, session recording and the later backup/log-archive system are not
part of this baseline. They do not become release blockers merely because an
older roadmap mentions them. No broad component reorganization or global theme
replacement is added to this completion pass.

## Source integration continuation

The current source integration pass is separate from the final frozen release.
All 16 selected messaging/logging files pass in
`combined-integration-polish.{jsonl,stderr.log}`. The real-window workspace run
passes all nine cases / 90 assertions with `ZERO_MESSAGING_HEADED=1`
(`combined-polish-native-window.log`): it covers actual OS focus/minimization,
unread dwell, both real decoded sounds, quiet active conversations, duplicate
suppression and scope retirement, without overriding document lifecycle APIs.
Native managed tests cover tenant/private-file boundaries, retained state,
assistant/human takeover and two held loopback AI calls plus a foreground write.
These are overlapping focused checks, not a complete release inventory.

`logging-native-avatar-complete.log` exercises native sign-in, strict blocked
delivery/retry and cookie-only reload, then native profile upload/crop → Storage
grant/upload/finalize → private photo delivery → the same private photo and
current name in the real LoggingWorkspace. Authenticated native health reports
ready compliance delivery and no bridge failure. There is no photo adapter or
directly minted administrator token in that test.

The selection-link browser case exposed a real JSON ordering defect: the
accepted write succeeded, but ProseMirror's different mark/key order made the
round-trip appear dirty. `blog-link-order-before.log` records the two failing
unit reproducers. Stable inline mark order and content-value comparisons repair
it without weakening unsafe-link rejection, uncertain intent or concurrent-edit
protection. `blog-link-order-corrected.log` passes eight tests / 50 assertions,
including real selected text, invalid URL rejection, link application, native
save and publication, private media and dirty-draft recovery.

The isolated old Linux archive still has an unexplained historical first-bind
timeout; it is not declared fixed. The payload-free diagnostic observer records
start/bind stages without changing execution, retries or deadlines. Eight fresh
source setup/stop probes of that unchanged archive pass, with first binds taking
992–1,461ms. No failed start was retried. The original failed evidence remains;
`linux-7c182b2-stages/` and its summary do not substitute for the final archive's
unmodified official-build/crash qualification or establish the old root cause.

## Execution status

### First 2.7.0 candidate not selected

Frozen `02ffec41229425030d5c3581285b8b9ab1042fb0` produced private archive SHA-256
`1c016c9ab6641e3d4aed3642be69e9c2dccf38867ca4716095917534b2f67188`.
Linux/amd64 official-build messaging/logging qualification passes: two bundled
boots, writer/main SIGKILL, retained files and exact replay, two held provider
calls, a foreground write during both calls, strict compliance and empty actor
environments. The separate Linux publishing qualification also passes two
generations, retained identity/history, FTS, private media, SSR and discovery.
Root/payment dependency audits find no vulnerabilities; types, build and docs
checks pass. The ordinary saved updater verifies 5,824 exact package files,
dry-run, populated app/config/theme/environment/data preservation and a subsequent
frozen reinstall. These results do not override failed gates.

That candidate is **not qualified**: the final grouped-menu package test completed
all 16 assertions and wrote provenance, then exceeded its original 120s deadline
during owned cleanup. Separate native-window and saved-updater installations had
been run alongside the package gate; the source release procedure now explicitly
prohibits overlapping these independent cold-I/O gate phases. The failed run
remains failed, cleanup is still required, and no assertion/deadline is changed.

The real-window messaging gate also passes eight cases but fails read resumption
after focus returns. An isolated rerun alone passes; that is not declared a fix.
A deterministic event-order browser regression then fails on the original hook:
a focus event can sample `hasFocus()` before its getter updates, leave the blur
fence closed, and never schedule another observation when the same input already
has DOM focus. The correction resamples on a transition-owned frame and permits
verified trusted input to restore admission. Blur/unmount cancel pending frames;
actual viewport/visibility/focus/dwell and current-scope checks remain. The new
regression also checks cancellation and rejection of synthetic input. The next
candidate must repeat qualification with sequential external gate admission.

The corrected source's complete native messaging browser file passes all ten
cases / 94 assertions with real-window opt-in (`native-read-focus-complete.log`).
This includes the deterministic negative focus/blur/synthetic-input checks and
the unchanged actual OS-focus/audio cases. Types and all 875 documentation links
also pass. It is still source evidence, not selection of the failed old archive.

### Complete 547094c sweep and review follow-up

The next frozen inventory runs all 1,376 files exactly once: 1,374 pass, two
fail, none are omitted, exit 1 (`frozen-547094c-suite.{jsonl,stderr.log}`). Its
36m49s failed run is retained; subsequent focused corrections do not turn it
into a pass. The unchanged grouped-menu package consumer passes with all cleanup
in 32.866s under coordinated admission and its original deadline. Legacy-state,
compiled/Fabric logging, hot auth and installed messaging checks also pass.

The two findings are exact review/test integration gaps:

- The logging detail's `Bot` fallback lacked an explicit per-file entry in the
  native icon guard. The actual `bot` glyph is absent from Zero's registry and
  already admitted for the activity cell. Review that same exact missing-glyph
  fallback for the detail view; keep the guard that rejects a fallback whenever
  Zero gains the glyph. `native-icons-review.log` reproduces the failure;
  `native-icons-reviewed-fallback.log` passes 170 assertions after correction.
- The generated session/audit test still looks for old visible `report · id`
  cells and Actor/Resource labels. Its sign-in, required acknowledgment and
  blocked/session retry assertions already pass. Adapt only the UI locators to
  current exact Inspect controls and User ID/Record ID labels, retaining the
  actual row-DOM identity, live insert/burst/paging, native incoming-record
  handling, filters, modal, reload/new-tab and revocation assertions.
  `session-audit-current-ui.log` passes three scenarios / 43 assertions. Its
  deliberate final role revocation emits `AUTH_STATE_CHANGED` as the old stream
  retires; that is a tested closed authority boundary, not a failed login.

These follow-ups change no production runtime or API. Freeze their committed
source, then rerun the complete gate and the remaining installed/native/update
checks before selecting a package. The failed 547094c archive stays private.

- [x] Assess current feature source, public components and release evidence.
- [x] Confirm the selected saved update and preserve the combined source on a
  feature branch.
- [x] Confirm that native blog management and selection formatting already exist.
- [x] Start phase one with current-article exclusion, stable recommendation
  deduplication and the recent-article fallback. `RelatedPosts` also accepts
  `excludePostId` for standalone composition. The focused related/default SSR
  set passes 10 tests / 62 assertions, and root TypeScript passes; this is not the complete state/browser
  acceptance pass (`blog-related-states-first.log` in the existing diagnostics).
- [x] Implement phase-one sparse/loading/empty/error/retry states. The focused
  canonical set passes all 14 files (`blog-polish-focused.jsonl`); subsequent
  composed-search and first-author additions also pass. The final candidate will
  rerun the whole set against one clean commit rather than combine these into a
  frozen-release claim. The real editor covers first-author discovery, failed
  capabilities/media/history reads, exact retries, private upload, selection
  formatting, accepted publication, dirty-draft recovery, profile save and live
  observations. Native SSR/FTS/privacy and the 15-case original UI suite pass.
- [x] Update the layout/search/token/workspace guides and changelog. The docs
  structural gate sees 875 reachable unique pages without problems. No blog
  persistence or migration changes were added in this polish pass.
- [x] Reconcile the four recovery browser failures. Real Chromium rejects the
  old classic-script fixtures at parse time with `Cannot use 'import.meta'
  outside a module` after the lazy optional sound asset module enters their
  dependency graph. The browser never reaches the auth harness. Compile/load
  those fixtures as ESM, matching the official Zero build; do not alter production
  session/admission behavior. All four files now pass: 36 browser cases, including
  strict blocked delivery, cookie-only SSR, persisted restart, cross-tab ordering,
  bounded failure/retry and revocation. Case/assertion/deadline semantics are
  unchanged. Evidence: `recovery-classic-script-browser.log` and
  `recovery-esm-regression.{jsonl,stderr.log}`. The earlier diagnostic was
  interrupted after reproducing the same pre-harness failures and remains an
  interrupted run, not a pass. The original full frozen inventory remains failed.
- [ ] Complete phases one through five and replace this status with exact final
  release evidence when the normal updater is actually ready.

The first execution slice is blog sparse/loading/empty/error states on
`feature/blog-resilient-states`, based on the preserved combined source. The
logging-only release detour is cancelled. Main and the selected saved update
remain unchanged until qualification succeeds.
