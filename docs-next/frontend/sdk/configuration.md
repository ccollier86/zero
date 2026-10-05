---
id: zero.frontend.sdk.configuration
type: reference
audience: [developer, agent]
owner: frontend-sdk
status: draft
visibility: internal
system: frontend-sdk
feature: configuration
maturity: supported
applies_to: ["2.1.1 source; package qualification pending"]
modes: [browser, single-database, Fabric]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Client SDK Configuration

[SDK index](./index.md) · [Documentation index](../../index.md)

These options are client construction or request inputs. They do not discover
environment files, persist app settings or turn on disabled backend capabilities.
Never put server credentials into browser configuration.

## ClientConfig

| Option | Accepted shape | Omitted behavior / timing |
| --- | --- | --- |
| url | required HTTP(S) server URL | read at creation; SDK derives its /sync WebSocket URL |
| tables | raw ClientTableDef or defineTable clientTable map | no app tables; normalized at construction |
| tableSyncPlanes | exact server-authored map for configured app tables | historical default-plane mapping; platform tables are SDK-owned system routing |
| auth | boolean | false; creates integrated AuthClient only when enabled |
| authorizationRevalidationIntervalMs | milliseconds | 30000 in AuthClient; zero disables hint polling, not live server enforcement |
| stateSync | boolean | false; true requires auth=true |
| autoConnect | boolean | true; false defers initial socket until connect() |
| maxReconnectAttempts | number | low-level default Infinity |
| resourcePrefix | string | /api/resources; normalized in each resource facade |
| onError | `(error: string) => void` | optional unrecoverable connection notification |
| onReconnect | `() => void` | optional successful reconnect notification |
| onMutationRejected | callback receiving SyncMutationRejection | optional notification after local rejection rollback |

Use tables for multi-table schemas: `tables: databaseSchema.clientTables`.
ClientConfig does not have a schema convenience property. AppProvider separately
accepts defineTable objects and uses server-injected mode/routing metadata.

Auth-enabled clients register relevant framework-owned tables on the system
plane automatically. Do not configure their plane names as app tables; duplicate
platform/unknown/missing app routing declarations reject. Neither a browser map
nor a reconnect setting can authorize a tenant or override server exposure.

Client options are captured when the singleton is created, not updated live
through React props. See [lifecycle](./client-lifecycle.md) and
[provider configuration](../runtime/configuration.md).

## FetchInit

`client.fetch<T>(path, init?)` accepts method, body, headers, signal and json.
Headers are a string record; body is serialized as JSON when non-null/defined.
Omitted method is POST when a body exists and GET otherwise. json defaults true;
false returns a raw Response. The generic T is a caller's expected type, not an
installed runtime response schema. See [HTTP](./http.md).

The get/post/put/patch/delete shortcuts do not accept the complete FetchInit
object. Use fetch when adding headers, a signal or raw response mode. Eden uses
its own typed request/body options with the same underlying auth owner; it is
not configured by passing native RequestInit as JSON body.

## Collection Receipt Options

insertAsync/updateAsync/removeAsync accept `SyncMutationWaitOptions`:

- signal aborts the caller's receipt wait, not an already-submitted server write.
- timeoutMs defaults to 30000, must be a positive safe integer and cannot exceed
  300000. The bound includes same-row queue time.

This caller wait differs from lower-level transport acknowledgment policy.
[Acknowledged mutations](./acknowledged-mutations.md) owns exact failure codes.

## Resource Options

`client.resource(name, { prefix? })` overrides the configured resourcePrefix for
that facade. list accepts filters, sort/null, limit, offset and signal. get accepts
an optional signal. create/update/delete/remove accept signal and idempotencyKey.
Names/IDs are encoded into their route paths.

An omitted idempotencyKey is generated for the logical mutation. An explicit key
is 1–128 characters, starts alphanumeric and then permits alphanumeric, dot,
underscore, colon and hyphen. Reuse only for the identical operation/body/authority
context. See [resource retries](./resources.md#uncertain-results-and-idempotency).

## Diagnostics And Security

The SDK reads normal browser configuration and performs actual requests only
when its lifecycle/calls require them. A TypeScript declaration/type registry
does not validate a URL or import app config safely. Doctor's trusted server
checks do not qualify browser request timing, hydration or accessibility.

Keep arbitrary user input out of privileged destinations/configuration. Use
normal scoped server services and safe error feedback, not raw tokens or internal
client handles. Changes need appropriate client recreation/build and backend
configuration; this page introduces no database settings table or hot reload API.

## Related Guides And Next Steps

- [Client lifecycle](./client-lifecycle.md) owns creation/teardown.
- [HTTP](./http.md) owns JSON/raw request behavior.
- [Collections](./collections.md) owns table registration/local state.
- [Resources](./resources.md) owns route/query/idempotency semantics.
