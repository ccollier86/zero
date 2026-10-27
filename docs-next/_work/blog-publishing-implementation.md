---
id: zero.work.blog-publishing-implementation
type: architecture
audience: [maintainer, agent]
owner: blog
status: draft
visibility: internal
system: blog
feature: publishing
maturity: experimental
---

# Blog Publishing Implementation Checkpoint

[Working plans](./index.md) · [Publishing API](../backend/blog/publishing-api.md)

Worktree: `zero-platform-array-policy`; branch: `feature/blog-publishing-backend`.
The selected main archive is unchanged. Unreleased work is not update-ready.

## Approved Order

1. Complete and qualify blogging end to end. Finish the backend before choosing
   or replacing the floating text-selection editor toolbar. Public defaults are
   the recovered Magazine and sidebar-TOC article, using Zero tokens and motion.
2. Review and replace the poor logging investigation UI. Preserve the logging
   service/security contract; do not mix a dashboard redesign into publishing.
3. Implement the complete messaging backend. Existing UI and real room typing
   are not durable conversations, send/history APIs, attachments or AI takeover.

## Current Evidence

- Private file/WAL Fabric publishing, draft/public snapshot isolation, revision
  conflicts, idempotent command replay, taxonomy and indexed search have focused
  actor tests.
- Managed `createApp`, real native HTTP and the SDK exercise enrollment,
  publish/edit/withdraw, restart, current-user audit attribution and live changes.
- Actual private PNG upload is normalized to WebP; published references gate
  anonymous delivery, range reads work, and referenced media cannot be removed.
- Main's qualified navigation, audit recovery and avatar fixes are merged into
  the feature branch. No consuming app or production state was changed.
- Real Chromium checks now cover the actual managed build, SSR, enhancement,
  indexed search, rich formatting, draft privacy, accepted publish, noindex,
  sitemap withdrawal and permanent-slug redirects.
- The native writer workspace has a real-browser compose → selection formatting
  → save → publish flow, Save/Discard/Stay and competing-revision preservation,
  also under React StrictMode. Screenshot evidence is retained under the normal
  external diagnostics root, not embedded as a replacement for assertions.
- Bounded native image processing and lease expiry/replacement/cleanup failures
  have focused tests. New 048 migration preservation/collision checks pass, and
  native read/write/publication scopes retain explicit ceilings.
- The focused 22-file regression run passed 98 tests / 2,158 assertions, including
  two fresh-package consumers and real Chromium reader/editor flows. Follow-up
  coverage exercises marked line-break round trips, bounded/cancelled media
  transport, batched public term resolution and retention-enforced metric reads.
  These follow-up changes require their own final candidate run.
- Fresh-process focused follow-ups passed all six selected files (22 tests),
  including exact-post and aggregate live streams, bounded media transport and
  the native StrictMode writer flow. Typecheck, frozen offline install, whitespace
  and the 862-page documentation graph check passed.
- A fresh installed publishing consumer passed source-created state → official
  `zero build` → two compiled server generations, strict audit admission,
  retained identities/history, native normalized image delivery and browser-only
  editor bundling. This host check is not the Linux/amd64 qualification.
- Candidate `32823628d0276fde56f3e78f98e256397a6b1bfb`, archive
  `/Volumes/code-bank/artifacts/zero-platform/dev/blog/3282362/zero-framework.tgz`,
  SHA-256 `89268134a425315b4bf4ff99f0123d564a5f947846269832bfa76adc526632e7`,
  also passed the public consumer protocol in an isolated Linux/x64 Bun 1.3.14
  container: source preparation, official build and two compiled server starts.
  A diagnostic resume and a subsequent fresh synthetic-state run passed. An
  initial run during competing host qualification failed actor startup; the
  underlying reason was not established. No authorization, checksums, startup
  deadlines or runtime behavior was relaxed to obtain the passing runs. This is
  not a cold-start latency/stress guarantee and is not the selected update.
- Full-suite preflight identified existing main failures in a regex import guard,
  historical theme count, and malformed SMTP/IMAP documentation snippets.
  Corrections keep exact real-import checks/retained compatibility mappings and
  compile all 60 service examples. Missing independent Chrome source and payments
  dependencies are qualification prerequisites, not shipped blog dependencies.

The admitted Chrome source fixture is clean child commit
`622ef4e4eeb2577510417d0405286c7771765fe4`, tree
`3a512e1620c18a02bbe4d50cb9b9d569932a5295`, tar SHA-256
`4b61c262ecab99041b3b0c20995f2fe2c540389a7c566de85fc55bf1e0ecc59b`.
It is excluded from the framework archive. Initial full-suite preflight was
stopped after failures; it is not a full-suite pass. Exact final candidate
qualification must be rerun with the declared prerequisites and scratch root.

The subsequent dependency audit rejected the older baseline's Zod 4.2.1,
Undici 7.30.0 and Vite 7.3.6. The minimal compatible source-graph update uses
Zod 4.6.6, Undici 7.30.1 and Vite 7.3.7; `bun audit --json` then returned `{}`
and zero exit status. Schema/decision/audit/limits/blog follow-ups passed all
12 selected files and typecheck passed. Earlier archive/browser/Linux evidence
does not by itself qualify this changed dependency graph; repeat final installed
and complete-suite gates. An app's independent lock/overrides still need their
own audit; framework-root overrides are not an application security certificate.

Primary advisory references: [Zod collection validation](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5),
[Undici content encodings](https://github.com/advisories/GHSA-xjj6-f33q-929c),
[Vite middleware](https://github.com/advisories/GHSA-9jrq-w75r-8gcw).

These are focused checks, not a complete release claim. Exact candidate archive,
installed Linux/bundle qualification and final review remain required.

## Wider Qualification Follow-up

The 8980f96 complete-suite attempt was stopped after concrete failures; it is
not a passing release run. The next candidate includes these narrow repairs:

- The retained Select math facade now forwards `selectDepartureLanded`, keeping
  old/new source-copy imports identical instead of duplicating the function.
- Source-only Doctor caches admitted literal source edges per inspection. The
  original filesystem/operation limits remain unchanged; repeated barrel-symbol
  queries no longer spend the filesystem budget re-resolving identical paths.
- Consumer path checks run outside the repository's intentional source aliases.
  Browser fixtures give emitted CSS its own output extension, as the production
  builder already does. Central styles and component CSS owners are retained.
- Historical relocation/theme snapshots keep their original hashes and explicitly
  admit the approved drawer, scroll and blog-anchor enhancements. Legacy theme
  bytes still match after removing only the five exact new-family imports.
- Reviewed full-framework blog/payment consumers share the existing installed
  consumer admission slot. This does not skip, retry or extend any test deadline.
- A real-browser first-use profile test exposed accepted session publication
  unmounting/canceling its originating form before its success callback returned.
  A failing deterministic controller regression confirms that boundary. The fix
  detaches form cancellation only after accepted completion; pre-acceptance
  cancellation, replacement, disposal and explicit synchronization errors remain
  covered. All five focused auth/browser files pass after the fix.

The 8980f96 Linux/x64 consumer passed resumed source preparation, the official
build and two compiled server generations with the patched dependency graph.
Its initial fresh run failed before logging-actor entry. Diagnostic source
preparation and resumed startup passed without changed runtime code, retries or
relaxed deadlines. That does not establish the initial failure's cause or a
complete fresh-candidate pass. A final clean install/run remains required.

Qualification now uses independently installed frozen dependencies, not a
dependency-directory symlink to an active development worktree. Rebuildable
scratch symlinks were retired without changing their shared target files.

Candidate `8bb62f1` has archive SHA-256
`74b1026c3fc92cc0b84ccd3998a7ac3d8ba4a2e44710142396845cd554c42a17`
at `/Volumes/code-bank/artifacts/zero-platform/dev/blog/8bb62f1/zero-framework.tgz`.
Its fresh Linux/amd64 consumer completed installation, source preparation, the
official build and two compiled server generations with strict audit admission,
native image delivery, retained identities/history and private actor environments.
This is a feature candidate, not a selected stable update or a latency guarantee.

The expanded native editor browser flow now also covers taxonomy creation,
actual image upload/normalization and alt text, anonymous image decode and live
view observations, mobile-width editing, public-byline draft/publication and
the live observations table (14 assertions, real APIs). It preserves the earlier
dirty/conflicting-draft and formatting checks. Operational/recovery guidance now
has a dedicated linked manual; it makes no automatic backup/erasure promises.

The payment archive timeout was isolated to cold qualification work, not a
provider/charge regression: installation/typecheck/runtime/cleanup completed
in 97 seconds when admitted alone. Measured competing-run stages exceeded the
original test's aggregate deadline. No production code, provider endpoint or
test deadline was changed. Its stage diagnostics remain visible, and the final
complete suite will use one process admission to avoid competing package/build
I/O; a failed run is retained as failed rather than treated as a passing retry.

## Focused Review And Remaining Release Gates

- [x] Focused recovery/authority review: shutdown drain, media lease expiry and retained
  cleanup, strict audit admission and native scope ceilings.
- [x] Review optional bounded aggregates/collection and current-authority UI;
  never claim unique people, attention or audit evidence.
- [x] Expanded public reader and editor/media/taxonomy/author browser checks;
  these focused flows do not establish every optional interaction or package shape.
- [x] Expanded single/multi-tenant and simple/advanced RBAC tests, disabled and
  migrate:false behavior, additive migrations and source/bundle identity.
- [ ] Current API/configuration/operations/upgrade docs, browser evidence,
  installed Linux qualification, review and qualified release archive.

The expanded managed suite passes 11 tests/95 assertions, including all four
tenancy/RBAC combinations and a new retained-content recovery check: after a
drained synthetic root is moved aside, startup rejects missing content without
creating a replacement; restoring that exact root preserves drafts/history.
No owner/ledger rows are cleared to obtain recovery. Final complete-suite and
updater admission still remain separate release gates.

The frozen `975db2f` broad run additionally exposed a remaining fixed-output
browser-fixture collision in IntegrationSettingsList: JavaScript and imported
CSS both targeted `fixture.js`. The remaining eight affected qualification
harnesses now use extension-aware output names. Their focused fresh-process
run passes all eight files without removing style imports or changing runtime
behavior. The original frozen run is retained and is not a passing release gate.

Further broad-run reconciliation preserves the original facade digest while
admitting only the already-released `AppShellLinkProps` addition; diagnostic
expectations now retain the trusted bridge's original `sourceCode`. Headless
author-only fixtures explicitly select `content:false,pages:false` rather than
attempting to bundle a public reader in a deliberately dependency-free app root.
Full default publishing remains covered by installed/source/bundle tests.
Keyboard modal tests wait for actual scene/background admission and the completed
Motion height target instead of dispatching through inert exit paint.
Destructive confirmation tests use the managed `alertdialog` role.

The installed profile consumer exposed an additive type-compatibility gap:
caller-supplied older avatar capability projections lacked `publicAccess`.
That wire/presentation field is now optional (absence stays private); resolved
server policy remains a required boolean and explicit publication checks are
unchanged. The complete installed profile proof subsequently passes against the
`0b7e69b` candidate (76.6s), with another 75.4s pass in the corrected-admission
follow-up. Those focused passes do not replace the required full candidate run.

The complete frozen `975db2f` inventory finished with 1320/1338 files passing;
18 failed and none were skipped/not run. Its log remains in diagnostics. The
remaining distribution smoke now expects all 48 additive migrations, while
preserving every older migration's checks. Public UI export rejection is tested
from an external consumer process, not the repository's broader development
aliases. Modal source/archive checks remove only the exact three approved blog
CSS imports before comparing the unchanged original theme hash, while still
verifying raw installed/source identity. An unchanged native FTS scenario which
exceeded its original 20s deadline in that full run passes in 8.9s when isolated;
no timeout was raised and no vector production behavior was changed. A fresh
complete candidate run and the heavy installed/updater proofs remain required.

Do not reset data, alter prior migration checksums, replace Guardian identities,
publish private avatars, loosen admission or expose private Storage paths to
make a test pass. The blog remains one application-owned Fabric file in either
tenancy mode by default; explicit organization ownership is a compatibility opt-in.

## Combined candidate follow-up

The `0b7e69b` Git-object archive passes its four installed package gates, normal
existing-app dry-run/update/frozen-reinstall rehearsal and Linux/amd64 installed
source-to-bundle publishing/restart proof. Its complete-suite attempt is retained
as a failed gate, not replaced by those focused successes. It exposed further
loaded-browser timing and cold archive-admission failures. Seven missing genuine
full-framework archive consumers are now in the reviewed resource catalog;
exclusive windows preserve the original cold-I/O/hot-auth/native-vector deadlines.
Its full 1339-file run finished with 1326 passing, 13 failing, none unrun and no
interruption; all original output is retained. No test is retried, omitted or
given a larger timeout. A fresh full run is required.

The native ContextMenu producer now uses a transient 120ms Web Animation instead
of changing/restoring consumer inline declarations inside Motion's final render
batch. The complete browser suite retains DOM refs, native animation/drag events,
touch/keyboard and the exact original content/style files. Polar topology tests
wait for React's actual commit before asserting the unchanged live descriptions.

Managed messaging integration additionally exposed a core writer-lane lifetime
bug: `pump()` starts a queued callback from the prior operation's completion
context. Without a submission-time async-context binding, a new operation can
inherit a retired logging attribution (or another actor's attribution). A new
deterministic FIFO test fails before the repair and passes afterwards; the 73-test
coordinator/lane qualification passes with unchanged ordering, queue bounds,
authority fences and mutation semantics. Messaging's repeated native send also
passes the formerly failing replay boundary after this repair. This core fix
belongs in the blog/logging candidate independently of unfinished messaging APIs.

The corrected-admission 13-file follow-up passes 12 files, including both hot-auth
contention gates and all fresh archive consumers. The remaining real native FTS
file exceeds its original third-case 20s deadline in that attempt. A retained
diagnostic times the native reopen/index creation boundaries; a subsequent
uninstrumented canonical run passes all three original cases and deadlines.
No vector production behavior or timeout is changed. The failed attempt remains
failed evidence; a fresh complete frozen-candidate run is still mandatory before
selection. Root typecheck, external-output build, dependency audit (no reported
vulnerabilities) and the 864-page documentation graph pass for the repair tree.

The `2798578` archive also passes the complete package script and the exact normal
updater/frozen-reinstall rehearsal. Its Linux proof is **failed**, not qualified:
the SDK-only source preparer uses one initial audit acknowledgment and later hits
required admission during its longer setup. An SDK client alone has no AppProvider
collector. The fixture now maintains authenticated observation heartbeats at the
actual returned policy interval, with no protected-operation retries, longer TTL
or admission exception. The bundled stage still first proves an unacknowledged
session is rejected. Exact-archive Linux/full-suite qualification remains required.
