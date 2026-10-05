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
applies_to: ["2.1.1 source; new documentation under review"]
modes: [single, multi, application, organization, personal, shared-cas]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
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

An object's visibility can differ from its parent drive subject to the admitted
public-object policy; neither flag is authority to enumerate every private
metadata row.

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
