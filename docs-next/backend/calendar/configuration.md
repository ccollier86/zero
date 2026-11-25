---
id: zero.backend.calendar.configuration
type: reference
audience: [developer, agent, operator]
owner: calendar
status: draft
visibility: internal
system: calendar
feature: managed-core-configuration
maturity: experimental
---

# Calendar configuration and adoption

[Calendar index](./index.md) · [Facade](./facade.md)

This is unreleased branch-source documentation. It is not permission to migrate,
enable or deploy calendar in an existing application.

## Availability in normal projects

The November 25, 2026 review checked qualified main at Zero **2.11.1**, commit
`86c6141f125d73a3d5272310beb81e2139d648f9`, against Calendar source
`25e9f06281ef850a2ee6aff995f1f04d6c4b7ab2`. These are different artifacts, not
two configuration levels of the same installed package. Later releases require
their own commit/archive provenance; this dated checkpoint is not a permanent
latest-version selector.

| Need | In qualified 2.11.1 main | Calendar feature-branch boundary |
| --- | --- | --- |
| App-local named cron/maintenance | [Scheduler](../scheduler/index.md), `zero.scheduler` in trusted server code | Not appointment recurrence or a restart-replay queue. |
| Durable one-off/cron work and controls | Opt-in [Jobs](../scheduler/durable-jobs.md), private Fabric and pinned Torrent handoff | Calendar source continuation and provider adapters need their own integration. |
| Bounded task execution | [Workers](../workers/index.md) and shared work pools | Not a replacement for durable workflow/appointment state. |
| Calendar views and local editor pieces | Experimental [Calendar UI](../../frontend/calendar/index.md) | Controlled presentation/local previews are not authoritative persisted bookings. |
| Calendar backend and connected workspace | **Not included** | One-off bookings, holds, policies, all-day and overlap review are source implemented; physical/browser/package qualification is open. |
| Persisted recurring appointments, public booking and actual reminders | **Not included** | Full implementation remains unfinished, not merely awaiting packaging. |

Normal [project creation](../../cli/tooling/zero-new.md) and
[updates](../../cli/tooling/zero-update.md) consume the selected qualified package,
not an active feature checkout:

```sh
zero-release --status
zero-new ./my-zero-app
# Existing application: inspect before applying an update.
zero-update /path/to/existing-app --dry-run
```

Creating Stupify or any other new Zero app does not enable a service or copy its
unfinished backend from this branch. Do not add `calendar` backend settings or
`@zero/framework/calendar/server` imports to the 2.11.1 package. The declaration
below describes the **branch source**, not an installable configuration for that
archive. On this branch, `calendar: true` enables only the core. Recurrence,
reminders and self-booking remain false-only; attempting to enable them returns
`CALENDAR_NOT_READY` rather than starting a partially working feature.

The [finish-line ledger](../../_work/calendar-integration-plan.md#finish-line-execution-ledger)
owns full-product completion: persisted series and coverage, booking/invitations,
actual delivery adapters, connected management/clinical controls, public
activation/retirement and release acceptance. The [qualification record](./qualification.md)
separates source/MEMORY results from real browser, file/actor, Linux, performance
and updater checks. Documentation validation is not a substitute for these gates.

## Branch-source declaration

```ts
// zero.config.ts — alongside the application's existing configuration
calendar: {
  timezone: 'America/New_York',
  // createOwn: 'user',
  // manage: 'admin',
}
```

Omission/false is entirely inert: no calendar routes, owner catalog, private files,
actors, timers or subscriptions. Retained state is never deleted on disablement.
The shorthand `calendar: true` requires explicit timezone setup before operations;
it does not guess the host or browser timezone. Explicit `auth: false` plus enabled
calendar is rejected. With auth omitted, managed composition uses its normal
Guardian default. One-off calendar does not require or override disabled Jobs,
Torrent, workers, email, messaging, Storage, AI or providers.

| Setting | Current default / boundary |
| --- | --- |
| `rootDirectory` | `data/zero.calendar`, private and relative to the captured project root |
| `timezone` | `null`: setup required; explicit runtime-supported IANA name required |
| `createOwn` | Authenticated `user`; `false` explicitly denies own creation |
| `manage` | Single tenant: `admin`; multi tenant: `tenant.members:manage` |
| `maxRangeDays` | 31; configurable 1–31 days per query |
| `maxPageSize` | 100; configurable 1–100, resource pages normally 25 |
| `maxResources` | 16 selected resources per query/booking; configurable 1–16 |
| `maxParticipants` | 100 references; configurable 1–100 for new bindings |
| `participants` | false; opt-in `{ userEligibility: AccessRequirement }` offline-provable native Guardian rule |
| `overrides` | false; opt-in `appointment-overlap-v1` with explicit independent `use` and `manageGrants` Guardian requirements plus per-resource grants |
| `maxActiveDatabases` | 4; configurable 1–64 active private domains |
| `maxDatabaseFiles` | 1,000; configurable up to 10,000 and not below active-domain limit |
| `recurrence`, `reminders`, `selfBooking` | false only; enabled declarations reject as unavailable |

Policies use the existing Guardian authorization language, not a new calendar
role registry. Management requires an actual role, configured permission or
trusted policy property; mere authentication is not enough. `createOwn: false`
is a calendar deny sentinel, not Guardian's public-access scalar. A resource's
separate current per-user grants control busy/detail/book/manage rights. A
resource owner has those rights; booking alone grants no private details or
cancellation authority. Calendar filtering and hidden controls confer no access.

The separately configured [appointment-overlap exception](./overrides.md) does
not inherit owner/admin/manage privileges. Grant additions use an independent
finalized current-scope Guardian account projection, not the attendee rule.
Disabled exceptions leave ordinary booking and original receipt reconciliation
unchanged; blocks, live holds and every other hard booking rule remain enforced.

Doctor reports incomplete timezone setup and declared core capabilities without
opening a calendar file or starting an actor. Its configuration finding is not
operational health, domain inspection or release qualification. Invalid policies,
placement overlap and unsupported enablement fail normal configuration admission.

## Placement and startup

The SYSTEM database contains only the conditional `_calendar_owners` catalog.
Each application/tenant scope's resource, reservation, revision and receipt data
lives in its own file-backed Fabric domain. An opaque owner identity and root/
realm fingerprints prevent reinterpreting unrelated or missing retained files as
a fresh calendar. Established files are opened existing-only. First writes may
provision only through a currently permitted resource creator or a scope-manager
location/type creation; reads never
create a domain. Owner catalog installation requires the ordinary explicit
migration permission (or ephemeral test storage). Incompatible metadata is not
rewritten, dropped or relabeled.

The source branch also admits a separate `(established,id)` discovery index on
that catalog. A canonical older table without the index is not corrupt, but
read-only `migrate:false` startup does not create it implicitly: perform the
ordinary explicit metadata upgrade. A conflicting retained index is rejected,
never overwritten. Bounded integration discovery reads SYSTEM metadata only;
it does not authorize opening a domain or repair an old/missing physical owner.

Lexical and canonical preflight reject overlap with app/SYSTEM DBs, application
Fabric, Storage, app/assets/generated paths and configured or known default
logging/blog/messaging/Jobs roots. Historical custom placement of an absent
feature cannot be inferred: preserve and inventory that state during adoption.

The coordinator has bounded per-domain/global queues, active-owner ceilings,
file-backed readers and short authority-protected writes. It holds no SQL
transaction across an AI/provider call. The dedicated actor uses a fixed entry,
empty inherited environment and `--no-env-file`, never the main application entry.
Shutdown aborts admitted service work, drains it and the logging source, then
closes the coordinator. It never removes domain data.

The official JavaScript build preserves canonical migration source identity so
the bundled parent and retained installed-source actor agree. The matching
package source/dependencies must remain installed beside the JS bundle, as with
the existing Jobs deployment boundary. A compiled application executable is not
a Bun interpreter: default compiled launch fails closed. Compiled calendar
deployment and custom actor launch are not qualified public managed options.

## Existing-project checklist

1. Wait for a qualified calendar archive selected by normal `zero-update`.
2. Keep the existing application topology, IDs, Storage, workflows, audit custody
   and public/authenticated themes unchanged. Use a feature branch and synthetic
   rehearsal first; no reconversion or account recreation is part of enablement.
3. Inventory private placements and back up retained state using the app's
   existing approved procedure. Review exact package identity, not version alone.
4. Declare calendar/timezone/Guardian policy. Apply additive metadata using the
   normal migration path, not copied SQL or a private framework import.
5. Create real resources through the scoped facade and assign grants deliberately.
   Owners/grantees are opaque existing identity references; this core does not
   create accounts or invitations. The optional [native participant directory](./participants.md)
   uses a separate explicit trusted subject policy and scope-manager admission.
   Optional appointment types/policies use the same managed scope. Catalog/policy
   editing requires scope management; restrictive policy does not cancel existing
   appointments or let a provider owner bypass type requirements.
6. Add the connected workspace inside existing Client/AppProvider and native
   modal/tooltip providers. Test permissions, conflicts, hard refresh/reconnect,
   revocation and unknown outcomes on the actual installed archive.
7. Authorize application rollout separately. Framework tests never authorize it.
