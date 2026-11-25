---
id: zero.guardian.avatars
type: reference
audience: [developer, agent, operator]
owner: guardian
status: verified
visibility: internal
system: guardian
feature: private-avatar-media
maturity: supported
applies_to: ["2.11.1 source/local contract; verify committed archive and external release qualification receipt"]
modes: [single-simple, single-advanced, multi-simple, multi-advanced, native]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "1bc732ba4375e87621f1be093ef257a7e11ff9e5"
  snapshot: clean
  date: "2026-10-26"
  evidence_level: implementation-verified
---

# Private Profile Avatars

[Guardian index](./index.md) · [Own profiles](./user-profiles.md) · [Profile UI](../../frontend/guardian/profile-settings.md)

Guardian avatars are normalized private media attached to a real account, not
an arbitrary user-supplied URL. Managed composition reuses Storage for byte
transport and durable blob handling, while Guardian owns receipt identity,
account authority and the final profile revision.

Zero 2.11.1 adds the versioned peer-read policy and native private-chat
presentation described below; a 2.11.0 archive does not contain these additions.
Identify installed support by the committed archive and SHA-256, not just its
package version. The [qualification record](../../_work/private-chat-avatars-qualification.md)
separates validated source/browser checks from receipt-bound exact-archive,
Linux and updater results. Neither this reference nor its version label
substitutes for that release evidence or application-specific acceptance.

## Configuration And Provisioning

```ts
import { defineAuthConfig } from '@zero/framework/auth';

export const auth = defineAuthConfig({
  userProfile: {
    avatars: {
      enabled: true,
      editable: true,
      shape: 'circle',
      size: 'default',
      fallback: 'initials',
      maxUploadBytes: 8 * 1024 * 1024,
      maxPixels: 16_000_000,
      outputSize: 512,
    },
  },
});
```

`avatars` also accepts true/false and defaults to false. Shapes are circle,
rounded or square; sizes are sm/default/lg; fallbacks are initials, username,
email or none. Limits are validated, not arbitrary: upload bytes 1 KiB–20 MiB,
pixels 256–40 million, output size 64–1024 square pixels.

Enable the existing managed Storage service as well. Migration 042 installs the
fixed private SYSTEM receipt/asset/pointer tables. Managed startup provisions a
private application-owned profile-media drive in the same SYSTEM transaction
domain. It is not a public tenant bucket, and enabling avatars does not create
one drive per member or modify every customer schema.

Missing Storage, disabled migration or incompatible private schema yields blocked
capabilities. Disabled avatars do not delete retained images. A publicly changed
profile-media namespace is rejected, not served as a public fallback.

## The Accepted Upload Lifecycle

The SDK facade is `client.userAvatar` / `client.auth.avatars`:

1. `stage(expectedRevision, signal?)` allocates a short-lived account/session-bound
   receipt and an existing signed Storage upload grant.
2. `upload(stage, imageBlob, signal?)` transports bounded JPEG/PNG/WebP bytes.
3. `finalize(stage, signal?)` decodes, normalizes and attaches an immutable asset.

`replace(imageBlob, expectedRevision, signal?)` performs those three steps under
one captured authorization scope. `cancel(stage)` retires an unconsumed receipt;
`remove(expectedRevision)` removes the current pointer. An allocated SDK stage
belongs to that originating SDK scope and cannot be fabricated or reused after
an account/organization authority transition.

The server validates actual image bytes, not only MIME or extension. SVG, GIF,
animation, malformed/truncated data and excess dimensions are rejected. EXIF
orientation is applied; output is a square WebP with metadata removed. Processing
uses the bounded raster decoder; browser cropping is useful presentation, never
the security validator.

For bundled or executable deployment, use the normal
[Zero build](../../cli/tooling/build.md#deployment-boundaries) and move its whole
output directory. The host-native Sharp/libvips payload lives privately beside
the server under `zero-native/`; it is not an app-source or `node_modules`
requirement and must not become a public asset. Disabled avatars do not load the
optional decoder. Missing native runtime payload returns safe
`AUTH_AVATAR_NOT_READY` (503), not a claim that a valid image was malformed.
Cross-OS/architecture native builds require separate qualification.

Avatar and ordinary profile edits share the account's profile revision. A newer
edit or revoked session during provider I/O defeats attachment. Consuming an
already-accepted receipt is idempotent only while it still names the current
asset. Cancellation and grant expiry are checked again at final Storage commit,
so a delayed upload cannot recreate a cancelled stage's object afterward.

Avatar feature operations also use the shared [profile policy generation](./user-profiles.md#provisioning-and-safe-rollout).
After a newer bootstrap changes that configuration, an older service projects
blocked capabilities and cannot admit or attach an asset through its retired
writer fence. This is separate from the profile CAS and session-revocation check;
configuration A→B→A does not reactivate the original A service. A policy-retirement
error requires the current runtime, not a forced retry against the old instance.

## Accepted Changes Across Mounted Consumers

A validated avatar command notifies independent mounted consumers of the same
SDK client; it does not change the database schema or weaken private delivery.
Older archives may lack this additive reactivity; identify the installed
framework by its committed archive rather than copying hooks into an app.

`useUserAvatar()` observes accepted `finalize`, `replace`, `remove`, `publish`
and `withdraw` results automatically. An editor and a persistent sidebar can
therefore have independent hooks without an `onAccepted` refresh bridge, a
second profile Save, navigation or remounting. Late lower-revision reads or
acknowledgments cannot restore an older photo in the same scope and policy.

Non-React SDK consumers can subscribe explicitly:

```ts
const unsubscribe = client.userAvatar.subscribe(snapshot => {
  // Validated own-account metadata; use deliver() for private image bytes.
  updateAvatarSummary(snapshot);
});
// Dispose with the consumer; this is not an initial-value or replay API.
unsubscribe();
```

`client.auth.avatars` is the same transport. Each listener receives its own
snapshot copy, never image bytes, upload grants or receipt proofs. Reads,
staging, upload progress, cancellation and failed/unknown commands do not emit
a saved-photo notification. Subscriber exceptions are observed safely without
turning an accepted write into a failed operation. Notifications are fenced to
the originating current authorization scope; hooks also check the live account
and any supplied capability key before adopting metadata and retrieving private
bytes.

This own-account subscription is same-client command propagation, not a new
cross-tab or cross-device event bus. Changes made through another SDK instance
still need an authenticated `refresh()`/`get()` in an ordinary own-profile
consumer. The 2.11.1 native messaging watches separately refresh
admitted peer presentation from current server state; they do not broadcast an
own-avatar command to other clients. No generic Sync access to private SYSTEM
avatar tables is introduced. Each hook continues owning and revoking its own
temporary image URL.

## Private Delivery And Directory

Snapshots contain an authenticated `deliveryPath`, not a public blob URL.
`deliver(asset, signal?)` retrieves bounded private WebP bytes; UI hooks manage
temporary object URLs and revoke them on replacement/unmount/scope retirement.
HTTP responses are no-store, nosniff and same-origin resource policy.

`directory(userId)` returns only `userId`, `displayName`, current shared profile
`revision`, and nullable private `asset`. Older server replies may omit revision;
the SDK admits that legacy shape, but a new private messaging presentation
requires a valid revision. No email, username, upload receipt or Storage grant
is part of this directory entry.

Without the optional peer-read policy below, existing behavior is unchanged:
multi-tenant web callers may inspect active users in their selected organization;
other organizations are not a global address book. Single-mode web callers see
active account identities. Native directory access is self-only and respects
profile/read/write scopes. API keys cannot use private avatar reads or edits.

### Viewer-To-Subject Private Read Policy

Add `userAvatarReadPolicy` to the server's runtime `auth` configuration alongside
`userProfile`, not inside the serializable `userProfile.avatars` options:

```ts
import type { AuthUserAvatarReadPolicy } from '@zero/framework/auth';

const photoReads: AuthUserAvatarReadPolicy = {
  id: 'application-private-photos',
  version: '1',
  authorize({ viewerId, subjectId, db }) {
    // Illustrative application table, not a Zero-provided schema. Read the
    // application's current canonical assignments rather than cached grants.
    return db.query('active_assignments').some(row =>
      row.resident_id === viewerId && row.staff_id === subjectId
      || row.staff_id === viewerId && row.resident_id === subjectId);
  },
};

// Pass this runtime object as createApp({ ..., auth }). Keep it server-only.
const auth = {
  userProfile: { avatars: true },
  userAvatarReadPolicy: photoReads,
};
```

This example only illustrates a current assignment pair. An application's
complete policy can also admit current housemates, currently admitted chat
participants or an explicitly authorized staff roster. A person being allowed
to see a photo does not make them a direct-message recipient; house/group photo
admission must not be inferred only from a DM contact list. Conversely,
rendering a conversation or supplying a participant ID never grants private
photo access. Share the application's canonical relationship helpers where
appropriate, without calling asynchronous messaging APIs inside this policy.

`authorize` must return the literal boolean `true` synchronously. False,
exceptions, promises/thenables and invalid results deny access with the same
unavailable response; callback text and relationship facts are not returned.
The runtime snapshots the policy's own enumerable `id`, `version` and
`authorize` data fields. IDs/versions are nonempty 1–80 character strings using
letters, digits, `.`, `_` or `-`. Change `version` when policy semantics change;
ordinary live relationship data changes do not require a version bump.

The request-local context provides `viewerId`, `subjectId`, the canonical
`scope`, read-only application `db.get`/`db.query`, and
`allows(userId, requirement)` using current Guardian authorization in that
scope. It does not expose SYSTEM, Storage, raw SQL, writers or a browser-chosen
tenant. The guarded context expires when the callback returns: do not retain
it, query builders or asynchronous work for later use. Direct auth-plugin
composition must provide an equivalent trusted read-context factory when it
composes the avatar service; a configured policy without a context fails closed.

Application reads are trusted server reads, not automatically row-filtered
queries. Include the selected `scope`, viewer and subject in every application
relationship check. `db.query(table)` reads that whole application table; prefer
indexed `db.get` lookups or a bounded current relationship projection on this
delivery hot path. Version 1 does not asynchronously open arbitrary Fabric
files or call remote providers inside a synchronous Storage fence. Where facts
live in another Fabric plane, maintain an authoritative synchronous projection
with a revocation-safe update boundary, or use current Guardian permissions.
This callback does not create a transaction spanning independent databases.

The callback only narrows peer reads. Own-account avatar editing/delivery is
preserved, and a `true` result cannot bypass active-account/session checks,
selected-tenant membership, native self-only/profile consent, private namespace,
installed profile-policy generation or current asset identity. There is no
administrator photo-read bypass. The server applies the policy to both
authenticated directory lookup and the held private asset path, including
fresh fences across provider awaits and bounded stream reads before returning
image bytes. Losing the viewer's final allowed relationship therefore denies
the same previously obtained private URL without requiring another directory
lookup. Replacement/removal retires the old asset path as before.

Policy identity/version participate in installed profile-policy fingerprinting.
Deploy a semantic change as a coordinated runtime update; the retired runtime
must not continue serving peer photos with old semantics. Do not try to revive
it by reverting the local configuration or retrying an old request. This is a
runtime configuration hook, not a persisted callback or a public auth-config
field; it must remain outside browser/shared schema modules.

### Native Messaging Private Presentation

Native messaging projects an optional `privateAvatar` alongside existing names
and public `avatarUrl`. Its value is either `{ revision, asset }` or `null`.
`asset: null` records an admitted removal revision; a null presentation means
no private photo is currently admitted/available. The server evaluates the
Guardian read policy for the viewer when constructing these projections, and
byte delivery still rechecks independently. A descriptor is not a grant.

The native `MessagingWorkspace` loads these images through authenticated
`client.userAvatar.deliver()`, not by pointing an image element at a private
path. Its contact picker, participants, header, conversation previews and
messages use the ordinary Avatar/initials fallback. An explicit denied/removed
private presentation cannot reuse a retained public/inline photo projection.
Legacy/custom facades which omit the new field retain their prior behavior;
anonymous/external identities do not gain a Guardian private-photo session.

`watchDirectory` and `watchPeople` refresh authorized metadata after relevant
committed changes. A replacement/removal can therefore refresh a mounted chat
in another session even if the conversation's own revision did not change.
This is scoped native messaging reactivity, not global access to avatar tables
or a cross-device byte cache. Relationship policy and Guardian admission are
rechecked when the projections are read.

For an admitted custom React surface, `useUserAvatarPresentation(subjectId,
presentation)` is exported from the root and `/react` profile facade. Supply
only metadata obtained through an authorized projection in the existing
auth-enabled provider; this hook does not discover arbitrary users. Each
mounted consumer owns its pending reads and object URL, partitioned by current
authorization scope, subject and photo revision/asset. Null/removed metadata,
account/tenant changes, sign-out, authority-data retirement and unmount mask
the old preview, abort pending work and revoke the URL. Late promises cannot
restore retired bytes. A failed/unavailable optional photo displays initials.

No-store and URL retirement cannot erase bytes a user has already downloaded
or copied outside this UI. Intentionally published public photos are a separate
owner opt-in below; a private peer-read policy does not turn a public
publication into protected media. Keep public publication disabled for an
application whose profile photos must remain private.

## Optional Public Avatar Publication

Public photos are a separate explicit owner opt-in, not a prerequisite for
private native chat. Older private-avatar baselines do not identify an archive
containing publication support. See the [author-foundation qualification](../../_work/audits/blog-author-foundation.md)
and verify the installed archive before using this contract.

Add `publicAccess: true` to the existing `auth.userProfile.avatars` object.
The default is false; `avatars: true` alone still means private media. SYSTEM
migration 046 adds explicit publication pointers without publishing existing
images or changing the private Storage drive.

The existing SDK gains two own-account methods:

```ts
const current = await client.userAvatar.get();
// Deliberate owner action after a real image has been attached:
const published = await client.userAvatar.publish(current.revision);
const publicPhoto = published.publicAsset;
// Deliberate withdrawal, using the latest shared profile revision:
await client.userAvatar.withdraw(published.revision);
```

`client.auth.avatars` is the same authority-bound owner. The existing hook's
`mutate((api, signal) => api.publish(revision, signal))` can compose this ceremony;
the standard AvatarEditor does not silently publish uploads or add a public
toggle. An application must present the public/private choice deliberately.

Capabilities add `publicAccess` and `publicState` (ready/blocked/disabled).
Snapshots add nullable `publicAsset`. That allowlisted descriptor contains only
opaque publication ID, width/height/byteLength, WebP MIME and exact public
`deliveryPath`; it is distinct from the private asset/Storage identity. No
account ID, directory query, email or provider URL is exposed by the public
image endpoint. POST/DELETE `/auth/profile/avatar/publication` accept only
`{ expectedRevision }`. GET `/auth/profile/avatar/public/:publicationId` serves
the explicitly published current image anonymously, with no-store/nosniff and
cross-origin image resource policy for use on a public site.

Publication shares Guardian's profile CAS and live session/native writer checks.
A stale revision is rejected. Publishing the already-published current photo
does not advance that revision or allocate a new URL. A missing public migration
blocks public actions separately while valid private-avatar operations remain
available. Managers cannot publish another person's private photo through the
blog-author API.

Replacement/removal invalidates the old public URL; replacement **does not
automatically publish the new image**. Suspension/deletion, withdrawal, disabled
public policy, changed installed policy or runtime teardown also prevents new
delivery. Provider reads are bounded and rechecked before bytes are released.
The [author foundation](../blog/authors.md) reuses only this intentionally public
descriptor. Its public-photo requirement is not satisfied by initials or a
private image.

Public means downloadable by anyone who has the URL. No-store/withdrawal cannot
recall copies already downloaded by visitors or third-party caches. Disabling
the policy retains publication metadata; re-enabling can restore a still-current
retained publication. Use explicit withdrawal for removal, rather than relying
on a temporary configuration switch as a consent-erasure operation.

## Drain, Recovery And Privacy

Pending assets and cleanup claims are durable. Replacing/removing an avatar
retires the previous asset; a leased worker deletes only unreferenced media.
Finalizer failure releases its asset cleanup lease only after provider I/O
settles; cancellation alone cannot delete a still-running write. Restart resumes
retained cleanup without deleting a newly current image.

Runtime shutdown rejects new work, cancels acquired reads and joins admitted
avatar/provider operations before Guardian/SYSTEM disposal. It does not impose
an unsafe deadline that abandons a callback with a SQL mutation still pending.
An app-owned Storage adapter must settle its admitted read/write/delete promises
and honor its declared shutdown safety contract. An indefinitely unresolved
custom provider can consequently delay graceful shutdown; forcibly abandoning
such a provider is not a supported safe-drain guarantee.

Observability reports stable operation codes, never images, receipts, addresses
or signed upload grants. Media is not served through an arbitrary external URL
or copied into reactive user rows.

Native byte-stream cleanup is best effort after substantive reading: a drained
Bun reader's `releaseLock()` error must not reject an otherwise valid upload or
mask the original limit/source/authorization error. This does not skip the byte,
checksum, fsync, MIME, decoder or final authority fences. Qualify the actual
browser stage → signed PUT → finalize → shared profile save → private delivery
sequence on the deployed OS/architecture; a mocked adapter or direct in-memory
Request is not proof that native HTTP/file stream cleanup works.

- [Storage](../storage/index.md) owns providers and blob recovery.
- [Presence](./presence.md) supplies optional fresh avatar rings.
- [Avatar Group](../../frontend/components/avatar-group.md) is roster presentation.
