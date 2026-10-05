---
id: zero.frontend.runtime.error-boundaries
type: reference
audience: [developer, agent]
owner: frontend-runtime
status: draft
visibility: internal
system: frontend-runtime
feature: error-boundaries
maturity: supported
applies_to: ["2.1.1 source; packaged production build qualification pending"]
modes: [browser, SSR]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Render Errors And Not Found

[Runtime index](./index.md) · [Documentation index](../../index.md)

ErrorBoundary catches React render/lifecycle errors in its descendant browser
tree. AppProvider and generated hydration already compose it. It is not a catch
for every asynchronous action, API rejection or server loader failure; those
operations use their own standard server/SDK/component boundaries.

## Public Components

ErrorBoundary and NotFoundPage are public from @zero/framework/react. ErrorBoundary
accepts children, an optional fallback receiving `{ error, reset }`, and optional
onError receiving the Error and React ErrorInfo. Its props interface is source-local
to the module, not a named root type to assume exists.

```tsx
import { ErrorBoundary } from '@zero/framework/react';

<ErrorBoundary fallback={({ reset }) => (
  <section role="alert">
    <p>This section could not be displayed.</p>
    <button onClick={reset}>Try again</button>
  </section>
)}>
  {children}
</ErrorBoundary>;
```

reset clears the caught error and attempts rendering descendants again. A retry
is not a new server transaction, permission change or automatic repair of a
still-invalid child. A nested boundary can isolate a section while the root
remains the broad application fallback.

## Default Presentation And Observability

The default error page offers retry and page reload. Development presentation
includes error name/message and a formatted stack. Production presentation is a
generic user-safe message. That distinction depends on NODE_ENV in the actual
browser build; qualify the production bundle rather than relying on a development
source test or an assumed global process value.

componentDidCatch invokes onError and emits the standard frontend render-error
code. A custom fallback receives the original error and must avoid disclosing
its message/stack or private data blindly. A custom callback should cooperate
with [standard observability](../../backend/runtime/observability.md) instead of
shipping raw sensitive records to another sink.

Server-renderer error HTML is its separate internal presentation path; a React
boundary does not make SSR exceptions behave like browser render errors.

## NotFoundPage

NotFoundPage displays the default 404 UI with home/back controls. Home updates
browser history to / and dispatches the router's normal URL-change event; back
uses browser history. It is presentation, not an HTTP route status generator or
a substitute for the server's route matching/not-found response.

Apps can define their route-specific not-found experience through the normal
file router. Do not import private server HTML helpers into browser components.

## Verification And Troubleshooting

Render a synthetic throwing child and verify a custom safe fallback/reset works.
Inspect the actual production bundle/default page before claiming error details
are unavailable in a deployed build. Separately test rejected async actions and
server loader errors through their own handlers; a root ErrorBoundary should not
be expected to turn every rejected promise into a UI message.

These components need no database, credentials or tenancy configuration. Their
operation must not hide or weaken the [scope guard](./scope-transitions.md).
Changing a fallback is an app UI choice, not a new error ingestion service.

## Related Guides And Next Steps

- [AppProvider](./app-provider.md) owns normal root composition.
- [Hydration](./hydration.md) handles startup/module failures.
- [Configuration](./configuration.md#other-runtime-settings) lists error props.
- [Runtime observability](../../backend/runtime/observability.md) owns standard events/sinks.
