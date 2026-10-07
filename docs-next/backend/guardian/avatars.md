---
id: zero.guardian.avatars
type: reference
audience: [developer, agent, operator]
owner: guardian
status: in-review
visibility: internal
system: guardian
feature: private-avatar-media
maturity: preview
applies_to: ["Adaptive profile working source; release qualification pending"]
modes: [single-simple, single-advanced, multi-simple, multi-advanced, native]
reviewed_against:
  package: "@zero/framework"
  version: "2.5.0"
  commit: "ae85a4b6efe11eeb74ab89b15ed02a23e982c59f"
  snapshot: dirty
  date: "2026-10-06"
  evidence_level: source-observed
---

# Private Profile Avatars

[Guardian index](./index.md) · [Own profiles](./user-profiles.md) · [Profile UI](../../frontend/guardian/profile-settings.md)

Guardian avatars are normalized private media attached to a real account, not
an arbitrary user-supplied URL. Managed composition reuses Storage for byte
transport and durable blob handling, while Guardian owns receipt identity,
account authority and the final profile revision.

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

## Private Delivery And Directory

Snapshots contain an authenticated `deliveryPath`, not a public blob URL.
`deliver(asset, signal?)` retrieves bounded private WebP bytes; UI hooks manage
temporary object URLs and revoke them on replacement/unmount/scope retirement.
HTTP responses are no-store, nosniff and same-origin resource policy.

`directory(userId)` returns only an authorized minimal display name and avatar
descriptor. Multi-tenant web callers may inspect active users in their selected
organization; other organizations are not a global address book. Single-mode
web callers see active account identities. Native directory access is currently
self-only and respects profile/read/write scopes. API keys cannot edit avatars.

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

- [Storage](../storage/index.md) owns providers and blob recovery.
- [Presence](./presence.md) supplies optional fresh avatar rings.
- [Avatar Group](../../frontend/components/avatar-group.md) is roster presentation.
