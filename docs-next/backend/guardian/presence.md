---
id: zero.guardian.presence
type: reference
audience: [developer, agent, operator]
owner: guardian
status: in-review
visibility: internal
system: guardian
feature: scoped-presence
maturity: preview
applies_to: ["Adaptive profile working source; release qualification pending"]
modes: [single-simple, single-advanced, multi-simple, multi-advanced, Fabric]
reviewed_against:
  package: "@zero/framework"
  version: "2.5.0"
  commit: "ae85a4b6efe11eeb74ab89b15ed02a23e982c59f"
  snapshot: dirty
  date: "2026-10-06"
  evidence_level: source-observed
---

# Account Presence And Availability

[Guardian index](./index.md) · [Profile UI](../../frontend/guardian/profile-settings.md) · [Fabric](../fabric/index.md)

Presence answers whether an admitted account currently has an active connection
and what availability it has selected. It is never authentication, permission,
task ownership or evidence that a human saw a message. Cached status strings are
not live evidence: every observation includes an owner epoch and freshness.

## Enable And Configure

```ts
import { defineAuthConfig } from '@zero/framework/auth';

export const auth = defineAuthConfig({
  presence: {
    enabled: true,
    idleAfterMs: 5 * 60_000,
    awayAfterMs: 15 * 60_000,
    heartbeatIntervalMs: 10_000,
    leaseDurationMs: 30_000,
    ownerCheckpointIntervalMs: 10_000,
    ownerLeaseDurationMs: 45_000,
    onCallEnabled: true,
    customStatuses: [{ key: 'focus', label: 'Focus time', tone: 'primary', icon: 'moon' }],
  },
});
```

Presence defaults to disabled. Available, Idle, Away, Busy and Offline have
predefined labels, semantic tones and supported Zero icons. Idle/Offline are
derived states, not selectable manual intent. On call is opt-in; up to 16 custom
statuses may add a stable non-reserved key, label, semantic tone and bounded icon.
Custom keys are at most 48 lowercase identifier characters. A status cannot
inject CSS colors, arbitrary icon components or HTML into server policy.

The timing fields in the example are the defaults. Away must not precede Idle;
connection and owner leases must each allow at least three heartbeat/checkpoint
intervals. Configuration is validated trusted code, not a user-set clock.

## One Tracker, Several Connections

AppProvider reads the managed feature manifest and enables the SDK tracker.
Standalone `createClient` callers opt in with `presence: true` and auth enabled.
There is one activity tracker per SDK instance, not per avatar/component. Each
browser tab has its own admitted connection lease; another active tab can keep
the account connected when one tab becomes hidden or closes.

Human activity updates the last-active state. A periodic heartbeat keeps a lease
alive but does not count as human interaction. Hidden tabs, inactivity, manual
intent and expired connections are evaluated separately. Manual Busy/Away/custom
intent can have an expiry; returning to Available enables automatic activity
states. Disconnection/owner expiry cannot falsely retain a green online ring.

Reporting uses the existing authenticated ephemeral channel with a reserved
topic and exact `{ sequence, activity, visible }` payload. The server derives
account, organization and connection identity; client IDs, TTLs, clocks and
arbitrary topic writes are not trusted. Dropped/replaced/disconnected activity
is not queued and replayed as if it were current.

## Scoped Reactive And SQL Views

Migration 040 supplies fixed private SYSTEM intent/lease/outbox/owner storage.
The only writer is the app-local Guardian presence owner. Ordinary SDK/resource
writes cannot mutate the public projection. Viewers and subjects are filtered
by live active organization membership; the Administration Organization is an
ordinary app workspace for presence, not an exemption from data boundaries.

For Fabric actor realms, include the same public contribution in the shared
gateway/actor realm definition:

```ts
import { composeDatabaseRealm, guardianPresenceRealmContribution } from '@zero/framework/server';

export const applicationRealm = composeDatabaseRealm({
  name: 'application',
  version: '1',
  contributions: [guardianPresenceRealmContribution()],
});
```

Compose app contributions into that same array. Keep the presence contribution
when disabling runtime reporting so existing migrated schema remains declared.
Gateway-only inclusion is insufficient: the actual actor must know the same
registered query and migration identity. This is real SQL projection, not a
browser cache pretending to be an actor database.

The contribution exposes `guardian.presence.current` (bounded `limit`/`after`
input) and `guardian_presence_current`. Each query row includes its stable `id`;
pass the last returned `row.id` as `after` to read the next bounded page in that
same admitted scope. The SQL view checks binding readiness,
owner epoch, retirement and expiry before returning a fresh observation. It
does not join a private profile/contact table. Query results are authorized
inside the admitted realm; this is not an arbitrary tenant selector.

Projection installation/reset/full-snapshot readiness and ordered incremental
updates are distinct states. If a target cannot converge or lacks its exact
contribution, presence is pending rather than fabricated. Unrelated application
resources remain usable. Final actor writes recheck the source authority and
owner epoch. A retained old owner cannot supersede a newer one.

## SDK And UI

`client.presence` owns `refresh`, `getSelf` and
`updateIntent({ status, expectedRevision, expiresAfterMs }, signal?)`.
`useGuardianPresence()` observes its capabilities, fresh observations, own
intent and pending/error state. `useAvatarPresence(userId)` maps only a fresh
observation into an optional tokenized avatar ring/icon.

`UserPresenceSettings` provides the server's selectable catalog using Zero
controls and acknowledged revision checks. Read-only/native sessions without
the explicit writer ceiling cannot select manual status or report activity.
Unknown/disconnected/stale observations produce no misleading live ring.

HTTP routes are `/auth/presence/config`, `/auth/presence/me` and bounded
directory access. Actual capabilities include `canReportActivity` and
`canSetIntent`; membership or frontend flags cannot override them.

## Topology, Shutdown And Recovery

The initial supported topology is **one active presence owner per SYSTEM
database**, with durable epoch/freshness fencing. Independent distributed
owners are not silently elected or merged. Deployments needing multi-gateway
ownership must use a supported single-owner arrangement; multi-owner topology
is future work, not an implicit production guarantee.

Disconnect releases the exact connection. Live revocation removes authority;
lease expiration catches lost processes. Managed shutdown drains presence before
Guardian/Fabric disposal and retires its owner. Restart reconstructs eligible
projections under a new fenced owner; stale cached observations stay stale.

Installation is opt-in and honors physical SYSTEM migration policy. Missing or
incompatible tables do not trigger silent schema repair. The actual target's
migration readiness, not a successful config parse, determines availability.

- [Avatar media](./avatars.md) is a separate private Storage lifecycle.
- [Rooms presence](../../frontend/rooms/presence.md) is room participation, not global Guardian availability.
- [Reactivity](../../concepts/reactivity.md) explains scope retirement.
- [Identity projection](./identity-projection.md) covers account reference anchors separately.
