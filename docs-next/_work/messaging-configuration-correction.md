---
id: zero.work.messaging-configuration-correction
type: roadmap
audience: [developer, agent, maintainer]
owner: messaging
status: draft
visibility: internal
system: messaging
feature: configurable-messaging
maturity: experimental
applies_to: ["feature/messaging-backend; not a selected stable update"]
---

# Configurable messaging correction

[Working index](./index.md) · [Messaging architecture](../backend/messaging/index.md) · [Implementation evidence](./messaging-backend-implementation.md)

## Confirmed product boundary

Zero owns one optional messaging subsystem, not a Facebook/customer-support
product. Contacts-based messaging, an open directory, tenant-local conversations,
manually managed groups, trusted-property groups, internal assistants and support
inboxes are configurations which may coexist. A named internal assistant must
not require enabling support or assigning its human user the customer role.

Facebook Messenger and other third-party channel adapters are application-owned.
The older channel research is not a framework requirement or release gate. Use
the existing Zero email services for optional email-backed support, rather than
adding an alternative SMTP/IMAP stack.

## Preserve and extend

Retain canonical Fabric databases, Guardian scope/permission checks, the existing
private Storage lifecycle, accepted intent receipts, read cursors, ephemeral
typing, targeted live invalidations, scoped logging, and concurrent Torrent jobs.
Never create fake Guardian accounts for assistants or use presence as membership.
No network call may hold a database transaction or authority lease.

1. **Named assistants.** Introduce an additive configured registry with public
   identity/description and Guardian access policy, a discovery/open facade, and
   assistant conversations independent of support. Pin assistant identity and
   policy to durable jobs. Recheck current user/tenant/policy before generation,
   result publication, history/file delivery and live/typing access. Preserve the
   existing single-assistant support configuration as a compatibility alias.
2. **Groups.** Preserve ordinary contact/open-directory groups. Add deliberate
   membership administration and declarative groups whose membership derives
   from Guardian roles/permissions/trusted properties. Membership withdrawal
   immediately prevents history, uploads/downloads and live/typing access;
   asynchronous membership maintenance must not become the authorization source.
   Define creation, owner transfer, leave/remove and history-on-rejoin explicitly.
3. **Support.** Keep staff claim, handback, private notes and ownership epochs.
   Finish capability-bound visitor admission, configured authorized destinations,
   and optional native email association without exposing the internal directory,
   making a visitor a Guardian user, leaking private notes or guessing delivery.
4. **Workspace.** Wire existing tokenized components to the actual facade and
   live projections. Preserve accepted messages and scroll anchors on append and
   backfill, including group/assistant directory and current-scope replacement.
   Real upload/activity/job state drives presentation; there are no fake timers.

## Correction and qualification order

Implement named assistants and their native facade first, then group policy and
membership lifecycle, then public-support/email boundaries and the managed UI.
Use additive private migrations; do not edit committed migration 001–005 or
unrelated SYSTEM migrations. Every stage records actual tests separately from
unimplemented requirements. A passing source test is not installed qualification.

Required regression matrix:

- Single tenancy: contact requests/blocks, everyone directory, groups and named
  assistants with support disabled. Multi tenancy: equivalent independent
  behavior and denial of cross-scope identifiers, membership and bot discovery.
- Trusted-property/role changes, assistant removal or policy changes, group
  removal/rejoin, live/typing revocation, cached command replay and private
  attachment revocation. No earlier receipt grants current access.
- Two distinct assistants and concurrent conversations, durable identity/policy
  pinning, saved-result restart, superseded turns, support takeover and uncertain
  provider outcomes. No implicit retry or relabeling an earlier outcome.
- Actual HTTP/SDK/Guardian/Fabric/Storage/Logging/Torrent integration, then real
  desktop/narrow browser navigation, typing, files, backfill and accessibility.
- Source/bundle migration identity, retained-source actor startup with empty
  child environment, Linux/amd64 installed archive, recovery/security review,
  typecheck, docs and the normal full release suite.

No deployed application, production data or updater selection is changed by this
work. Only a separately qualified archive can become a normal Zero update.

## Current status

The source corrections now implement a named assistant registry, independent
assistant conversation/membership identity, Guardian bot policies, HTTP/SDK
discovery/open, policy/identity-pinned jobs, and internal-owner review without
support authority. Private migration 006 preserves prior default support jobs.

Configured groups now reuse Guardian requirements, its durable authority clock,
bounded/coalesced directory reconciliation and canonical Fabric membership.
Private migration 007 adds only group policy metadata/indexes. Removal/rejoin
history and independent ordinary-group owner transfer are covered natively.
All earlier private migrations remain unchanged. Existing Guardian presence is
already implemented on main and must be reused by the workspace.

The native source regression passes 31 scenarios / 285 assertions across managed
HTTP/SDK, private realm, job protocol and runtime suites. It includes actual
single/multi-tenant assistant/group flows, concurrent loopback provider calls,
owner-only explicit retry, files, logging, typing and notification recovery.
The final managed/config/cache review passes 20 scenarios / 224 assertions.
Database/auth neighbors pass 164 tests / 669 assertions. The additive commit
observer tests also verify rollback, root/nested delivery, lease release,
unsubscribe, async rejection and privacy-safe diagnostic behavior. Existing
presence/client/component/bundled-realm neighbors pass 26 tests / 133 assertions;
the focused policy/cache/wire checks pass 22 tests / 151 assertions.
The initial group test failure is retained: it exposed that Guardian private
property writes do not emit ordinary row events. Using its authoritative revision
clock corrected the boundary; no fake events, weakened policy or access bypass
were added. A payload-free local `ReactiveDB.onCommit()` wake-up now covers raw
private Guardian transactions; the native group test proves a membership
invalidation arrives without a subsequent list/get demand read. Unchanged
membership fingerprints avoid unnecessary private writes on session revisions.

Source migration identity review confirms 001–005 are unchanged and only 006/007
are added. Documentation validation reports 870 reachable pages / zero problems.
Exact source logs are retained under
`/Volumes/code-bank/artifacts/zero-platform/diagnostics/blog-publishing/` with the
`messaging-correction-` prefix, including failed intermediate runs; none are
relabeled as a passing installed qualification. The final root typecheck is
recorded in `messaging-correction-qualified-typecheck.log`.

Public visitor/email support, configured human destination routing, the full
managed workspace and installed/Linux/full-release qualification remain
incomplete. The list/header presence binding is now implemented as described
below; this is not qualification of the entire managed workspace. These
corrections are not a selected stable update.

## Presence review and messaging integration

Reuse the existing Guardian service, not a duplicate chat presence subsystem.
The review found and corrected these source boundaries:

- Capability/cadence refreshes restarted the activity sequence on an unchanged
  admitted connection. The server properly rejected that replay. Counters now
  increase for the SDK tracker's lifetime; activity itself is discarded at
  retirement and uses a monotonic browser clock.
- Messaging forced every indicator to a dot and separately styled it as one.
  The shared AvatarPresenceIndicator now provides the default perimeter, with
  explicit dot/badge choices preserved. Participant `avatarShape` and inherited
  radius roles keep image/fallback/perimeter corners identical across headers,
  lists, message bubbles and typing avatars. Shared tooltips expose the label.
- Headers/lists accepted manual presentation but did not bind the actual feed.
  They now observe one existing Guardian feed per consumer, without creating a
  tracker, and support controlled-only opt-out. The public `useMessagingPresence`
  helper uses the same fresh-evidence mapper as `useAvatarPresence`. Non-user
  participants cannot borrow a human's status by matching a display ID.
- Per-user aggregation scanned the full organization's ephemeral namespace on
  each report. Scoped connection indexes and exact-entry TTL reads now limit
  aggregation to that user's connections; expiration lookup is direct. Existing
  resource caps, replay watermarks and final authority checks remain intact.
- Expired/removed selections could leave account controls showing a stale Busy
  or reject an unknown retired custom key. Own-intent responses normalize to
  automatic Available while preserving the durable revision, and controls
  refresh at acknowledged expiry without fabricating a write or extra tracker.

Global presence visibility remains the admitted same-application/same-tenant
directory, not a newly claimed contact-only privacy policy. It grants no chat
history/files, typing access, read receipt or support ownership. No presence
schema/migration or production app change is introduced by this review.

Evidence is retained under the same external diagnostics directory with the
`presence-review-` prefix. The initial failing sequence regression and later
native test attempt are retained distinctly; the latter was a missing required
display label in the synthetic typing payload, correctly rejected by policy.
Source/real-browser/native results and package qualification are recorded after
their actual runs, not inferred from static markup or a successful build.

| Presence review check | Result | Evidence file (`presence-review-` prefix) |
| --- | --- | --- |
| Presence store/service/SDK and controlled messaging parts | 37 passing tests, 243 assertions | `source-retention.log` |
| Real Chromium account controls and messaging presentation | 14 passing tests, 334 assertions | `browser-retention.log` |
| Actual HTTP/Sync/Fabric presence and messaging runtime | 27 passing tests, 287 assertions | `native-reviewed.log` |
| Fresh installed archive, public aliases/types, SSR and browser consumer build | 1 passing test, 26 assertions | `package-retention.log` |
| Public UI boundaries and facade identity | 9 passing tests, 70 assertions | `exports.log` |
| Final whole-repository typecheck | Exit 0 | `typecheck-final.log` |
| Documentation navigation/metadata | 870 reachable pages, no problems | `docs-final.log` |

Browser geometry/screenshots verify matching image/fallback/perimeter corners
for circle, rounded and square shapes in both themes at 320px, plus shared status
tooltips. Freshness transitions retain the actual avatar DOM and conversation
rows, rather than reloading an image. The in-app browser connection failed before
execution; these browser checks used the repository's isolated Playwright
Chromium harness instead, on synthetic fixtures only.

The installed consumer proves package export/build behavior, not a selected
stable release, deployed-app acceptance or Linux/amd64 qualification. The native
integration uses actual managed actors and local sockets, not the browser
fixture's synthetic presence receipts. No live customer service or data was used.
