---
id: zero.work.practiceiq-integration-repair
type: operations
audience: [agent, maintainer, developer, operator]
owner: platform
status: draft
visibility: internal
---

# PracticeIQ Navigation, Logging And Avatar Repair

[Working evidence index](./index.md) · [PracticeIQ integration handoff](../guides/practiceiq-upgrade/navigation-audit-avatars.md)

## Scope And Safety

Repair framework-owned defects against released main, independently of the
postponed blog/website work. The reported installed baseline is Zero 2.6.0,
commit `be266f5fd7ed063c9cfe43c385b8a80b90e5902a`, archive SHA-256
`1ce5585d21e8aa1e5110e83931e17fe9992ad273a725e7bbb9a56fb5edd90409`.
PracticeIQ's installed `zero-release.json` agrees. The app worktree is inspected
read-only; its live deployment/data, installed dependency and branches are not
modified by this repair.

The completed single-tenant database conversion is not repeated. Preserve
application/SYSTEM separation, compliance policy, Storage/KV identities,
logging custody, migration receipts, sent effects and existing recovery state.
Do not undo the canonical core-migration build correction or change the app's
one-total-attempt workflow declaration. No production administrator credential
is manufactured to inspect health.

Required reading includes the app AGENTS.md, exact installed orientation and
owning AppShell/router, Logging browser/API/operations, Guardian avatar/profile,
observability, engineering and release guides. Source inspection must distinguish
current contracts from historical compatibility text and future routing plans.

## Boundaries And Initial Findings

| Boundary | Current evidence | Ownership / intended correction |
| --- | --- | --- |
| Sidebar/brand/breadcrumb activation | AppShell uses native anchors; its documented public contract has no link adapter. The app supplies ordinary href descriptors. | Framework: additive router-aware link composition using the existing Zero Link. App: adopt the documented integration after upgrade. No router.push + still-active href workaround. |
| Route/layout rendering | Existing hydration runtime reuses imported layout component identities, but this has not yet been proved for the complete AppShell/audit flow. | Qualify real generated routes, shared shell/provider identity and document requests. Fix any demonstrated runtime remount defect without replacing the router or starting the deferred TanStack/SSR project. |
| Required delivery presentation | `confirmed` begins null and the guard presents the same alert/Retry panel for normal first acknowledgment and actual failure. | Framework: explicit pending/ready/failure states; retain strict masking and server grant rules. A healthy renewal must not remount protected output. |
| Navigation observation | Source inspection shows URL changes are noticed only by the 30-second heartbeat; rapid transitions can be collapsed before the next tick. | Reproduce and add immediate admitted-navigation observation, with duplicate suppression and retained bounded delivery. URL observation is not proof of a semantic record read or human attention. |
| Operational bridge | PlatformEvent.code is copied to a lowercase-only logging action. Existing uppercase APP_* codes are valid custom observability usage but fail that action boundary. | Framework: explicit safe operational mapping and retained original code; keep audit validation unchanged. Preserve original sinks and visible failure counters for inadmissible input. |
| Avatar backend | Released installed Linux/Chromium reproduces stage 200 then signed image PUT 400 / STORAGE_INPUT_INVALID before finalization. A native Bun HTTP-stream probe isolates a TypeError at local-adapter reader.releaseLock after reading. The live report's exact 500 stack is not independently accessed. | Framework: best-effort reader cleanup must preserve successful bounded reads or substantive failures. The profile bounded reader uses the same cleanup rule. Limits, durability, private grants and authority fences are unchanged. App agent must separately verify its deployed flow. |
| Avatar discoverability | The current image control advertises editing mainly through its hover overlay. | Framework: persistent Upload/Change action, clearly labeled replacement/removal, keyboard/touch, progress and safe retry. Preserve staged upload and shared profile CAS. |
| Audit discoverability | PracticeIQ already mounts administrator-only native LoggingWorkspace at its audit route; its sidebar has no direct Audit entry. | App-owned navigation suggestion, not a new logging dashboard or missing framework logging implementation. |

These are investigation findings, not claims that fixes or deployed-browser
qualification have already passed.

## End-To-End Contracts

### Navigation And Admission

1. Render the managed generated app with one unkeyed root AppProvider and a
   shared protected AppShell layout.
2. Activate an ordinary internal sidebar, brand, breadcrumb or built-in menu
   link through the supported Link adapter. Preserve real anchors, attributes,
   refs, native modified/middle/new-tab/download/external behavior and existing
   parameterless onSelect callbacks.
3. Admit navigation through existing unsaved-change guards; retain shared
   layout/provider/collector ownership while the new route module resolves.
4. Observe each admitted URL transition promptly, without raw URL/query/hash
   storage, a second collector or false successful-page-read evidence. Do not
   record a canceled guard decision as completed navigation.
5. Deliver observations with the original actor/session/scope, stable IDs and
   normal retry/deduplication. Verify retained audit events through authenticated
   supported APIs, including several transitions inside one heartbeat interval.
6. Maintain server-required delivery. First healthy admission is a neutral
   pending state, not a failure alert. Genuine failed/expired delivery masks
   protected work, explains the failure and supports bounded recovery.
7. Hard refresh/new tab still establish their own valid admission. Revocation,
   logout, account/org/policy replacement and source/worker failure retire old
   authority; no stale acknowledgment or cached UI bypass is introduced.

### Operational Diagnostics

1. Emit the reported uppercase custom codes through the public app-local
   observability emitter, with synthetic static metadata only.
2. Map eligible diagnostic codes at the operational bridge, not by relaxing
   the common audit-event action validator. Preserve already valid lowercase
   codes, original source code, event identity, level/category and old sinks.
3. Await admission/flush, then query operational retained records and health
   as a legitimately signed-in synthetic administrator. Separately query audit
   records, pending/source discovery and failure/backlog counters.
4. Test invalid/malicious codes, descriptor/proxy input, metadata bounds,
   fallback-sink recursion, custom sink mutation, detach and stream/scope
   retirement. Invalid data remains observable, not silently discarded.

### Native Avatar

1. Load the actual native profile page and private avatar snapshot.
2. Discover Upload photo without hover; select a synthetic JPEG/PNG/WebP using
   the real control and crop dialog.
3. Observe the real revision-bound stage, signed upload capability, browser
   byte upload and finalization. Record only route templates, status, stable
   codes and allowlisted static messages; never capability URLs/proofs/bytes.
4. On acknowledged attachment, adopt only the new shared profile revision;
   retain any unsaved name/bio edits. Save the ordinary profile successfully.
5. Deliver the normalized private image through authenticated native transport.
   Refresh and restart the same isolated installed app; verify retained bytes,
   revision and privacy without resetting its databases or Storage root.
6. Replace/remove; test stale revisions, canceled/expired grants, malformed and
   oversized rasters, interrupted delivery, read-only policy, revoked sessions,
   foreign identities and UI disposal. Rejected operations cannot attach media
   or advance a false accepted baseline.

## Implementation Sequence

1. Freeze/reproduce the exact installed archive in a fresh synthetic consumer
   on Linux/amd64; run real Chromium against its actual managed server. Use a
   real supported registration/login ceremony, never a fabricated token.
2. Save failing navigation/document-count, pending/failure UX, rapid observation,
   uppercase-diagnostic and avatar lifecycle reproductions. Trace the first
   failed avatar boundary before choosing a fix.
3. Implement focused framework changes: AppShell link composition, delivery
   state presentation, navigation observation, diagnostic mapping, demonstrated
   avatar backend/transport repair and native avatar controls. Keep each owner
   small and preserve public compatibility/default standalone behavior.
4. Run focused source tests as fast feedback, then rerun the full generated-page
   browser flow, authenticated retained-event/health checks and avatar lifecycle
   on Linux/amd64 using the exact committed candidate archive.
5. Review security, native link semantics, initial/failed/expired admission,
   session recovery, source-to-official-bundle migration identity, private
   workers/environment and existing profile/Storage regressions.
6. Update owning manuals plus a narrow PracticeIQ integration handoff. Identify
   exact app-owned adapter/sidebar adoption separately. Do not edit PracticeIQ
   or call its production authenticated APIs without an authorized session.
7. Commit, qualify a clean source/archive, merge released fixes to main and push
   both approved framework remotes. Select the exact qualified archive through
   the normal saved-main release path; return commit/path/SHA and limitations.

## Evidence And Release Gates

- Count actual document navigation requests and retain a per-document fixture
  identity plus shared provider/shell identity across several protected routes.
  Eventual page text alone is insufficient.
- Use a MutationObserver in the synthetic browser fixture to catch even brief
  misleading retry/confirmation panels. Assert no such flash during healthy
  client navigation. Pending admission still masks protected content.
- Test mouse, keyboard, modified/new-tab/external/native fallback links,
  Back/Forward, prevented navigation, query/hash and unknown/server-only routes.
- Verify every rapid navigation signal is durably queryable with current actor
  and scope. Exact retry does not duplicate it. No raw clinical URLs, labels or
  content enter event metadata or diagnostics.
- Verify genuine blocked delivery, hard refresh/new tab, grant expiry,
  revocation and native Retry recover/fail closed without losing the recovery
  controller or weakening server/Sync/SSR enforcement.
- Verify retained operational/audit events and authenticated logging health,
  source backlog and bridge diagnostics—not just public /api/health.
- Run the complete native avatar browser sequence on Linux/amd64, including
  real normalization/private delivery and source-prepared → official bundled
  server restart. Include failed-input and stale-authority protections.
- Root types, focused regressions, public exports, package install/build,
  documentation/examples and whitespace checks must pass. Preserve original
  migrations, custody and live app state.
- Record exact source/archive/image identities, commands, pass/fail counts and
  sanitized diagnostics. Source/macOS tests are not Linux deployed-browser
  evidence. A live authenticated production check not performed remains an
  explicit app-agent deployment acceptance item, never an invented green result.

## Progress

- Exact baseline/app instructions and installed owning docs read; app remains
  unchanged. Repair branch starts from released main, without blog commits.
- Exact archive baseline reproduced in Chromium against the installed official
  Linux/amd64 bundle. Four sidebar transitions made four document requests/four
  failure-panel flashes, lost shared shell identity, and retained no navigation.
  The invisible avatar action staged successfully then failed signed PUT with
  STORAGE_INPUT_INVALID. Uppercase operational events were not retained.
- Focused source tests reproduced rapid-navigation loss, uppercase event rejection,
  native HTTP stream failure and cleanup masking before implementation. Corrected
  tests preserve original substantive source errors, exact uploaded bytes and
  checksums. Existing private image/CAS/revocation/cancel/image-limit tests pass.
- Working-package Linux/Chromium preflight passes the original flow: zero document
  requests, zero failure-panel flashes and stable shared shell across all four
  transitions; all four navigation records retained; visible photo action;
  stage/upload/finalize/private delivery/profile save/refresh all succeed.
- Expanded Linux preflight also passes Back/Forward, brand/breadcrumb/Zero Link,
  portaled account menu, dirty-form Stay without a completed navigation event,
  new-tab admission and real blocked-delivery/native-Retry recovery. Its current
  runtime health reports operational bridge retention separately from audit health.
- Existing generated sign-in/blocked-delivery/session-retry browser tests pass.
  The profile/browser suite's presence assertion was updated to check the stable
  photo action's accessible description; its focused rerun passes.
- Root typecheck, structural documentation checks (840 pages, no problems),
  AppShell SSR/backward compatibility and public UI example compilation pass.
  A broader, unchanged service-document checker already has seven SMTP/mailbox
  fragment examples outside its historical 53-fence inventory; it is not claimed
  green and unrelated email documentation is not rewritten as part of this repair.
- The committed implementation `1bc732ba4375e87621f1be093ef257a7e11ff9e5`
  was installed/officially bundled on Linux/amd64 (Bun 1.3.14). Full Chromium
  lifecycle including private byte-hash preservation across restart, current
  browser/new-tab admission and blocked-delivery Retry passes. Every one of
  5442 installed package files matches its committed archive, SHA-256
  `7dee756ef38276aa6b35053457266815951239c1b411e2bb30dd478d8198c1ea`.
  This is implementation qualification, not the final main updater identity.
- Verification includes 85 focused source tests (12 files); installed public
  facades build/typecheck/render with the default stylesheet's real import chain;
  core source/bundle migration checksum checks; generated native sign-in,
  expired/blocked delivery, session Retry, revocation, profile/CAS/crop/320px,
  native link/prefetch and collapsed sidebar regressions. The build-only browser
  fixtures run in clean subprocesses like the CLI, avoiding unrelated server
  TSX hooks installed by another test in the same Bun process.
- Test-only probes use the explicit fixture path, never a worker's protected
  empty launch cwd. Native owners correctly reject unknown files there; that
  control was not weakened to accommodate a probe. Host inspection uses its own
  legitimately authenticated session and renews its required admission after
  restart. Operational retention is awaited rather than treating a best-effort
  diagnostic emission as a synchronous durable receipt.
- The updater archive also includes the documentation/test-harness corrections.
  Its final identity is distinct from the implementation archive above: require
  a fresh clean source-to-bundle/native-restart run before main selection, then
  record the exact normal `zero-release --status` commit/path/SHA in the release
  handoff and retained diagnostic report. Do not substitute preflight bytes or
  the unchanged semantic version. No app production deployment/health check is
  claimed by this framework qualification.
