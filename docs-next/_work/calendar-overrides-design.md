---
id: zero.work.calendar-overrides-design
type: architecture
audience: [developer, agent, maintainer]
owner: calendar
status: draft
implementation_state: source-implemented
visibility: internal
system: calendar
feature: independent-appointment-overrides
maturity: experimental
---

# Calendar F4: independently permitted appointment overlap

[Working index](./index.md) · [Full finish-line plan](./calendar-integration-plan.md) ·
[Current source qualification](../backend/calendar/qualification.md)

Reviewed November 19 against `1445f67`, then implemented as canonical019 on
`feature/calendar-backend-foundation`. **This is unreleased branch source, not an
updater-selected capability.** The complete vertical includes configuration,
independent grants, readonly review, canonical writer/evidence, HTTP/SDK/live hooks
and native rich-editor integration. See the [usage contract](../backend/calendar/overrides.md)
and [qualification ledger](../backend/calendar/qualification.md); physical/browser/
installed-archive acceptance remains unexecuted. A private helper or unit pass
alone would not complete this package or the full Calendar system.

## Initial boundary

Support manual one-off create and atomic rich update only, including timed,
typed and the existing untyped all-day branch. The sole closed exception is
`appointment-overlap`. Do not add a generic force/skip flag, implicit ordinary
manage override, partial resource admission or an application callback that
decides inside the writer.

Blocks, live holds, working hours, missing coverage, effective location policy,
type/visit/participant eligibility, source/owner/schema integrity, Guardian/object
authorization and every quota remain hard requirements. Legacy reschedule,
holds, blocks, series and native background tasks do not gain this exception.
The ordinary no-override path retains its current fast probes, digests and wire
contracts exactly.

## Independent permission and configuration

Implemented disabled-by-default configuration:

```ts
overrides?: false | {
  kind: 'appointment-overlap-v1';
  use: AccessRequirement;
  manageGrants: AccessRequirement;
};
```

Compile requirements separately. Never default them to owner, `manageAll`, an
ordinary role label or the existing manage policy. Preserve Calendar's explicit
false-deny semantics rather than passing false to Guardian as public access.

Store separate Calendar-owned per-resource/user/category current grants and
immutable grant history. Preserve the four-right `CalendarGrant` and existing
`setGrants` replacement contract. Fresh use requires ordinary create or
old-manage/resulting-book rights, current independent Guardian use permission
and an explicit exception grant on **every** resulting resource. Administration
requires both ordinary resource manage and independent grant-management permission.
Grant replacement uses current resource CAS, canonical receipts and safe semantic
evidence. Directory selection must remain current-scope and privacy-admitted.

Do not reject an entire create/update request simply because the current exception
capability is false. Capture trusted use/manage-grants booleans and configuration
identity separately, reproject them through the synchronous final authority fence,
and require fresh exception power only after original receipt lookup. Cap/config
witnesses may select a native transport attempt; they must not change the logical
scope/principal/request identity. Accepted work remains factual after exception
revocation, disablement or proof expiry under current ordinary object authority.

## Read-only review and ordinary atomic save

Implemented branch-source facade:

```ts
appointments.reviewCreate(input, { idempotencyKey, signal? });
appointments.reviewUpdate(id, patch, {
  idempotencyKey, expectedRevision, signal?
});
```

The key names a proposed eventual write, not a persisted/cached review operation.
Review creates no domain row, receipt, audit success, Jobs entry or pending
mutation recovery record. A fresh nonce may produce a fresh review for the same
proposed key. Cancellation or read failure therefore produces zero writes.

Admit the complete ordinary and independent all-resource authority before private
review probes. Return only `clear`, `reviewable` or `non-reviewable`. The last
combines hard conflicts and witness overflow; do not expose a density threshold,
hidden conflict class, count, culprit resource, target ID, title or participant.
Only `reviewable` carries the allowed category, code-policy version, opaque token
and server expiry. Neither `clear` nor a token is an offer or reservation.

Appointment-specific create/update options may add a closed `override` object
with policy version, decision token and nonblank bounded private reason. Other
command option types remain closed. The normal source path, expected revision,
one async mutation owner and ordinary receipt shape stay intact.

## Native decision and witness

Factor an explicit narrowed native read-store abstraction for candidate
preparation and hard-policy checks. Review must use a real readonly query
capability, not a writable database, a cast writer context or a second divergent
booking engine. Preserve omission, typed defaults, accepted frozen all-day facts,
explicit kind conversion and the existing history grandfathering masks.

Normal occupancy keeps its existing `LIMIT 1` fast path. Exception review
enumerates a complete deterministic set of at most **64 active reservation
witness rows total**, not 64 deduplicated appointments. A 65th row refuses review.
Descriptors bind resource/reservation/parent identity and revision, occupied
bounds, current membership and the actual selected conflict set. Replacing one
conflict with another of the same count and times must invalidate the witness.

Use a domain-separated keyed digest with an immutable private per-file review
key, version, random nonce and authenticated issue/expiry times. Keep the key
source-owned across restart; missing adopted state is corruption, never automatic
key regeneration. A bounded lifetime (initially up to five minutes) is checked
lazily; no timer or review cleanup engine is needed. The client token contains
no private conflict descriptors, including in decodable base64 payloads. A public
hash of guessed private IDs is not sufficient.

Bind scope/physical owner, principal, action, proposed write key, target/CAS,
canonical candidate and retained time fact, code/config policy, all resource and
independent grant generations, and the complete private conflict set. Existing
`calendarHash/calendarJson` reject above 32 KiB: a valid 64-row witness can exceed
that when IDs are long. Hash each bounded descriptor and the candidate separately,
then aggregate fixed-size hashes deterministically. Store bounded witness child
rows instead of a giant JSON object; set an explicit retained child-row budget.
Do not introduce a hidden smaller conflict limit to evade the serialization cap.

The final short writer recomputes this decision from current facts, authenticates
the token and mints only a context-bound allowance for those exact appointment
overlaps. It still executes every hard check. No public skip mask or general
`occupancy: false` is introduced. Stale proof, expired proof or a changed conflict
set requires explicit review; it cannot silently become an ordinary save.

## Atomic evidence and preservation

The additive migration preserves all001–018 maps, functions, checksums, rows,
ledgers and accepted interpretation. Proposed private records hold immutable
key/policy state, current and historical independent grants, exact admission,
appointment revision/exception history and bounded witness child facts. Couple
them to the ordinary receipt/effect in one transaction, with structural SQL seals
and exact final native semantic validation. Prevent late attachment or no-op
fabrication. Do not append a column to only one old receipt family: existing
receipt lookup uses `UNION ALL SELECT *` across families.

Mirror the current rich-update revalidation mask exactly: title, participant,
timezone-only and removal-only edits do not acquire a fresh exception merely
because an already accepted interval overlaps. A supplied override on an unchanged
or otherwise non-admitting update is not applicable; it cannot manufacture
exception history or a new success event. Ordinary grandfathered editing remains
available without that option.

Use finite history/child budgets and existing receipt/storage ceilings, with no
pruning or special capacity bypass. Keep private reasons and conflict facts out
of ordinary audit metadata and unauthorized views. Enrich the existing single
appointment-created/updated semantic event with safe category, policy identity
and reason-presence fields; do not produce a second noisy success event.
Rejection, rollback, no-op and replay create no exception history or false success.

## UI ownership and qualification

Extend the existing draft controller with a sanitized review action/state, not a
second mutation owner. Never infer permission from `BOOKING_CONFLICT`, ownership
or manage flags. A known not-committed failure can lead to a new explicit proposed
review attempt/key; an unknown result cannot. Register mutation recovery only when
the final create/update is actually dispatched. Closing the native reason dialog
or cancelling review writes nothing. Keep new typing and private reason drafts.

Candidate/resource/target revision/policy/grant/opening/scope changes retire proof.
Review-only refusal removes that action; independent base detail/management guards
still decide whether ordinary editing can continue. General authority denial
retires the whole owner. Final uncertainty reconciles only its original key,
without automatic exception replay, changed-candidate retry or new-key resend.

Qualify owner/manage without independent permission; Guardian-only/object-only/
complete and partial co-resource grants; revocation at every wait/final writer;
same-sized conflict replacement; buffers/adjacency/all-day/65th-row cases; every
hard non-overridable class; zero-write review cancellation; accepted replay after
expiry/revocation/disable; no-op/late failure/unknown; semantic privacy/rollback;
populated018 and corrupt-source upgrades; native SQL plans and serialization
ceilings; actual HTTP→SDK→service→MEMORY; and native controller lifecycle.
Physical/browser/file/actor/Linux/updater gates remain part of the full finish
line, not replaced by those source checks.
