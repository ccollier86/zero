---
id: zero.frontend.sdk.http
type: reference
audience: [developer, agent]
owner: frontend-sdk
status: draft
visibility: internal
system: frontend-sdk
feature: http
maturity: supported
applies_to: ["2.1.1 source; package qualification pending"]
modes: [browser, authenticated, auth-disabled]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Authenticated JSON HTTP

[SDK index](./index.md) · [Documentation index](../../index.md)

Use client.fetch or JSON shortcuts for app-owned HTTP endpoints when a generated
resource/service facade is not the appropriate interface. They share the normal
AuthClient transport when auth is enabled. They are JSON convenience methods,
not native fetch with arbitrary BodyInit behavior.

## Methods And Results

| Method | Request behavior |
| --- | --- |
| fetch<T>(path, init?) | configurable method/body/headers/signal/json; default GET, or POST with non-null body |
| get<T>(path) | GET and parsed JSON |
| post<T>(path, body?) | POST and optional JSON body |
| put<T>(path, body?) | PUT and optional JSON body |
| patch<T>(path, body?) | PATCH and optional JSON body |
| delete<T>(path) | DELETE and parsed JSON |

The path normally begins with / and is appended to the configured URL. Absolute
HTTP URLs are also accepted by the facade; only use trusted intended destinations
for authenticated traffic, never arbitrary user-supplied URLs. With auth disabled,
requests use ordinary fetch without a Guardian bearer.

Non-null/defined body is JSON.stringify'd and gets Content-Type application/json
unless headers override it. Null/undefined means no body. An empty successful
response resolves undefined; nonempty successful text is JSON parsed by default.
T is the caller's expected TypeScript result, not runtime schema validation.

## Headers, Abort And Raw Response

```ts
// Fragment: client is the app's normal configured Client; endpoint is app-owned.
const controller = new AbortController();
const result = await client.fetch<{ label: string }>('/api/current-label', {
  method: 'GET', signal: controller.signal,
});
```

Use fetch rather than get when supplying request options. json:false returns a
raw Response, useful when the endpoint returns non-JSON data:

```ts
const response = await client.fetch<Response>('/api/report', {
  method: 'GET', json: false,
});
const blob = await response.blob();
```

The source generic does not overload json:false to infer Response automatically;
request that expected result explicitly. The SDK does not install a download
handler, retain the blob or provision storage merely because a response is raw.

## Multipart Is A Different Body Contract

Do not pass FormData to client.post expecting multipart upload: this facade
serializes the value as JSON. The official typed Eden path delegates its supported
body/multipart request to centralized authenticated transport. See
[typed API](./typed-api.md#multipart-and-restoration) and use the endpoint's actual
request type. Do not add an app-owned bearer retry loop to compensate for a
mis-selected JSON interface.

## Authentication And Errors

With auth enabled the underlying AuthClient owns restoration, bearer injection
and 401 refresh/retry. Scoped request/results are fenced across identity/tenant
replacement. Callers should not attach an old cached Authorization value; the
normal transport must be able to replace credentials during retry.

Non-OK responses throw FetchError with message, status and parsed body. If an
error response is not JSON, its safe status text supplies fallback feedback.
The class is public from @zero/framework/react. Use status/structured body for
handling rather than arbitrary provider stack text; do not log raw sensitive
body/headers/tokens. Invalid successful JSON still rejects during parsing.

Abort stops the request/wait where the transport can; it is not proof an already
submitted mutation did not commit. Custom state needs its own after-await
[scope fence](../runtime/authorization-scope-boundary.md). Generated resource
mutations provide a separate [idempotency contract](./resources.md#uncertain-results-and-idempotency).

## Verification

Exercise parsed JSON, empty success, non-JSON raw response, a structured error,
401 refresh/retry and a request completed after scope replacement. Use synthetic
routes/transport, not production records. The source SDK/API tests verify focused
cases; the actual app route's schema and installed artifact still need qualification.

## Related Guides And Next Steps

- [Configuration](./configuration.md#fetchinit) lists exact request options.
- [Typed API](./typed-api.md) offers Eden result/route handling and multipart.
- [Resources](./resources.md) avoids duplicating generated policy-aware CRUD.
- [Client lifecycle](./client-lifecycle.md) owns shared transport/auth state.
