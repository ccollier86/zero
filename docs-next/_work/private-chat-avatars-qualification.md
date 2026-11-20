# Private chat avatar qualification

This source candidate adds viewer-to-subject private avatar policy and native
messaging presentation. It is not an approved release, installed-application
cutover, browser qualification or deployment claim. The unrelated Calendar
work is outside this candidate.

## Focused source evidence

On November 20, 2026 the coordinated cache-off Bun 1.4.4 source diagnostic
passed **95 tests across 14 files, 0 failures, 781 assertions** in 15.14 seconds.
It used the explicitly borrowed, read-only development dependency map, not a
frozen release installation. The Guardian integration uses real Elysia/native
Storage routes with owned ephemeral databases, a memory blob adapter and a
temporary loopback listener; it is not a real-browser or Linux deployment test.
All streams, readers, listeners, object URLs, servers and databases created by
the tests were closed. No physical fixture/build/archive was generated.

The no-emit diagnostic checked 168 production roots / 4,869 transitive source
files with **0 diagnostics**, using the same explicitly borrowed type mapping.
Canonical documentation target checks found 77 local links across six changed
guides/handoffs and no missing targets. Independent final security review found
no source blocker in runtime composition, policy retirement, scope ceilings or
the copied-URL/provider/chunk delivery fences. None of these is an installed
archive, browser, deployment or updater approval.

The initial integration attempt had one synthetic fixture failure: suspending
the only active organization owner correctly hit Guardian's existing safeguard.
The fixture gained a second synthetic owner, then all 20 integration tests
passed. A combined diagnostic compile caught a duplicate presentation parser
declaration and an unnecessary auth-false branch; both were corrected, not
hidden. Borrowed package-export/type mappings were then completed for the
no-emit diagnostic. Earlier mapping/import failures are not release results.

The focused no-file checks belong in:

- `src/auth/auth-user-avatar-read-policy.test.ts`: policy admission and live
  authority rechecks around provider/body awaits.
- `src/auth/auth-user-avatar.integration.test.ts`: in-memory Guardian, private
  Storage grants, actual private routes, denied copied asset paths, native
  self-only consent and own editing continuity.
- `src/frontend/client/auth-user-avatar-transport.test.ts`: legacy directory
  reply admission, strict additive revision/private presentation parsing,
  authenticated no-store bounded delivery and account retirement.
- `src/frontend/client/user-avatar-presentation.test.tsx`: per-mount object-URL
  ownership, revision/reused-path replacement, null/removal fallback, pending
  subject/authority races, synchronous abort/revocation and unmount cleanup.
- `src/components/messaging/messaging-workspace-controller.test.ts`: live
  metadata replacement independent of conversation revision, authoritative
  omissions, late refresh/watch fences and selected/denied scope retirement.
- `src/messaging/presentation-invalidation.test.ts`: payload-free coalesced
  presentation invalidation, unrelated SYSTEM write suppression without
  suppressing Guardian authority revisions, rollback and subscription ownership.
- `src/frontend/server/app-user-avatar-policy.test.ts`: runtime configuration
  isolation, legacy fingerprint compatibility, A→B→A retirement and application
  read-plane/current Guardian context.
- `src/messaging/private-avatar-projection.test.ts` and
  `src/messaging/private-avatar-stream.test.ts`: admitted per-viewer metadata,
  group peers distinct from DM targets and photo-only stream refresh/withdrawal.
- `src/frontend/client/messaging-private-avatar-watch.test.ts` and
  `src/messaging/visitor-client.test.ts`: native additive watches and unchanged
  anonymous support stream contract.
- `src/frontend/client/messaging-response.test.ts`: strict additive metadata
  parsing while retaining legacy replies.
- `src/auth/auth-user-profile-policy.test.ts` and
  `src/doctor/auth-public-path-checks.test.ts`: existing bootstrap retirement
  and Doctor public-path behavior with a runtime-only policy.

Shared development dependencies may support explicitly admitted source
diagnostics only. They cannot establish frozen release qualification. The
storage integrity hold blocks new physical fixtures, dependency installs,
browser builds, packaging and deployment runs until it is resolved. Do not
bypass the hold or reinterpret unexecuted tests as successful evidence.

## Required release and application gates

Follow [the release checklist](../../docs/releasing.md#release-checklist) with
one exact clean committed tree and its independently installed frozen
dependencies. Keep source/package/full-inventory/browser/Docker/updater phases
sequential. Record commit, version, archive SHA-256 and each gate result
separately; a focused source pass does not substitute for the final inventory.

Use `ZERO_MESSAGING_ARCHIVE` with the installed messaging package test for the
exact committed archive. Verify public exports/types, packaged source, SSR and
the browser dependency boundary. This consumer has no installed backend and is
not Linux, stable-selection or updater qualification.

Extend the managed house fixture and native installed browser fixture with a
resident, a same-house resident excluded from direct-message targets, and an
assigned staff member. Upload through the normal profile flow. Check decoded
private photos in the contact picker, participant roster, header, conversation
previews and messages. Check both directory and copied-byte endpoints as an
anonymous, unrelated active and former resident. Transfer/end assignment while
open, then confirm the last allowed relationship disappearing clears previews
and denies the same held asset path. Replace/remove from another session and
verify new revisions, retired-path denial and initials. Switch/sign out during
held reads; no late promise may restore prior-account bytes.

Before executing existing file/browser fixtures, use supported synthetic
ownership markers and immediate finally cleanup of their exact databases,
build roots and processes. The older messaging browser fixture's stop-only
teardown does not clean its generated roots and must not be copied unchanged.

Run the pinned Linux/amd64 official-build and crash/restart proof described in
`src/messaging/test-support/managed-deployment/README.md` against the same
archive, including the new private directory/body policy checks. Use explicit
local Docker context and disposable project/run labels. Preserve the verified
bundle across restart; do not hide another installation/compile in that gate.

Exercise the normal saved updater against a populated owned disposable app.
Verify archive/package-owned hashes and lock binding; preserve app source,
configuration, environment, database and Storage bytes. Review rollback and a
subsequent ordinary frozen install. Do not edit an application package tree or
force-scaffold it to simulate an update.

Only after approved publication should main/tag/remotes and selected committed
archive agree. Read `zero-release --status` before and after normal selection.
Main hooks can refresh that shared workstation selection; a feature checkout
does not select itself. Strong Tower's application fixture/cutover remains a
separate approved follow-up; no live application state is touched here.
