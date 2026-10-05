---
id: zero.runtime.endpoints
type: how-to
audience: [developer, agent]
owner: platform-runtime
status: draft
visibility: internal
system: platform-runtime
feature: endpoints
maturity: supported
applies_to: ["2.1.1 source; new documentation under review"]
modes: [managed-server, standalone-extension]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Declare An HTTP Endpoint

[Runtime index](./index.md) · [Documentation index](../../index.md)

`defineEndpoint` declares a validated Zero-native request boundary. It returns a
definition; [discovery/composition](./discovery.md) mounts it in Elysia. Put domain
work in services, not a handler that mixes token verification, SQL and rendering.

```ts
// server/endpoints/echo.ts
import { t } from 'elysia';
import { defineEndpoint } from '@zero/framework/server';

export default defineEndpoint({
  name: 'example.echo',
  method: 'POST',
  path: '/api/example/echo',
  auth: 'user',
  body: t.Object({ message: t.String({ minLength:1, maxLength:200 }) }),
  handler({ body, user }) {
    return { message: body.message, userId: user.userId };
  },
});
```

This module assumes Guardian is configured in its containing app. A signed-in
session can reach it; an anonymous request is rejected before the domain handler.
The example returns synthetic user-controlled text, not a generic authorization
rule for reading another user's records.

## Options And Context

Required options are `method`, `path` and `handler`. Supported methods are
GET/POST/PUT/PATCH/DELETE/OPTIONS/HEAD, including lowercase inputs normalized
to uppercase. Paths start with `/` and are relative to an enclosing router's
prefix. `name` is optional but useful for stable diagnostics.

Transport schemas may cover body, query, params, headers, cookie and response;
`detail` supplies Elysia/OpenAPI-style route metadata. The inferred handler
inputs derive from schemas carrying Elysia's static type; don't cast an
unknown input into a trusted domain record.

The handler context includes request, body/query/params/headers, user/auth,
authContext, access, requireAuth/requireAdmin and request-local zero services.
Required-user policies narrow user; optional/anonymous contexts can have no user.
`access` owns authorization decisions; a user ID alone is not a permission.

## Access And Lifecycle Ordering

Omitted endpoint auth inherits its router's policy or the root optional policy.
Simple policies include user/admin/optional/false; advanced requirements use
Guardian's shared permission/scope/credential declarations. Do not assume a
user policy automatically permits API-key credentials or platform actions.

The compiler prepends admission to endpoint beforeHandle hooks. Protected
multipart routes also receive an early request guard so an invalid credential
does not first consume a large file body. Application parse/transform hooks
still own their safe input handling.

Optional lifecycle hooks are parse, transform, beforeHandle, afterHandle,
mapResponse and error; each accepts a hook or hook array and may be async.
Returning an early response must be deliberate. A lifecycle hook is not a place
to hide a second token cache or privileged global data selector.

## Errors

Zero-native extension mapping returns safe envelopes:

| Failure | HTTP | Stable code |
| --- | ---: | --- |
| invalid request schema |422| ZERO_REQUEST_VALIDATION_FAILED |
| request parse failure |400| ZERO_REQUEST_PARSE_FAILED |
| invalid server response schema |500| ZERO_RESPONSE_VALIDATION_FAILED |
| Guardian denial/state failure |domain status| the safe AuthError code |

Rejected request bodies, schemas and parser details are not reflected by that
mapping. Arbitrary custom service errors still need the appropriate domain
boundary; do not return raw provider responses or stack traces.

## Verification

Use `app.handle` in an isolated composed extension fixture to test valid input,
schema rejection, anonymous denial and the relevant permission/credential modes.
For file input, also test failed admission before body consumption. A typecheck
only proves the compile-time signature, not that a caller is authorized.

## Related Guides And Next Steps

- [Routers](./routers.md) groups endpoints without weakening inherited access.
- [Middleware](./middleware.md) adds matching cross-cutting behavior.
- [Service boundaries](../../concepts/service-boundaries.md) selects safe data
  capabilities after request admission.
- [Configuration](./configuration.md#endpoint-options) is the exact option list.
