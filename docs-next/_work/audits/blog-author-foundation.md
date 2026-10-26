---
id: zero.audit.blog-author-foundation
type: operations
audience: [agent, maintainer]
owner: blog
status: in-review
visibility: internal
---

# Blog Author Foundation Qualification

[Audit index](./index.md) · [Author backend](../../backend/blog/index.md) · [UI qualification](./blog-ui-qualification.md)

## Resumed Continuation 2026-10-26

Work resumes on `feature/blog-foundation-current`, preserving the original
`feature/blog-foundation` checkpoint and its archive below. The continuation
integrates main through `be266f5fd7ed063c9cfe43c385b8a80b90e5902a`, including
compliance delivery, provider provenance, persistent session recovery and the
source-to-bundle core migration identity fix. It is not selected by the normal
updater and has not been merged to main.

Main's released migration 045 is private Storage artifact metadata. The earlier
author preview had independently used 045/046. The continuation preserves
released migrations 001–045 unchanged and places public avatars/authors at
046/047. Existing released-main ledgers upgrade additively; prior author-preview
ledgers fail closed instead of being relabeled. The
[preview boundary](../../backend/blog/upgrade.md#earlier-feature-branch-preview)
explains why there is no automatic receipt repair or deletion of preview data.

The production build retains **all three** relevant adapters: canonical core
migrations, canonical private Logging realms, and the email CSS grammar data
adapter from the blog/SEO branch. The frontend export guard now explicitly
accounts for the added blog/palette/anchor symbols while still checking the
original frozen export digest; it does not rebaseline the original contract.

Fresh continuation checks use disposable synthetic data only:

- Focused merge/migration/build/config/facade checks: 30 passed, 0 failed,
  1016 assertions across 10 files. This includes source-ledger → bundled-ledger
  equality for all 47 core migrations, retained private artifact references,
  unchanged identities/credentials/profiles and refusal of old preview ledgers.
- Wider author/Guardian/request/migration regressions: 363 passed, 0 failed,
  3363 assertions across 70 files. Package installation is recorded separately.
- Chromium: 18 passed, 0 failed, 103 assertions across the 15 retained blog UI
  scenarios and three generated-page/session-audit recovery scenarios. The
  in-app browser connection was unavailable; the repository's actual Chromium
  suite ran with no skipped tests.
- The frozen frontend export contract and symbol-identity tests both pass
  (25 assertions). The first combined run exposed the previously unaccounted
  blog/palette additions; the exact-addition guard was corrected and rerun.
- Root TypeScript and the documentation structure/link checker pass. Additional
  installed-archive evidence must identify the continuation's own source and
  bytes; the older archive below is not a substitute.

Diagnostics use the `blog-current-*` prefix under
`/Volumes/code-bank/artifacts/zero-platform/diagnostics/`. These checks qualify
the resumed foundation, not a new post CMS. Author-management UI, post storage,
block editing, publication and automatic article SEO remain the explicitly
planned layers in the [roadmap](../../backend/blog/roadmap.md).

## Scope And Release Boundary

The frozen implementation is `c7011c7dd9dc8561b767752be51029a31ac327cf` on
`feature/blog-foundation`, following UI/documentation source
`72bb87d55055b5b07776a1ad450040464729688d`. This is not a main merge, selected
stable package, registry publication or live-app upgrade.

The retained development archive is `zero-framework-2.6.0-blog-authors.tgz` at
`/Volumes/code-bank/artifacts/zero-platform/dev/2026-10-25-blog-authors/`.
Its SHA-256 is
`98d564817e4b659d7327d1e11f7206e88cf2c9eb4a25b60e251dde294e4e8b25`.
It was packed from clean committed source with lifecycle scripts disabled.
The following documentation/evidence commit does not change those archive
bytes. Earlier UI archives retain their original identities.

The implementation adds managed user-backed author enrollment, separate public
drafts, scoped publication/withdrawal, optional public Guardian avatars, browser/
request facades, live authorized projections and same-transaction Guardian
audit. It deliberately does not add post storage, a block editor, auto article
routes, scheduling or automatic blog SEO. Existing recovered UI and original
theme/source are retained.

## Review Findings Corrected

- Public avatars were private-only previously; new opt-in is explicit and never
  changes Storage drive visibility or publishes existing images.
- Managers can withdraw/suspend a retained author without first reactivating a
  suspended account. Self edits remain restricted to active eligible authors.
- Profile/author input is closed, bounded and CAS-checked; sparse/accessor social
  arrays are rejected without executing callbacks.
- Final authority failure rolls back the author and its Guardian audit event.
- SDK retirement cancels even a custom SSE reader whose transport ignores abort;
  late account/org results cannot be delivered to a replacement view.
- Doctor distinguishes missing publication/author schema and pending policy
  without mutating a database, provisioning media or enrolling users.
- An outdated property guide claiming Guardian had no avatar feature was
  corrected to link the current dedicated owners.
- Enabling the optional account-author facade no longer intercepts unrelated
  admitted API-key routes during service projection.
- The actual managed pipeline with dedicated Logging workers exposed a Bun
  native-reader lock-release failure after valid photo bytes were exhausted.
  Storage now treats only that final cleanup as best effort, preserving both
  accepted bytes and original read failures; provider/content checks are unchanged.

## Evidence Discipline

Tests use synthetic identities, isolated in-memory/file-backed databases and
local Storage/loopback services only. No real application files, public theme,
live credentials, databases or providers are changed. The managed upgrade
regression checks real credential rows, not a sanitized user projection that
does not contain a password hash. New migration snapshots are additive and do
not modify prior definitions/checksums.

## Final Checks

| Check | Result and boundary |
| --- | --- |
| Backend/regression suite | 362 passed, 0 failed, 2964 assertions across 71 files: author/config/SDK, actual Guardian/private and public media, profile completion/disposal/policy, request service/authority fences, read-only Doctor, Storage streaming and migration/legacy preservation. |
| Managed existing-project pipeline | Included above: persisted account ID/hash/role and old session preserved; app rows untouched; minimal profile expansion; actual Storage grant, normalized photo, explicit public publication, author projection and dedicated Logging delivery. Profile-only and migrate:false paths are separate regressions. |
| Four Guardian profiles | Source tests cover single/multi simple and advanced management/isolation with current session authority. The installed consumer below uses single/simple, not a claim of a fully installed all-mode matrix. Native media/profile scope ceilings remain covered by their existing real integration suite. |
| Frozen installed author package | 1 passed, 10 assertions: fresh consumer uses only public imports, normal managed boot, real SDK registration/private profile edit, role-preserving author operations, actual normalized photo upload/public delivery/withdrawal, public byline privacy/withdrawal, server request facade and browser bundle. |
| Retained UI and installed package | 15 passed, 351 assertions: all 109 recovered export dispositions, Magazine/sidebar article defaults, safe optional sections/URLs, palette behavior, real public SSR/CSS/browser exports and packaged manuals. No new browser-visual pass is implied by this backend update; the prior UI browser qualification remains recorded separately. |
| TypeScript | Root `tsc --noEmit` passed. |
| Documentation | Structural/link/anchor/reachability check: 855 pages, 855 unique IDs, all reachable, no problems. Public-contract example and review-metadata checks: 8 passed, 0 failed, 116 assertions. |
| Whitespace | `git diff --check` passed; repeated for the final documentation update. |

Tests use Bun 1.3.14 and local host-native Sharp, with React/React DOM 19.2.4
in fresh package consumers. These are focused framework/upgrade checks, not
production deployment, a post CMS or universal application migration approval.

The first broad run used the Mac's symlinked default temporary root for old
offline-migration fixtures. Strict canonical-path admission correctly rejected
it. Repeating with the required external canonical `PROJECT_SCRATCH_DIR` and
`TMPDIR` passed; no migration safety check was relaxed. An old account-email
TTL documentation fragment also needed its example test to wrap it as an
AppConfig fragment rather than an invalid standalone expression. The runtime
and TTL settings were not changed by that documentation/test correction.

Sanitized diagnostics live under
`/Volumes/code-bank/artifacts/zero-platform/diagnostics/`: the final
`blog-author-regressions-final`, `blog-author-package-final`, `blog-author-ui-final`,
`blog-author-types-final`, `blog-author-docs-final` and
`blog-author-doc-examples-final` logs. They contain synthetic fixture evidence,
not live application data or provider credentials.
