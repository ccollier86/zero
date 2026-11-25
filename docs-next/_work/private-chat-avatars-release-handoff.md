# Standalone private chat avatar update handoff

## Status and isolation

This is the standalone Zero 2.11.1 private-photo patch developed on
`fix/private-chat-avatar-authorization`. Source documentation is frozen before
exact-archive qualification; it does not predict a publication outcome. The
release coordinator records the actual final commit, archive path/SHA-256,
installed-package/Linux/updater results and main/tag/normal selection result in:

`/Volumes/code-bank/artifacts/zero-platform/diagnostics/private-chat-avatars-release/qualification.json`

Use that receipt and `zero-release --status`, not this version heading, to
identify the package actually selected for normal updates. Publication occurs
only after the required real gates pass. Do not use a source checkout or copy
individual installed package files as a substitute for release. An application
update/deployment remains a separately approved action.

The source starts at main `4d2eb26034783cb77622a249c0cc57f48760331e`
(Zero 2.11.0), plus standalone messaging relationship correction
`d934fe6b36f3355c37e1c8e717fa4abd37e2143e`. That parent supplies the
application-owned live messaging relationship boundary used by the reported
house/staff deployment. No unfinished Calendar branch commits are included.
No Strong Tower source, live data, deployment, account, photo or runtime state
has been changed by this work.

## Actual platform boundaries repaired

Native chat previously projected only intentionally published avatar URLs.
Private Guardian lookup meanwhile used its legacy application/organization
peer ceiling, not an application's live house/conversation/staff relationship.
Fixing only the image component would not have protected a copied private URL.

The patch adds a versioned runtime policy at the trusted Guardian boundary,
enforces it for both metadata and every private byte-delivery fence, and
projects admitted private metadata into the existing native messaging facade.
Self editing/delivery and native consent remain unchanged. Photo authorization
does not create a direct-message contact or grant conversation membership.

Native presentation uses the existing SDK's authenticated delivery, owned
object URLs and current-account/scope fences. Live people/directory snapshots
carry the shared profile revision separately from conversation revision. A
denied/removal projection cannot resurrect an old inline/public fallback.
SYSTEM profile changes wake presentation; unrelated audit/outbox writes must
not repeatedly refresh chat. Cross-process/raw writes retain the existing
bounded live-projection recheck interval rather than a new global byte cache.

## Application adoption after qualification

1. Update server and browser from the same normally selected qualified archive,
   then rebuild normally. Record the archive commit and SHA-256, not only its
   package version. Do not update just the browser against an older native
   messaging backend lacking the additive live routes.
2. Keep private avatars enabled and public publication disabled for a private
   photo use case. Intentionally published assets are a different owner opt-in;
   this policy does not retroactively privatize existing publications.
3. Add `auth.userAvatarReadPolicy` in **server runtime configuration**, beside
   `userProfile`, not inside the shared serializable auth schema. Use a stable
   `id`, explicit `version` and synchronous `authorize(context)` returning true
   only for the current allowed union of relationships. Self is handled by
   Guardian. Bump version for semantic code changes, not ordinary relationship
   data changes, and coordinate runtime restarts.
4. Reuse canonical application assignment/house/roster helpers; include the
   selected scope, viewer and subject in every read. The provided app-plane
   `db.get/query` facade is read-only, not automatically row-filtered. Prefer
   indexed point reads/bounded current projections on this hot path. There is
   no async opening of arbitrary Fabric files inside a Storage commit fence.
5. Use the native workspace normally. It projects photos after existing chat
   admission and retrieves bytes through Guardian. The photo audience may
   include admitted housemates who are intentionally excluded from DM targets.
   Do not duplicate those rules in a browser filter or expose Storage grants.
6. Qualify transfers, discharge, assignment removal, subject suspension, current
   scope/account changes, replacement/removal from another session, anonymous
   and unrelated/copied-link requests in the app's isolated fixture. Losing
   the last permitted relationship must deny the held asset path. Bytes already
   copied outside the application cannot be recalled.

No new migration, ledger edit, photo re-upload, account/drive recreation or data
conversion is required. Existing profile-policy generation provides coordinated
retirement when this explicit policy identity/version changes. Omitting the
policy preserves the exact legacy profile-policy fingerprint and peer behavior.

## Documentation and qualification

- [Guardian policy and private delivery](../backend/guardian/avatars.md#viewer-to-subject-private-read-policy).
- [Native messaging configuration](../backend/messaging/configuration.md#private-profile-photos).
- [Workspace presentation](../frontend/messaging/workspace.md).
- [Validated source evidence and external release receipt](./private-chat-avatars-qualification.md).
- [Normal release procedure](../../docs/releasing.md).

The recorded external filesystem integrity hold still makes `dev-storage
status`, `dev-storage check` and `dev-storage run` return exit 3. It is an
integrity hold, not an inferred lack-of-space problem or a successful repair.
The release owner has now explicitly authorized this 2.11.1 external-only
release task to proceed despite the recorded hold. See the
[scoped storage exception](./private-chat-avatars-qualification.md#explicit-storage-exception-for-this-release-task)
for its limits. No global guard, maintenance service or policy is changed.
Record actual storage check failures and stop on real I/O/device/corruption
errors. Source/cache-off memory diagnostics alone still do not qualify a package.

Under that explicit task-specific exception, qualify one exact clean committed
tree using its own frozen dependencies, required inventory and public source checks,
exact-archive consumer/browser checks, official bundled Linux/amd64 managed
Guardian/Storage/messaging checks and normal updater preservation proof.
The independently installed source group, normal TypeScript check, native
managed retained-restart fixture, decoded-pixel Chromium fixture and dependency
audit have completed; their actual counts are in the linked qualification
record. They are not an assertion that the archive/Linux/updater gates passed.
Record the final commit, archive path/SHA-256 and those gate results in the
external receipt, then use the existing reviewed release/main selection
procedure. Do not main-merge and trigger its release hook before the required
gates pass, and do not deploy an application in this repair.
