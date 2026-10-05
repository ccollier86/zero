---
id: zero.frontend.state.ephemeral
type: reference
audience: [developer, agent]
owner: sync
status: draft
visibility: internal
system: sync
feature: frontend-ephemeral
maturity: supported
applies_to: ["2.1.1 source; package qualification pending"]
modes: [browser, SSR, Guardian single, Guardian multi, single-database, Fabric]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Authorized Ephemeral Collaboration

[State index](./index.md) · [Documentation index](../../index.md)

Ephemeral state is bounded server RAM, not durable JSON or KV. Managed topic
policies govern user/room namespaces; an arbitrary topic name is not authority.
Use the normal room/presence hooks when they fit, rather than inventing
unclassified collaboration channels.

```tsx
import { useEphemeral, useEphemeralTopic, useEphemeralErrors } from '@zero/framework/react';

const [cursor, setCursor] = useEphemeral(topic, 'cursor', { x: 0, y: 0 });
const entries = useEphemeralTopic(topic);
useEphemeralErrors((error) => handleTopicError(error.code));
```

This fragment assumes an admitted topic and app error handler under the provider.
useEphemeral(topic,key,defaultValue) returns [value,setValue]. useEphemeralTopic
returns the full entries map with value/user attribution/entry metadata.
useEphemeralErrors(listener) subscribes to protocol authorization/validation
failures and returns void; keep raw private values out of logs.

EphemeralClient (advanced Sync surface) manages topic subscriptions, local reads/
set/delete and error listeners. The managed server owns TTL, topic admission,
entry ownership and disconnect cleanup. The client does not convert RAM topics
into durable records. Presence/typing are useful ephemeral cases; a user's
workflow/form memory should use its actual durable system.

Scope changes unsubscribe/mask entries and fence setters/error callbacks.
SSR returns the supplied default or empty entries without a browser socket.
Default values apply when an entry is absent; do not assume stored null and
absence mean the same app state. Missing context/client is a wiring error.

## Verification

Test subscribe/unsubscribe, live values, rejected unauthorized topic/entry changes,
room removal, TTL/disconnect and identity replacement. UI defaults/hidden panels
do not admit a topic or bypass server policy.

## Related Guides And Next Steps

- [Rooms](../rooms/index.md) supplies managed presence composition.
- [Server state](./server-state.md) is the durable alternative.
- [Configuration](./configuration.md) owns client prerequisites.
- [Low-level Sync](../sdk/low-level-sync.md) owns advanced clients/stores.
