---
id: zero.backend.calendar.location-policies
type: reference
audience: [developer, agent, operator]
owner: calendar
status: draft
visibility: internal
system: calendar
feature: effective-location-policies
maturity: experimental
---

# Effective resource and location assignments

[Calendar index](./index.md) · [Visit bindings](./visits.md) ·
[Facade](./facade.md) · [Qualification](./qualification.md)

This is **unreleased feature-branch source**, not an updater-selected archive.
Calendar assignments express an application's scheduling policy. They are not
medical credentials, patient-state rules, jurisdiction verification or additional
Guardian permissions. Ordinary location/region facets remain directory filters.

## One explicit policy, two formats

The server's `zero.calendar` and browser's `client.calendar` expose:

```ts
const calendar = zero.calendar;
if (!calendar) throw new Error('Calendar is not enabled.');

const current = await calendar.locations.policy.get(resourceId);
await calendar.locations.policy.replace(resourceId, {
  kind: 'effective-utc-v1',
  assignments: [{
    locationId,
    windows: [{
      startAt: '2027-01-01T00:00:00.000Z',
      endAt: '2028-01-01T00:00:00.000Z',
    }],
  }],
}, { idempotencyKey, expectedRevision: current.resourceRevision });

const stop = calendar.locations.policy.watch(resourceId, onCurrentPolicy, {
  onError: retirePrivatePresentation,
});
// Call stop() when this owner retires. It is not a permanent background stream.
```

`CalendarResourceLocationPolicyInput` is a closed union:

- `static-v1` supplies `locationIds`. These assignments apply at all times.
- `effective-utc-v1` supplies `assignments`, each with a `locationId` and exact
  canonical UTC `windows`. Empty windows explicitly permit no occupied interval
  at that location. Empty assignments permit no in-person location.

An omitted legacy assignment remains empty, not globally eligible. Existing
static assignments retain their all-time meaning until explicitly replaced. The
new API does not silently infer dates from a provider profile, a location's region,
the current year or the viewer's timezone. Assignment windows may span years;
the appointment-query horizon does not clamp these policies to 31 days.

Windows are half-open. Overlap and exact adjacency merge within each location;
gaps remain gaps. Location IDs must be unique and normalize in stable order.
Every endpoint is a canonical UTC string with milliseconds, not a timestamp
number, offset date string or browser-local `Date`. An application's authoring
UI must resolve local choices explicitly before submitting this UTC policy.

The returned `CalendarResourceLocationPolicyView` contains `resourceId`, the
current shared `resourceRevision`, and `policy`. Supporting servers advertise
`locationPolicies: true`; older servers omit the capability. Public assignment
and window types are exported alongside the policy types.

## Authority and final booking checks

Reading a private policy requires current resource book or detail access; replacing
it requires current resource manage access. Scope, tenant, actor and owner remain
server-derived. A location ID is not a visibility grant: a resource manager can
select a new location only through a currently authorized directory assignment.
The service obtains that witness internally and the final writer rechecks its
current resource rights and membership. Clients cannot author witnesses.

Fresh in-person appointments and holds must fit the selected location policy on
**every reserved resource for their entire occupied interval, including buffers**.
An appointment that starts within a window but ends outside it is not eligible.
This is part of the same short source transaction as the reservation decision,
not an asynchronous preflight that can race policy changes. Current active
location/version, resource, appointment-type, working-hours, blocking, capacity,
participant and Guardian checks remain independent requirements.

Restrictive policy replacement preserves accepted appointment history. Meaningful
occupancy, resource or visit changes revalidate the resulting candidate. A title
edit, cancellation, historical read or original receipt replay does not become a
new booking merely because policy changed. Policy replacement advances the shared
resource revision, making previously captured holds stale; confirmation cannot
silently adopt a new policy or renew the hold.

Outside effective coverage returns `CALENDAR_VISIT_CONFLICT`. An invalid/stale
selected directory generation retains `CALENDAR_VISIT_STALE`. These errors do
not disclose hidden titles, other reservations or clinical facts.

## Discovery is not a reservation

`locations.forVisit` and `watchForVisit` accept an optional occupied interval:

```ts
const page = await calendar.locations.forVisit({
  resourceIds,
  interval: {
    startAt: occupiedStartAt,
    endAt: occupiedEndAt,
  },
  limit: 25,
});
```

Both bounds are required together, positive and at most 33 elapsed days. The
33-day envelope accommodates accepted 31-LocalDate spans across clock changes;
it does not increase timed-appointment duration policy. Location intersection,
active directory selection and whole-interval eligibility apply before public
pagination. Every co-resource's book admission precedes private catalog lookup.
Queries use the bounded current assignment/window projection, not retained policy
history. A live commit or authority change triggers a fresh authorized read.

Without `interval`, this API returns the authorized directory intersection only.
Likewise `locations.forResource` returns directory membership, **not an all-time
eligibility promise**. Ordinary sidebar facets use this directory union. Read the
policy or submit explicit occupied bounds when time eligibility matters.

The connected editor uses occupied UTC bounds for representable timed drafts and
the accepted frozen boundaries of unchanged all-day records. It does not convert
new or changed authored LocalDates in the browser. Those cases disclose that
location time eligibility is checked on save and retain unfiltered authorized
directory choices. Final native booking checks always remain authoritative.
Policy/candidate changes retire stale location pages and never silently pick a
different location or resubmit an unknown operation.

## Legacy replacement and explicit downgrade

`resources.setLocations(id, locationIds, options)` remains supported for legacy
or static policy. Once effective policy is selected, a **fresh** legacy command
rejects with `CALENDAR_LOCATION_FORMAT_UNSUPPORTED` rather than flattening it.
Original accepted commands reconcile first and retain their historical outcome.
To deliberately restore all-time assignments, use the new policy API with
`{ kind: 'static-v1', locationIds }` and current expected resource revision.

Semantic no-ops retain their own request receipt without a fake policy generation,
resource change, effect or change-audit event. The new receipt operation is
`resource.location-policy-changed`, in the existing scope/principal/request-key
namespace. A successful change publishes the directory union, immutable policy
history, normalized windows and current selector atomically with that receipt.
Unknown delivery remains unknown: reconcile the original key through
`calendar.receipts.get`, never automatically retry with a fresh identity.

## Bounds, preservation and evidence

Inputs permit at most 16 locations, 64 submitted windows per location, 256 windows
in total and 24 KiB of normalized UTF-8 source. Raw cardinality is bounded before
merging; normalization does not provide a way around the window ceiling. Retained
policy history and windows have separate 100,000/1,000,000 file budgets. Exhaustion
rolls back policy, directory metadata, shared revision, receipt and audit together;
it does not truncate windows or discard old accepted evidence.

Additive migration `018` preserves all original `001`–`017` functions, ledgers,
receipts, assignments, appointments and holds. Legacy resources get explicit
legacy selectors, not invented authored effective policies. New resources receive
their selector in the canonical create transaction. Missing or inconsistent
adopted state is corruption and fails closed; deleting a pointer is not permission
to reinterpret the directory union as all-time coverage. Existing immutable
history/current projection seals remain enforced. SQL protects identity, scope,
cardinality, references and late attachment; the canonical final native resource
intent additionally proves exact authored-source-to-epoch-window agreement before
receipt/effect acceptance. This is not a claim that SQLite itself is a complete
compiler for JavaScript's supported UTC date range, nor permission for app raw SQL.

Native semantic evidence reports safe operation, target resource, revision, policy
format and bounded counts—not policy JSON, dates, labels, clinical text or raw
request bodies. Rejection, rollback and no-op do not manufacture success. This
capability neither enables conflict overrides nor replaces an independently
reviewed synchronous app-owned eligibility fence. Physical/browser/deployment
qualification remains separate from MEMORY and source checks.
