---
id: zero.backend.calendar.overrides
type: reference
audience: [developer, agent, operator]
owner: calendar
status: draft
visibility: internal
system: calendar
feature: independent-appointment-overrides
maturity: experimental
---

# Reviewed one-off appointment overlaps

[Calendar index](./index.md) · [Facade](./facade.md) ·
[Connected UI](../../frontend/calendar/connected-workspace.md) · [Qualification](./qualification.md)

This is **unreleased feature-branch source**, not an updater-selected archive.
An exception is an explicitly reviewed scheduling decision, not a generic force
flag. Only manual one-off appointment create and atomic rich update support the
closed `appointment-overlap` category. Ordinary writes keep their existing fast
conflict probes and receipt identities when no exception is supplied.

## Independent permissions

Overrides are disabled by default. The admitted Calendar configuration can
explicitly declare:

```ts
overrides: {
  kind: 'appointment-overlap-v1',
  use: { permission: 'calendar:override' },
  manageGrants: { permission: 'calendar:override-grants' },
}
```

Declare these permissions in Guardian before referencing them. The requirements
are independent: no ordinary calendar owner, manager or administrator acquires
exception power implicitly. `false` explicitly denies the selected requirement;
it does not mean public access. This does not enable public booking, mobile/API-key
admission or an automatic background exception.

Fresh use additionally requires an explicit Calendar-owned exception grant on
**every resulting resource**, plus normal old-manage/resulting-book rights. The
four ordinary `CalendarGrant` rights and `resources.setGrants` are unchanged.

```ts
const current = await calendar.overrides.grants.get(resourceId, userId);
await calendar.overrides.grants.replace(resourceId, userId, {
  categories: ['appointment-overlap'], // [] revokes
}, { idempotencyKey, expectedRevision: current.resourceRevision });
const stop = calendar.overrides.grants.watch(resourceId, userId, onGrant, {
  onError: retirePrivatePresentation,
});
```

Grant administration needs ordinary resource management **and** independent
`manageGrants` permission. Adding a grant checks finalized, active, current-scope
Guardian target eligibility again at the native final commit fence. It does not
reuse the application's attendee-eligibility rule or expose another user directory.
Select identities through an authorized current-scope account UI; a guessed ID is
not discovery. Revocation remains possible after a target leaves. Original grant
receipts remain factual after target eligibility or exception permission changes,
under current ordinary resource authority and exact original intent.

Replacement shares resource CAS and advances its revision when changed; holds
captured at an earlier revision become stale. No-op, rejection and replay produce
no new grant history or false semantic change. Live grants use the existing
coalesced private snapshot/SSE and authority-retirement machinery.

## Review, then explicitly save

The same server/browser facade offers readonly review:

```ts
const proposedKey = crypto.randomUUID();
const review = await calendar.appointments.reviewCreate(appointment, {
  idempotencyKey: proposedKey,
});
if (review.status === 'reviewable') {
  // Present an explicit unchecked confirmation and require a private reason.
  await calendar.appointments.create(appointment, {
    idempotencyKey: proposedKey,
    override: {
      policyVersion: review.policyVersion,
      decisionToken: review.decisionToken,
      reason: operatorReason,
    },
  });
}
```

`appointments.reviewUpdate(id, patch, {idempotencyKey, expectedRevision, signal?})`
reviews the corresponding atomic update. Its eventual `appointments.update`
uses the same proposed key, patch, target revision and closed `override` option.
Only appointment-specific request/control options admit this field; holds,
blocks, legacy reschedule and unrelated operations reject it.

Review returns only `clear`, `reviewable` or `non-reviewable`. Only `reviewable`
includes the category, policy version, opaque decision token and server expiry.
Neither `clear` nor a token reserves time. Hard conflicts and excessive private
witness density have the same coarse non-reviewable result. No count, conflicting
appointment/resource identity, title or attendee is disclosed.

Review uses an actual readonly native query and shared candidate preparation.
It creates no domain rows, receipt, audit success, Jobs entry or mutation-recovery
record. Cancelling review therefore creates no write. Its key is proposed, not
spent. A key already accepted by another operation cannot be reviewed anew.

## What the final writer proves

The ordinary source transaction repeats current Guardian/object admission, CAS,
candidate compilation and all hard checks. A private per-file authenticated
decision binds the proposed key, principal, owner, exact authored and resolved
candidate, resource/grant generations and complete private overlap witnesses.
The token reveals none of those private facts and expires after five minutes.
No cleanup timer or cached authority is introduced.

The complete review is bounded to 64 active reservation witness rows, not 64
deduplicated appointments. Changing a conflict for a different one of the same
size and time invalidates the decision. Descriptor hashes and bounded child rows
avoid a large witness JSON payload. Ordinary booking still uses its `LIMIT 1`
fast probes instead of enumerating conflicts.

Blocks, live holds, working hours/missing coverage, effective location policy,
appointment types, visits, participants, account/session/tenant/policy revocation,
owner/schema integrity and all storage quotas remain non-overridable. No-op,
title-only, participant-only, timezone-only and removal-only grandfathered edits
do not manufacture a fresh exception merely because accepted time overlaps.
Supplying an exception for an update that does not re-admit occupancy is stale.

The source atomically retains the private reason, admission, appointment revision,
bounded witness facts, ordinary receipt, effect and native semantic evidence.
The existing single created/updated event gains only safe category, policy and
reason-presence metadata—not the reason, conflict identities or clinical content.
Rollback/outbox pressure rolls everything back. Replay adds no duplicate evidence.

## Stale and uncertain outcomes

`CALENDAR_OVERRIDE_STALE` requires a new explicit review, not automatic approval.
`CALENDAR_OVERRIDE_NOT_ALLOWED` means fresh independent use is unavailable. The
native editor only offers review after its matching known-not-committed conflict
and current capability discovery; it never infers permission from ownership.
Candidate, target revision, source/scope, opening or capability changes retire the
review. New typing and reason drafts remain separate from an earlier acknowledgment.

Once the final write starts, the existing single mutation owner controls recovery.
An unknown result reconciles **only its original key**; do not re-review, change
the candidate, generate a new key or resend automatically. Accepted original work
can be reconciled after proof expiry, override revocation or configuration disablement
under current ordinary object authority. Genuine final uncertainty stays unknown.

## Upgrade and qualification limits

Additive migration019 owns its private key/state, separate current/history grants
and admission/history/witness tables. It preserves001–018 declarations, migration
checksums, ledgers, ordinary receipt columns and accepted interpretation. Missing
adopted private state is corruption, not permission to regenerate the key.

Bounds are 100,000 retained grant changes, 100,000 accepted exceptions and
1,000,000 witness child rows, alongside ordinary receipt/storage ceilings. There
is no pruning or quota bypass. Core Logging disabled remains disabled.

See the qualification ledger for actual source/MEMORY checks. These do not replace
real Chromium, file/WAL/HOT restart, bundled Linux, deployment or updater acceptance.
The full Calendar integration still has separate series, booking, actual delivery,
management/clinical and managed activation gates.
