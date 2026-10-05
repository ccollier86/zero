---
id: zero.sync.ephemeral-policy
type: reference
audience: [developer, agent, operator]
owner: sync
status: draft
visibility: internal
system: sync
feature: ephemeral-policy
maturity: supported
applies_to: ["2.1.1 source baseline; package qualification pending"]
modes: [single, multi, default-plane, system-plane, tenant-database]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Authorize Ephemeral Topics

[Sync index](./index.md) · [Documentation index](../../index.md)

Authenticated standalone plugins deny topic access when ephemeralPolicy is
omitted. Authless standalone compatibility retains permissive legacy topics.
Managed createApp installs a scoped policy; its reserved topics cannot be
weakened by a custom application policy.

## Managed Reserved Topics

| Topic | Admission and write ownership |
| --- | --- |
| presence:roomId | Current RoomService membership; key user:authenticatedUserId |
| typing:roomId | Same room membership and actor-derived key |
| user:userId:suffix | Current user only; valid nonempty suffix |

Room namespaces include the current service scope and room identity. Personal
namespaces include scope, user identity and suffix. Multi mode requires a
complete tenant-bound identity, so equal room strings in different tenants do
not share values.

## Custom Topics

createManagedEphemeralTopicPolicy accepts a getRoomService binding,
tenancyMode and optional customPolicy. Its custom policy runs only for
otherwise unclassified topics. A successful custom namespace is additionally
qualified by the current service scope and app namespace.

Return a policy decision with an explicit admitted namespace and ownership;
deny unrecognized topics. Derive any resource ownership from verified current
authority and a server lookup. An arbitrary client topic is never evidence that
the caller belongs to the corresponding organization.

Stable errors distinguish unauthenticated, forbidden, unclassified,
unavailable policy and invalid namespace/key/TTL/value conditions. Do not place
private membership information in denial messages.

See [ephemeral values and bounds](./ephemeral.md), [room membership](../rooms/index.md),
[Guardian](../guardian/index.md), [lifecycle](./lifecycle.md) and
[configuration](./configuration.md).
