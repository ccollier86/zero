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

Public visitor/email support, configured human destination routing, the managed
workspace/presence binding and installed/browser/Linux/full-release qualification
remain incomplete. These corrections are not a selected stable update.
