---
id: zero.work.calendar-participant-admission-notes
type: reference
audience: [developer, agent, maintainer]
owner: calendar
status: draft
visibility: internal
system: calendar
feature: participant-admission-plan
maturity: experimental
---

# Calendar participant admission: implementation boundary and review notes

[Working notes index](./index.md) · [Calendar integration plan](./calendar-integration-plan.md)

Date: November 17, 2026. Reviewed against feature branch
`feature/calendar-backend-foundation`, baseline `ba6e941`; concurrent visit/location
binding work is not part of this review. These are durable implementation notes,
not a claim that participant APIs, bindings or permission grants were implemented
at that baseline. The subsequent native-account implementation now follows these
notes; use the [participant guide](../backend/calendar/participants.md) and
[qualification record](../backend/calendar/qualification.md) for current source
status and remaining release gates. The reviewed plan below is retained as the
design record, not an assertion that every future adapter has shipped.

The governing requirements are sections 4 and 5 of the
[calendar integration plan](./calendar-integration-plan.md). This note records a
feasible next increment and the security conditions that must accompany it.

## Recommended next increment

Implement a real, bounded, SYSTEM-backed canonical Guardian-user directory and
calendar-owned appointment participant bindings. Use opaque canonical references
and the existing final commit-authority fence; do not introduce calendar-local
copies of profiles or pretend that application-file lookups are atomic with a
calendar write.

For this increment, a participant reference identifies an account, for example
`{ kind: 'guardian-user', userId }`. The exact public spelling is still a contract
decision. It does not identify a provider calendar and does not automatically
mean staff, clinician, patient or bookable capacity. An eligible non-provider
account may be a participant without receiving a calendar resource. A resource
ID is not a canonical user ID.

Here, native Guardian integration means integration with the framework's actual
canonical identity services. It does **not** mean admitting native-client
sessions. Calendar's current browser-session-only credential boundary stays in
place. Native sessions, API keys, public proof and machine/background authority
remain separate, unsupported capabilities until their complete contracts are
implemented and qualified.

Do not expose app contacts/patients or manual guests as partially implemented
variants of this increment. A patient is an app participant type, not a new core
Guardian user kind. The fictional preview directory is confined to
[`src/components/calendar/test-support/attendee-directory.ts`](../../src/components/calendar/test-support/attendee-directory.ts).
Its resource-to-staff mapping and synthetic patient/contact IDs cannot become
the production adapter.

## Existing implementation seams

The following source locations were inspected at the baseline above. Line
numbers may move with concurrent changes; the named functions are the anchors.

| Source | Relevant existing contract |
| --- | --- |
| [`src/calendar/authority.ts`](../../src/calendar/authority.ts), `admitCalendarRequest`, baseline lines 35-90 | Captures browser actor and immutable scope before awaiting; rehydrates live Guardian authority; exposes synchronous `guard` and asynchronous `confirm`. Neither caller-selected scope nor a native/API-key session is admitted. |
| [`src/calendar/service.ts`](../../src/calendar/service.ts), `read` and `write`, baseline lines 174-265 | Detaches inputs before the first await, passes guards into the broker, fences delivery, bounds known-dirty read retries and distinguishes an unknown accepted outcome from rejection. |
| [`src/calendar/runtime.ts`](../../src/calendar/runtime.ts), `execute`, baseline lines 265-296 | Mints opaque database commit authority around the supplied synchronous guard, acquires only the established private owner and performs strong queries/commands. |
| [`src/databases/database-coordinator-operation-runtime.ts`](../../src/databases/database-coordinator-operation-runtime.ts), `withWriterAuthority`, baseline lines 603-650 | Joins the shared authority lease, captures the durable authority revision before the synchronous authority callback and retains ownership through actual settlement. |
| [`src/databases/database-actor-authority-commit-guard.ts`](../../src/databases/database-actor-authority-commit-guard.ts), `#beforeCommit`, baseline lines 164-202 | Immediately before the actor transaction commits, verifies canonical SYSTEM file identity and the captured authority revision under a shared cross-process file fence. |
| [`src/databases/database-authority-commit-guard.ts`](../../src/databases/database-authority-commit-guard.ts), `registerDatabaseAuthorityCommitGuard` | Canonical SYSTEM authority changes acquire the exclusive side when the durable authority clock changes. A failed final fence rolls the transaction back. |
| [`src/messaging/directory.ts`](../../src/messaging/directory.ts), `ManagedMessagingDirectory` | Existing bounded canonical-name search/exact resolution pattern and synchronous target admission. Messaging portal policies/errors are domain-specific and should not leak into calendar. |
| [`src/messaging/service.ts`](../../src/messaging/service.ts), `final`, baseline lines 69-73 | Existing precedent for composing caller revalidation and synchronous canonical recipient checks into the broker guard. |
| [`src/auth/auth-user-avatar-service.ts`](../../src/auth/auth-user-avatar-service.ts), `directory`, baseline lines 112-117 and `assertDirectorySubject`, lines 283-290 | Actual minimal same-organization display-name/avatar projection, with durable viewer session admission and current subject checks. Native sessions cannot use it to browse another account. |
| [`src/auth/auth-user-profile-service.ts`](../../src/auth/auth-user-profile-service.ts), `read`, baseline lines 71-81 | Own-profile API only. `readForCompletion` is a narrowly admitted internal continuation, not an arbitrary-user directory API. |
| [`src/presence/presence-service.ts`](../../src/presence/presence-service.ts), `list`, baseline lines 145-153 | Optional, current same-scope presence; checks both viewer and subjects. Presence does not establish membership, participant eligibility, attendance or capacity. |
| [`src/frontend/server/server-request-services/create-request-services.ts`](../../src/frontend/server/server-request-services/create-request-services.ts), calendar override, baseline lines 250-256 | The normal request projection admits calendar only for a browser request, live committed scope and non-machine session. Strict background projections do not implicitly receive calendar. |

The existing raw `zero.auth.store` surface is not a substitute for a scoped public
directory. Multi/strict request projections intentionally restrict privileged
stores. The trusted managed composition should create the calendar directory
dependency, close it over SYSTEM services, and expose only narrow scope-admitted
operations through `zero.calendar` and its HTTP/client equivalents.

## Closed, configurable policy boundaries

Directory discovery, participant details and participant binding are different
permissions. Existing `CalendarGrant` has only `busy`, `details`, `book` and
`manage`; there is currently no implemented participant-detail grant. Merely
being signed in, knowing an ID or having appointment `details` must not silently
open an organization-wide people directory or disclose participant identities.

Use explicit, compiled Guardian policy declarations with closed defaults. The
names below describe the required policy roles, not already supported config:

- Directory policy: permission to discover minimal eligible subjects. Default
  deny; an app must deliberately opt in. Authorize search, exact lookup,
  pagination, facet values and any counts, not only the final list rendering.
- Read-participants policy: permission to disclose participant identities and
  minimal current presentation. Default deny. Intersect it with current
  appointment/co-resource object authority; a feature-wide Guardian permission
  is not permission to read arbitrary appointments.
- Bind-participants policy: permission to bind/change other identities in an
  appointment. Default deny unless deliberately configured, plus the appropriate
  current booking/manage right on every reserved resource. Discovery is not a
  write grant, and successful binding is not a directory grant.
- Subject-eligibility policy: an explicitly configured current canonical
  role/permission/trusted-property rule, in addition to basic finalized account
  and membership eligibility. Default deny for an enabled but unconfigured
  participant source; do not advertise all Guardian users as staff by default.
  An app may deliberately select a broader rule. Self-editable profile values
  are never authoritative eligibility properties.

Calendar's `false` sentinel means deny; Guardian's generic scalar `false` can mean
public access. Do not pass the deny sentinel through the generic evaluator.
Follow the validation/freezing discipline in
[`src/calendar/config.ts`](../../src/calendar/config.ts), `admitAccess`, and reject
unsupported credential declarations instead of reporting them configured.

The initial implementation may deliberately be manager-only for participant
discovery/details/binding, with the manager requirement itself configured using
Guardian rather than a hard-coded admin label. That is a narrow supported
contract, not participant-specific delegated grants. If per-resource participant
visibility is introduced, add it through an additive/versioned grant migration,
all command validators, service contracts and projections. Do not quietly treat
`details` or `book` as that new grant, and do not change old grant semantics during
replay.

Subject-eligibility evaluation is trusted offline policy work, not authentication
as the target user. Reuse/factor the canonical role/property evaluation pattern
in [`src/messaging/recipient-policy.ts`](../../src/messaging/recipient-policy.ts),
`createMessagingAccessPolicy`, without creating a session, credentials or fake
Guardian users. A target policy must not demand session/MFA/client facts that
this offline subject projection cannot prove; constrain such declarations and
fail closed. All membership/role/property inputs come from current SYSTEM rows,
never from selected directory entries.

## Canonical target admission and the final fence

Implement a narrow calendar-specific directory dependency with bounded `list`,
bounded exact-ID resolution and a synchronous `assertBindable(scope, refs)`.
The dependency owns no request-selected database or tenant path. The request
facade derives immutable `ServiceDataScope` through the existing admission path.

Basic target admission should at least match the finalized canonical directory
predicate already used by messaging/presence:

- Account is token-eligible, not merely `users.status = 'active'`: use
  `authTokenEligibleUserSql` / `canUserReceiveAuthTokens` from
  [`src/auth/auth-user-eligibility.ts`](../../src/auth/auth-user-eligibility.ts).
- Exclude unfinished `_auth_registration_provisioning` and
  `_auth_admin_user_provisioning` records. The existing shared predicate is in
  [`src/messaging/directory-eligibility.ts`](../../src/messaging/directory-eligibility.ts).
- In multi tenancy, require current active canonical tenant and active canonical
  membership in the exact admitted tenant. In single tenancy, require actual
  application scope. No selection-session, application-scope fallback in multi
  mode or cross-tenant user discovery is permitted.
- Apply the separately configured subject-eligibility rule. Account membership
  alone does not establish staff or domain eligibility.

For a new binding mutation, the trusted service composes the guards, conceptually:

```ts
const finalGuard = () => {
  authority.guard();
  directory.assertBindable(authority.scope, detachedParticipantRefs);
};
```

Pass this guard through `CalendarServiceBroker.write` to the existing opaque
commit authority. The callback must finish synchronously and return no value;
reject a Promise-returning adapter. The bounded target lookup must run again
inside this callback, not only before the asynchronous calendar/file work.
The final callback belongs to trusted process memory, not serialized actor input.
Never accept a caller-supplied `eligible`, `authorized`, `checkedAt`, principal,
scope, database reference or authority revision as proof.

The important ordering is already implemented:

1. A search result is a discovery snapshot, not a binding capability.
2. At the calendar writer FIFO head, the coordinator acquires the shared local
   authority lease and captures the durable Guardian revision **before** running
   the synchronous composed callback.
3. That callback rehydrates the initiating session/scope and reads the current
   target account, tenant, membership and trusted policy inputs from SYSTEM.
4. The actor carries the captured revision as internal transport data. At commit,
   it checks the current revision and SYSTEM file identity under the shared
   cross-process file fence.
5. Same-runtime authority writers cannot cross the shared lease. An external
   canonical authority writer that changes covered state after the target check
   changes the revision; actor commit then rejects instead of accepting stale
   eligibility. A later revocation after a successful commit is ordered after
   that accepted binding, not a reason to rewrite historical evidence.

The canonical revision's coverage is explicit in
[`src/auth/auth-authority-revision.ts`](../../src/auth/auth-authority-revision.ts),
`AUTHORITY_TABLES`, baseline lines 32-115: user eligibility/status/deletion,
tenant/membership state, canonical role assignments, trusted user properties and
installed authorization state participate. The file-backed actor context is
required for the cross-process claim. A local shared lease alone is not a
cross-process security fence. SYSTEM file/revision unavailability or mismatched
identity must fail closed, not downgrade to an unfenced calendar write.

### Provisioning-clock qualification gap

The two provisioning marker tables are **not** listed in `AUTHORITY_TABLES`.
Therefore a direct marker-only mutation is not automatically fenced by the
revision comparison, even though the target lookup excludes marked accounts.
Do not describe every change to the whole eligibility SQL predicate as fenced
without resolving this gap.

The existing lifecycle appears intended to attach markers only while creating a
new provisional identity, with canonical user creation itself advancing the
clock; final removal of a marker admits rather than revokes that identity.
That is an implementation hypothesis requiring lifecycle proof, not a general
guarantee about arbitrary SQL. Review
[`src/auth/registration-provisioning-store.ts`](../../src/auth/registration-provisioning-store.ts),
[`src/auth/admin-user-provisioning-store.ts`](../../src/auth/admin-user-provisioning-store.ts)
and their UserStore/lifecycle callers before relying on it.

The implementation must either prove that supported operations cannot add,
retarget or otherwise restore a provisioning marker onto a finalized selected
identity, or deliberately extend/review canonical authority-clock coverage for
the relevant marker transitions. Include a focused race test. Do not bypass this
question with a cached directory snapshot or a periodic refresh.

## Bindings, migration and replay

Persist calendar-owned reference bindings and bounded binding history in the
same transaction as the appointment change, its source revision and its receipt
and effect intent. Use appointment revision CAS for replacement. Normalize,
deduplicate, deterministically order and bound reference sets before the first
await. Enforce both configured `maxParticipants` and the realm's hard limits.
Duplicate/foreign/unknown participant kinds fail closed.

Keep account IDs as opaque canonical references, not pretending SQLite FKs can
cross SYSTEM/calendar files. Bindings must not copy names, contact details,
avatars, presence, roles, membership status or authorization properties. They
are historical domain facts, not current credentials or permission grants.

An identity that later deactivates, is removed or is deleted must not be a new
binding candidate. Preserve its historical reference and return an explicitly
unavailable/tombstone presentation where current policy permits reading the
binding; do not manufacture a replacement account, reassign the binding or
delete the appointment. Define the safe tombstone fields before exposing reads.
Removal of an unavailable participant must remain possible under the caller's
current appointment-management policy; do not require the removed target to
become eligible again. Define whether preservation of an existing unavailable
reference during an unrelated edit is allowed; do not accidentally treat it as
a new binding.

Receipt behavior needs a deliberate split:

- Accepted receipts remain immutable historical evidence. Current caller and
  calendar-object rights still govern every receipt read and replay.
- A target's later suspension/removal must not make the accepted receipt
  disappear. Explicit receipt reconciliation uses current caller/object guards,
  not a fresh-new-target eligibility requirement.
- A mutation retry must compare the exact original normalized intent under the
  stable scope/principal/request namespace. A different participant set under
  the same key remains an intent conflict even if both sets are currently valid.
- If exact mutation replay is to succeed after target revocation, distinguish
  it using a trusted accepted intent/receipt comparison before selecting the
  new-binding guard. Do not trust a client `replay` flag, and do not return a
  preflight receipt merely because the request key exists without verifying the
  normalized intent. Re-enter the canonical intent/reconciliation path.
- If the first increment instead rejects direct mutation retry after target
  revocation, document that narrower behavior and preserve the independent
  receipt API so the user can determine the accepted outcome. Do not report a
  known accepted effect as definitely not committed.

The existing runtime notes that native exact replay need not rerun a realm
handler; see `CalendarRuntime.write` and its post-command current receipt check.
An unconditional target guard can reject before replay is reached. Account for
that explicitly in the implementation and tests. Preserve old untyped/typed
intent digests when participant fields are omitted; a versioned new digest may
be required when participant binding is supplied. An internal admission witness
may change a transport attempt but must not alter the stable domain intent.

## There is no calendar identity-projection target yet

The managed app projection runtime in
[`src/frontend/server/identity-projection-runtime.ts`](../../src/frontend/server/identity-projection-runtime.ts),
`createAppIdentityProjectionRuntime`, discovers declared application and tenant
table requirements. It does not automatically install identity anchors into the
calendar's separately owned coordinator/realm. `mountManagedCalendar` currently
composes calendar persistence and service, not a calendar identity projection
target.

Consequently, adding `field.guardianUser()` or reading `users` in the calendar
actor is not a complete integration. Native Guardian FKs would additionally
require explicit target registration, owner/root/installation binding, actual
anchor hydration, ordered durable delivery/receipts, matching source and target
watermarks, readiness before dependent writes, recovery/restart behavior and
quarantine handling. See
[Guardian identity projection](../backend/guardian/identity-projection.md),
[`src/auth/identity-projection-types.ts`](../../src/auth/identity-projection-types.ts)
and
[`src/frontend/server/identity-projection-readiness.ts`](../../src/frontend/server/identity-projection-readiness.ts).

Even a fully installed ID-only anchor proves referential existence, never
current account/membership eligibility, name, avatar or authorization. It remains
useful historical evidence after revocation. The recommended first increment
therefore uses opaque references plus live canonical admission, not new FKs.

## Profile, avatar, presence and delivery rules

Return the smallest explicitly authorized current projection. Names may be
resolved using the existing minimal canonical directory pattern; arbitrary
profile contents and contact endpoints are out of scope. Where enabled,
`AuthUserAvatarService.directory` is a sanctioned same-organization presentation
seam, including its private asset descriptor and guarded delivery. Do not call
the own-profile service with a fabricated target session.

`publicDescriptorFor` is explicitly a trusted read of an already-public
publication. It cannot grant private profile access. A missing optional avatar
service may produce no avatar; a disabled/unready/withdrawn private asset must not
be replaced with a fabricated public URL or Storage visibility change. Keep
presence optional and use the admitted presence projection rather than reading
status rows as a directory.

Resolve presentation only after appointment/participant authorization. After
asynchronous lookups or final Guardian confirmation, revalidate the viewer,
scope, relevant subjects and minimal projection before delivery. Busy-only
queries must omit participant references, names, counts and contact hints;
redaction happens on the server, not in CSS. Effect/audit metadata must not
accidentally become a participant/contact export.

The current calendar read/watch invalidation source announces calendar commits,
not every SYSTEM directory/profile/avatar change. New participant watches cannot
reuse a stale decorated page indefinitely. Add canonical invalidation hints or
bounded fresh resolution, with current subject policy enforced on every
delivery. Directory/profile changes are not necessarily caller-session
revocation: rechecking only the viewer is insufficient. Core profile name
changes also are not all authority-clock changes; use the appropriate current
profile/presentation revision or simply avoid a presentation cache initially.
Do not claim an atomic SYSTEM-profile/calendar snapshot; define it as an
authorized calendar snapshot with current separately resolved presentation.

## App contact and domain-adapter protocol remains separate

An application contact/patient adapter must define its own opaque source/type
namespace, bounded search/exact resolution, viewer disclosure policy, mutation
eligibility, tombstones and lifecycle. Canonical Guardian IDs may optionally be
linked to an app person, but that relationship does not convert the app person
into a Guardian account or grant profile access.

An awaited app-file lookup can improve UX but is not a final atomic security
check for a calendar write. Guardian's clock does not cover arbitrary app tables.
If domain eligibility must still hold at calendar commit, the adapter must offer
a reviewed actual fence, or a calendar-owned authority projection with explicit
hydration, source revision, ordered delivery, readiness, revocation and recovery
semantics. A stale snapshot or a promise-returning callback does not qualify.
Fail closed for a policy whose required invariant cannot be proved. Do not fall
back to raw primary SQL or `unsafe` when `zero.data` is unavailable.

Manual guests need their own identity/proof/consent/contact-delivery contract.
Do not overload an arbitrary display name/email as either a canonical account
reference or proof of participant consent. No fake Guardian user is acceptable.

## Lifecycle, bounds and performance

- Reuse the existing stable per-scope calendar conflict domain. Do not create a
  file per user or run a second app inside a directory worker.
- Create the directory dependency in trusted managed composition after Guardian
  startup. Retire retained facades and unsubscribe/abort tracked operations on
  shutdown before disposing underlying services, matching `CalendarService` and
  `mountManagedCalendar` ownership.
- Prefer no participant presentation cache initially. Any later cache is bound
  to runtime owner, immutable scope and the relevant authority/profile/asset
  revision; scope/session change clears it and late responses cannot render
  into the new scope. Client lifecycle teardown must release watches and abort
  outstanding searches.
- Bound query text, page size, cursor, exact-ID batches, participant set size,
  eligibility predicate work, history, receipts and retained effects. Use
  deterministic indexed ordering. Escape SQL wildcard input and reject controls
  and unsupported fields. Never load the entire organization directory just to
  decorate one appointment or filter one page.
- Apply authorization before pagination/counts. If policy filtering needs
  bounded scanning, define scan limits and continuation behavior explicitly;
  empty authorized matches are different from denial/unready state.
- Index current bindings by scope/appointment and subject lookup; bound history
  by explicit usage counters. Qualify plans with populated retained history,
  not only an empty database. Preserve useful current snapshots and small review
  evidence; do not retain complete smoke-test environments.
- Add additive migrations and preserve original migration/function identities,
  receipts, old digest semantics and retained populated databases. Missing
  established files/readiness conflicts require explicit recovery, not a reset.
- Implement fixture cleanup in every added test/script using the project's
  supported synthetic fixture ownership and `finally`, following storage policy.
  No generated work was required to produce these source notes.

## Required qualification before claiming the increment complete

1. Real managed composition: separate SYSTEM and calendar files; single/multi
   tenancy; canonical finalized users and actual memberships; non-provider
   participants; no fake directory or raw app SQL fallback. Disabled/omitted
   feature must remain inert and explicitly unconfigured policies remain closed.
2. Policy distinction: directory denied while appointment details is allowed;
   participant details denied while busy/details remains allowed; configured
   delegated non-admin policy; trusted properties versus self-editable profile
   fields; foreign IDs and hidden subjects return non-oracular errors.
3. Target race: search succeeds, then target suspends/deletes or tenant/membership
   is revoked before the queued writer starts. Prove no binding/appointment/
   receipt/effect partially commits. Change target role/property eligibility too.
4. Final-edge race: another SYSTEM writer changes covered target authority after
   the synchronous target callback and before actor commit. Use the actual
   file-backed actor guard/cross-process fence, not an in-memory mock. Prove the
   captured-before-check ordering and actual rollback/settlement.
5. Provisioning coverage: registration/admin unfinished users never appear or
   bind; prove supported marker lifecycle assumptions or exercise the reviewed
   clock extension, including a marker-only revoking transition.
6. Replay/recovery: accepted target later revokes; safe receipt still reconciles
   under current caller/object rights; changed participant set with the same key
   conflicts; no duplicate effect; caller grant loss conceals receipts; unknown
   outcome remains honest. Exercise any direct-retry policy chosen above.
7. Lifecycle semantics: removal of an unavailable participant, unchanged existing
   unavailable references during unrelated edits, tombstone reads, restore/rejoin
   behavior, stale appointment CAS and atomic failure at every source write.
8. Privacy and current presentation: minimal names, authorized avatar withdrawal,
   optional presence, absent/unready profile services, target removal during
   asynchronous resolution, quiet-watch revocation, no busy/metadata/contact leak,
   and no cross-scope late render or retained picker cache.
9. Facade parity: one implementation shared by server, HTTP, SDK and hooks;
   detach-before-await; strict input allowlists; abort/stop/retained-handle tests;
   installed-package exports/types; native/API-key/background/public access stays
   explicitly unavailable until separately qualified.
10. Retained-state/performance: actual additive upgrade of populated files,
    migration replay/disable/re-enable, preserved receipts/digests, bounded
    participant and history budgets, indexed query plans under retained history,
    bounded staff-policy scanning and complete owned fixture teardown on both
    success and failure.

The immediate visit/location-binding increment can ship independently. These
notes intentionally do not introduce participant-shaped runtime APIs that only
accept synthetic data or lack their final canonical fence.
