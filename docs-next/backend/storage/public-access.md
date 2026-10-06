---
id: zero.storage.public
type: how-to
audience: [developer, agent, operator]
owner: storage
status: draft
visibility: internal
system: storage
feature: public
maturity: supported
applies_to: ["2.2.1 development source with explicit visibility UI; package qualification pending"]
modes: [single, multi, application, organization, personal, shared-cas]
reviewed_against:
  package: "@zero/framework"
  version: "2.2.1"
  commit: "95ba0578f6625fc4597a9ec6786ee1d3353f29cd"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Public Read Is An Explicit Policy

[Storage index](./index.md) · [Documentation index](../../index.md)

Drive public and object public are visibility controls for read access.
They do not make an entire drive anonymously writable, permit ACL changes or
bypass managed lifecycle/tenant boundaries.

## Studio Ceilings

storage.studio.publicAccess.allowPublicDrives and allowPublicObjects both default
false. A client requesting public:true cannot override those server ceilings.
Provision/update/object visibility is admitted against current owner/capability
policy.

To allow both drive-wide and individual-file publication, use this storage
configuration module in the existing application configuration:

```ts
import type { AppStorageConfig } from '@zero/framework/server';

export const storage: AppStorageConfig = {
  studio: {
    enabled: true,
    publicAccess: {
      allowPublicDrives: true,
      allowPublicObjects: true,
    },
  },
};
```

The application still supplies its other normal Guardian/Fabric/storage
configuration. Settings are captured at server setup; changing this policy
requires the normal configuration update/restart. `allowPublicDrives` requires
`allowPublicObjects`; individual-object publication can be enabled without
allowing public drives. These switches permit publication but do not themselves
publish any drive/file or grant anonymous write/admin authority.

## Drive And Object Visibility

In the packaged Studio, select a drive and open **Settings → Visibility → Public
read**, then Save settings. A public drive permits anonymous downloads of all
its existing and future files; it is not a one-time copy of current permissions.
An individual object's private flag cannot override its public drive. Make the
drive private before restricting individual files.

For a private drive, select a file and open **Sharing → Public visibility → Make
public**. Only that object's own public flag changes; publishing a folder does
not automatically publish its children. **Make private** clears
the selected object's flag but does not negate a still-public drive.
File visibility requires the current Storage ACL admin capability; managed
drive settings require current Studio control-management authority. Both are
admitted against their applicable server policy. Neither flag permits anonymous uploads, mutation or
ACL editing, or authority to enumerate unrelated private metadata.

When publication policy is off, the UI keeps the visibility controls visible
with a disabled-public-action explanation, rather than silently omitting them.
An already-public drive/object still offers the private remediation action after
policy tightening. The control's presence is never backend authorization.
See the [Studio inspector](../../frontend/storage/storage-studio-inspector.md)
for the packaged control locations and [permissions](./permissions.md) for
hierarchical grant/public-read composition.

## Signed Access Instead

Use short-lived [download capabilities](./capabilities.md) to share selected
private content without permanently setting public.
Use an [upload grant](./upload-grants.md) to accept one bounded public upload
without making the hierarchy public-writable.

Treat signed URLs/tokens as bearer secrets. A leaked valid token can convey its
scoped permission until expiry/live generation policy rejects it.
Do not log tokens or use them as ordinary analytics parameters.

## Scope Of Sharing

Public-read transport is not a generic cross-tenant API or proof that storage
metadata should be globally synchronized to every client.
User-facing UI must still resolve current capabilities and retire old
organization state on switching.

If content is truly sensitive, public access is an app policy decision requiring
its own review; the platform doesn't infer consent from an upload filename.

See [permissions](./permissions.md), [Studio authority](./studio-authority.md),
[request authority](./request-authority.md) and [configuration](./configuration.md).
