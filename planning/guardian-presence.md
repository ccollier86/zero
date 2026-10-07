# Guardian presence with Fabric and Reactive DB

[Working plans](./index.md) · [Profiles and settings](./guardian-profile-settings.md) ·
[Rooms architecture](../docs-next/backend/rooms/index.md)

## Scope and implementation status

This is the proposed architecture for first-class user presence: reliable
connection aggregation, automatic inactivity, manual/custom statuses,
Reactive DB observation and Fabric-scoped reads. The reviewed source baseline
is `55ca1e6` on October 6, 2026. The existing room transport is useful but is
not this service. No public API or database table proposed here is shipped.

Reuse Guardian's live authority, Sync's connection lifecycle and read-only
system plane, Reactive DB's changes, Fabric's admitted realms/coordinator
lanes, and existing SDK/hooks/UI. Do not add an independent identity cache,
unscoped message bus, blob store or second reactive framework.

## What the existing presence APIs do

The public [room presence hook](../src/frontend/client/room-hooks.ts) writes
one `user:<id>` entry per room with a ten-second heartbeat and thirty-second
TTL. Its type includes online/idle/away, but every write forces online. A
second tab shares the same key; unmounting either tab deletes it. The
[presence-list hook](../src/frontend/client/presence-list-hooks.ts) locally
filters stale entries, which is not a general reactive expiration mechanism.

The [server helper](../src/rooms/presence-service.ts) uses raw room namespaces
and is not a mounted Guardian service. The public
[idle hook](../src/hooks/use-idle.ts) provides local activity detection, not
cross-device aggregation. The internal avatar demonstration has fixed sample
users and is not a production public presence primitive.

Managed room transport already enforces organization and actual room
membership, exact actor keys, current authority and subscription retirement.
Preserve these guarantees. An organization ID used as a room ID does not
magically create organization-wide presence.

The touched lifecycle baseline also needs corrections:

- TTL pruning currently has no delete fanout; ordinary cached members can
  outlive their server entry.
- Ordinary reconnect restores table/state subscriptions, not retained
  ephemeral topics.
- Generic disconnected `sendRaw` buffers heartbeats, potentially replaying
  obsolete observations after reconnect.
- Presence payloads have generic JSON bounds, not server-derived time and
  status semantics.
- Generic room policy still performs membership reads for admission and
  delivery. It is not already a no-SQL heartbeat path.

Relevant seams are [managed policy](../src/sync/ephemeral-managed-policy.ts),
[channel delivery](../src/sync/ephemeral-channel.ts),
[TTL manager](../src/sync/ephemeral-manager.ts),
[ephemeral client](../src/sync/client/ephemeral-client.ts), and
[socket handshake](../src/sync/client/sync-socket-handshake.ts).

## Feature enablement and realm readiness

Follow the shared [existing-installation enablement contract](./guardian-profile-settings.md#enabling-features-on-an-existing-installation).
Presence requires its own schema/contribution/backfill version and per-target
readiness. Existing identity readiness or one successful SYSTEM migration does
not prove every organization projection is installed. Inventory eligible
organizations from authoritative SYSTEM records, including never-opened
targets; use bounded resumable actor admission and mandatory before-use
barriers. Track deferred targets as pending, not migrated.

Preserve immutable migration history and actor realm fingerprints on disable;
retire usage/subscriptions, not stored data or historical registry entries.
Do not replay SYSTEM migrations into tenant files, bypass `migrate: false`,
or alter an active actor realm without an admitted drain/rebind lifecycle.
Feature readiness must account separately for installed schema, directory
backfill, owner freshness and supported topology. Public login/completion
remains reachable if a projection is unready. Qualify disabled-to-enabled,
opened/unopened actors, restart during rollout, new organization creation,
version skew and disable/re-enable.

## Status and connectivity semantics

Represent connectivity, automatic activity and user intent separately.
Presence is advisory state, never a permission or proof that a person has
seen a message. A clean close can retire immediately; a broken network can
only be detected within the configured lease deadline. A disconnected
observer can have unknown/stale knowledge, not perfect real-time certainty.

| Dimension | Proposed meaning |
| --- | --- |
| Connected | At least one current admitted connection lease exists in this organization |
| Active | At least one connected device/tab has recent human activity |
| Idle or away | Every live connection exceeds its configured activity threshold |
| Manual intent | Available, away, busy, on-call or an allowed custom status, optionally expiring |
| Offline | No current valid leases, regardless of stored manual preference |
| Unknown to observer | Its own transport cannot establish fresh authoritative state |

Default display statuses are available/online, idle, away, busy and offline.
On-call and custom statuses are optional. Keep an `online` compatibility
mapping where the existing API uses that term; do not silently break its
status union. The status registry has stable keys, labels, semantic token
references and optional known icon keys, not arbitrary HTML/SVG.

Manual busy/away/on-call must not be overwritten by a heartbeat or mouse
movement. Manual available permits automatic idle/away transitions; loss of
all leases still displays offline. Define manual expiration separately from
connection expiry. Within an organization, one active tab makes the user
active even if another is hidden or idle. Heartbeats are not human activity.

Use explicit first-class presence timing, with proposed five-minute idle and
fifteen-minute away defaults; do not change `useIdle`'s existing general
default for unrelated consumers. Native clients use an equivalent activity
reporting seam rather than browser-only visibility assumptions. Machine/API
key requests do not automatically make a human user online.

## Ownership and data flow

```text
Guardian-admitted Sync connection and activity
    → transient per-connection leases
    → one authoritative aggregate owner for the scope
    → meaningful state transitions and durable publication
    → protected Reactive DB presence projection
    → authorized Sync and scoped service/actor reads
    → readonly SDK hooks and tokenized avatar/status controls
```

Lease keys are server-owned gateway generation, connection identity,
organization and user. A client cannot select another user, organization,
aggregate owner or trusted timestamp. Admit status/activity against strict
bounds and server time; reject out-of-order connection messages and retired
epochs.

Maintain one tracker per admitted SDK/provider lifecycle, not one heartbeat
per Avatar or mounted hook. Multiple consumers subscribe to the same tracker.
Use transient/drop-or-coalesce transport for heartbeats. Reconnect acquires a
new admitted lease and fresh state; it never flushes old activity as current.

The aggregate owner computes precedence, expiry and public diffs. Lease
renewal stays lightweight and transient. Publish meaningful status,
connectivity, directory or admitted manual-intent changes through existing
Reactive DB writes. Do not put an every-heartbeat `lastSeen` update in the
watched projection or execute application automations for every heartbeat.

## Canonical and organization projections

Private durable state belongs to SYSTEM: allowed manual status/preferences,
owner epochs, aggregate publication revisions and any durable publication
receipt. Raw activity/device identifiers and lease details are not a public
member directory.

The framework-owned canonical presence projection must be a real admitted
Reactive DB schema with stable primary key, indexes, public metadata,
snapshot/catch-up behavior, read policy and write rejection. Reuse the
[read-only system plane](../src/sync/sync-system-data-plane.ts) and
[platform table catalog](../src/frontend/server/app-platform-tables.ts).
Normal browser collection mutations cannot write presence authority.

If Fabric SQL querying/joining is supported, admit a deliberate minimal
organization-realm contribution. A system-only Sync table is not sufficient:
a Fabric actor sees its bound database, not gateway RAM or an implicit join
to SYSTEM. The organization projection contains only user reference,
effective status/connectivity, publication revision/epoch and freshness
metadata needed for scoped reads. Do not mirror full contacts or global
profile data into every organization.

Publish the organization projection through the existing serialized
coordinator/actor writer lane. Use a durable publication receipt/outbox when
cross-database updates are required, with monotonic revisions and idempotent
admission so retries and late messages cannot overwrite newer state. Do not
claim a multi-file SQLite transaction is atomic. Reader actor handlers remain
read-only, synchronous and independent of gateway closure state.

The [realm contract](../src/databases/database-realm.ts),
[realm composition](../src/databases/database-realm-composition.ts), and
[read capability](../src/databases/database-read-query-capability.ts) are the
existing integration boundaries. Build actual table/realm admission and
tests before documenting SQL compatibility.

## Freshness and recovery

Avoid the contradiction between no heartbeat SQL writes and indefinitely
persisted "online" rows. Each reader needs an explicit freshness contract.

Use owner epochs and a bounded aggregate-owner freshness lease/checkpoint,
separate from per-connection heartbeats. The admitted read service interprets
expired or retired owners as stale/offline/unknown. Raw SQL consumers must
use the documented freshness predicate/read model, not infer truth solely
from a stored status string. Periodic owner checkpoints are bounded shared
writes, not one database write per user heartbeat.

On orderly shutdown publish retirement while services remain live. On startup
retire previous process epochs before accepting new publication. A crash
cannot invoke close handlers; the freshness deadline provides bounded stale
visibility, then recovery reconciles durable projections. Test projected
disconnect, restart and expiration behavior in both system and actor reads.

For multiple gateways, choose an actual aggregate ownership/fan-in protocol.
Independent gateways cannot each write a whole-user online/offline row:
closing the last local lease is not closing another gateway's lease. The
initial local owner has only single-owner topology guarantees. Distributed
support requires admitted ownership routing, remote lease renewal/expiry,
epoch fencing and failover tests. Process-local RAM or KV alone does not
provide those guarantees; do not silently market it as distributed presence.

## Authority and privacy

Organization-wide presence has its own managed read/write policies. Default
readers are current admitted members of that organization; an app can narrow
visibility. Room-specific presence keeps room membership as an additional
requirement. Administration Organization membership does not reveal other
organizations' presence; any platform view needs explicit live platform
authority.

Live membership, account status, credential/session ceiling and authority
revision remain mandatory at connection admission, manual-status writes and
delivery. Reuse existing revision invalidation/final fences; do not introduce
a second weaker auth cache in order to claim zero reads per heartbeat. The
no-write optimization is distinct from authorization-read cost. Only a
supported revision-fenced cache can safely optimize those reads later.

On revocation or scope change, retire old leases, rows/subscriptions and
pending results before admitting the new scope. Membership removal must
retire the directory/presence projection and delayed publications. A restored
membership needs new admitted authority, not revived historical leases.

## Public facade and UI composition

Expose a small readonly presence client, authorization-scoped hooks, status
update action and provider-owned activity tracker. Presence hooks can reuse
the existing reactive query/row subscription mechanics. Do not leak the
private ephemeral client or a mutable SYSTEM collection as the only API.

Separate service-facing read, actor projection, client transport, aggregation
and rendering responsibilities. Custom payloads/statuses remain bounded and
typed. The UI reports its own connected/stale observation state instead of
presenting cached values as fresh after network loss.

Compose the public status avatar from existing Avatar, Badge, Tooltip, icon
and motion primitives. Support ring/dot/badge options, shape/size, accessible
status labels, profile fallback rules and semantic colors. Custom status color
configuration references tokens. Use the same palette and motion for the
profile selector, member lists and avatar indicator. A plain Avatar remains
usable without presence; no component creates its own connection.

The requested REUI `c-avatar-29` stack also composes this indicator. Keep its
icon count and optional add action, but make the individual avatars obey the
shared size/shape configuration. Presence outlines inherit square corner
radii instead of assuming a circle; overlap layers and clipping must preserve
status and focus visibility. The group is a subscriber, not another heartbeat
owner or a permission-granting membership action.
Only decorate avatars when the app has enabled presence and the observation
is admitted. Disabled presence is not an offline observation: omit rings,
status labels and tracking rather than inventing a status for every member.

Preserve existing room APIs where possible while correcting the shared-key,
expiry/reconnect and lifecycle behavior. Document any wire or payload change
and compatibility mapping explicitly. New organization hooks are not aliases
that bypass the room policy.

## Optional status actions and triggers

Presence transitions can be useful to application actions, but the current
automation setup admits application/actor registries, not arbitrary SYSTEM
tables. A new presence table is not automatically a trigger source.

If status transitions are exposed as automation inputs, add a supported
managed admission/projection or explicit typed event/outbox seam. Make
transition IDs stable for retry/idempotency and expose only authorized data.
Do not claim exactly-once arbitrary external side effects. A transient idle
heartbeat must not trigger a function; an accepted meaningful transition can
do so under an explicit policy. This is not Torrent-specific.

## Shutdown and service lifetime

Reuse the app's existing transport quiesce and awaited extension-drain order.
Stop new admission, retire the lease owner, publish/await retirement and drain
projection writes while Guardian/Fabric are still usable. Then retire Sync
bridges/timers and dispose actors/providers. Pending external work can settle
but cannot re-add leases or start timers after close/disposal.

See [app stop lifecycle](../src/frontend/server/app-stop-lifecycle.ts),
[runtime cleanup](../src/runtime/zero-app-runtime.ts),
[Sync teardown](../src/sync/sync-plugin-lifecycle.ts), and
[database manager](../src/databases/database-manager.ts). A timeout/error
preserves standard observability and cannot leave an unnoticed active owner.

## Qualification and documentation

Existing channel/client unit checks passed 17 tests with 51 assertions during
the source audit. They establish current tenant/key policy behavior, not the
new aggregation, freshness, Fabric or UI guarantees.

Required focused acceptance covers:

- Two tabs, two devices and two gateways where supported; closing one cannot
  mark another admitted connection offline.
- Active versus hidden/idle tabs, heartbeat versus human activity, manual
  precedence/expiry and custom catalog validation.
- TTL deletion fanout, ordinary reconnect replay, no obsolete heartbeat
  backlog, close during verification, late publication and disposal.
- No database writes or change notifications for heartbeat-only renewal;
  bounded checkpoint overhead measured separately from authority reads.
- Read-only system and Fabric SQL/service reads, actual schema admission,
  revision ordering, retries and projected startup/owner expiry.
- Cross-organization/room isolation, administration app-only members,
  membership/account/key revocation and scope switching with pending work.
- Synthetic crash/restart, owner epoch retirement/failover, transient storage
  cleanup and awaited shutdown before database/provider disposal.
- SSR/public package consumption, hook/provider single ownership, reduced
  motion, light/dark avatar rings, keyboard status selection and stale UI.

Publish configuration, topology/freshness, status semantics, actor query,
privacy, lifecycle and client/UI guides with cross-links to Guardian, rooms,
Sync, Fabric, Reactive DB and profiles. Update Doctor/startup guidance,
inventories, examples and upgrade notes. Do not describe a process-local
implementation as multi-gateway or a SYSTEM-only feed as actor SQL support.
