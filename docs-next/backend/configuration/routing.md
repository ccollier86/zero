---
id: zero.configuration.routing
type: how-to
audience: [developer, agent, operator]
owner: platform-configuration
status: draft
visibility: internal
system: platform-configuration
feature: routing
maturity: supported
applies_to: ["2.1.1 source; new documentation under review"]
modes: [managed-server]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Configure Authenticated Page Navigation

[Configuration index](./index.md) · [Documentation index](../../index.md)

Page auth configuration and API endpoint admission are related but
distinct. Use page policy for navigation and server endpoint/resource policy
for protected operations; hiding a page does not authorize its API.

## Page Modes And Public Paths

With Guardian enabled, `routeAuth` defaults to protected-by-default: page routes
require auth unless publicPaths matches. Explicit mode instead uses page/layout
auth declarations, with public pages unless those declarations protect them.

`publicPaths` uses exact and boundary-prefix matching. Omitted defaults include
resolved login/registration and password/email-verification lifecycle paths.
An explicit list is authoritative—it does not automatically merge all defaults
back in. Include every public lifecycle page the app actually needs.

## Login Destinations

| Setting | Default |
| --- | --- |
| `loginPath` | /login |
| `registrationPath` | /register |
| `postLoginPath` | / |

Configured paths normalize to safe local paths, including a leading slash when
needed. External/malformed targets reject. Explicit postLoginPath must not
resolve to loginPath, including equivalent trailing-slash pathname handling.

```ts
// AppConfig fragment for a dashboard application
auth: true,
loginPath: '/login',
postLoginPath: '/app',
```

A safe root-relative `redirect` return target takes precedence over the fallback.
Authenticated visits to login use that target or postLoginPath. External targets,
duplicate redirect values and login-loop targets do not become trusted navigation.

Refresh of a protected page should retain its current safe destination rather
than send an already authenticated user through an endless login/restoration
screen. Fully signed-out public login/bootstrap pages must remain reachable.

## Readiness Is Not Mere Token Presence

Account completion, MFA enrollment/challenge and tenant selection can require
a constrained flow even when identity is known. Do not redirect those incomplete
states straight into protected application data. Guardian owns their completion
and live session semantics.

Client-side checks/gates improve navigation, not security. Server page guards and
API policies must independently reject unauthenticated/unauthorized access.

## Verification

Check direct protected-page load/refresh, anonymous redirect, signed-out public
login/bootstrap, authenticated login visit, safe return query/hash and invalid
external/duplicate/loop redirects. Cover completion-required and tenant-selection
states separately from a fully authorized session.

## Related Guides And Next Steps

- [Guardian sessions](../guardian/sessions.md) owns page/access-token restoration and authority.
- [Endpoint admission](../runtime/endpoints.md) protects API calls independently.
- [Sitemap](./sitemap.md) includes only public discovered static pages.
- [Reference](./configuration.md#paths-and-pages) records exact app options.
