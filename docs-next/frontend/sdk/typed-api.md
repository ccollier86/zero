---
id: zero.frontend.sdk.typed-api
type: reference
audience: [developer, agent]
owner: frontend-sdk
status: draft
visibility: internal
system: frontend-sdk
feature: typed-api
maturity: supported
applies_to: ["2.1.1 source; package qualification pending"]
modes: [browser, authenticated, auth-disabled, multipart]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Eden API Results And Multipart

[SDK index](./index.md) · [Documentation index](../../index.md)

client.api is the integrated Eden Treaty route facade. Its request fetcher is
owned by the same AuthClient as ordinary SDK requests: bearer injection,
restoration and refresh/retry stay centralized. With auth disabled it uses plain
fetch. Do not construct an extra manual bearer/refresh client for a typed route.

## Result And unwrap

Eden calls return a data/error result. unwrap is public from @zero/framework/react
and returns successful data or throws ApiError:

```ts
import { unwrap, ApiError } from '@zero/framework/react';

// Fragment: the app declares POST /api/echo with this request/response.
try {
  const result = unwrap(await client.api.api.echo.post({ message: 'Hello' }));
  // Consume the endpoint's successful result.
} catch (error) {
  if (error instanceof ApiError) {
    // status/code/body retain the structured HTTP result when available.
    // Present approved safe feedback; don't log arbitrary response contents.
  } else {
    throw error;
  }
}
```

The first api selects the SDK facade; the next api is the URL's /api segment.
Use the actual app endpoint path rather than inventing a platform route from
this example. Dynamic segments and request options follow the installed Eden
route contract.

ApiError has status (number/null), code (string/null) and body (unknown). unwrap
extracts a structured error/code from Eden's value/status result when present;
other error forms preserve their available status/body or use null metadata.
It does not validate an arbitrary success response against a runtime schema.

## Type Boundary

The Api type combines Treaty inference from the framework's App with dynamic
index-signature access. Dynamically composed app/plugin routes cannot all be
claimed statically inferred merely because client.api is public. Prefer the
specific service/resource facade where it already defines the request/result
contract, and qualify app-specific endpoint types/examples against the installed
package and actual application composition.

The internal createApi helper is not an ordinary root frontend export. Apps
normally use the configured client's api property rather than importing a private
factory path to bypass the integrated lifecycle.

## Multipart And Restoration

For an endpoint that accepts a file, Eden owns supported body serialization:

```ts
// Fragment: app-owned POST /api/documents/parse accepts multipart { file }.
const parsed = unwrap(await client.api.api.documents.parse.post({ file }));
```

file is the browser File selected by the app; the endpoint and permissions must
already exist. The integrated fetcher passes its request body/init to AuthClient
without replacing the multipart body with JSON or installing a second stale
Authorization header. Restoration and a 401 refresh/retry must preserve that
request contract. The package has focused authenticated multipart integration tests.

By contrast, client.post(path, FormData) uses the [JSON HTTP facade](./http.md)
and is not a multipart upload method. Choose the correct official interface;
do not persist intentionally transient files solely to avoid typed transport.
Durable retained files use the configured storage service separately.

## Authority, Failure And Verification

Eden serialization and a successful page session do not grant API access. The
endpoint still admits live request credentials, roles/resource permissions and
the current data plane. Keep private API secrets out of browser bundles.

Test valid/invalid endpoint requests, structured errors, restoration before a
multipart call, 401 credential replacement and body replay, and a scope switch
while a request is pending. A parser/file succeeding with manually attached
credentials does not qualify the official route path; the actual integrated
transport must be tested without an app workaround.

Working-source API tests and synthetic SDK checks inform this draft. Archive
qualification must verify the public imports, body/refresh behavior and applicable
provider/browser mode. This guide introduces no new custom endpoint typing API.

## Related Guides And Next Steps

- [HTTP](./http.md) distinguishes JSON and raw response shortcuts.
- [Client lifecycle](./client-lifecycle.md) owns AuthClient transport composition.
- [Resources](./resources.md) provides an existing typed CRUD facade.
- [Scope boundary](../runtime/authorization-scope-boundary.md) protects custom state.
