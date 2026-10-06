---
id: zero.frontend.observability
type: reference
audience: [developer, agent, operator]
owner: observability
status: draft
visibility: internal
system: observability
feature: browser-event-boundary
maturity: supported
applies_to: ["2.1.1 development source; not package-qualified"]
modes: [managed-server, standalone-server, frontend]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Frontend Observability

[Frontend index](./index.md) · [Documentation index](../index.md)

Import configureFrontendObservability/emitFrontendCode/emitFrontendEvent and
FRONTEND_OBS_CODES from @zero/framework/react. Browser observability reports
operational UI failures, not authenticated server audit records.

## Configuration And Sinks

FrontendObservabilityConfig accepts optional sink, endpoint, console and http.
Defaults are console:true/http:true with endpoint
/api/_zero/observability/events. A custom sink **replaces** the default browser
composite, unlike additive backend config.sink.

ConsoleFrontendSink formats safe supplied events. HttpFrontendSink sends a
same-origin credentialed keepalive JSON POST; it does not use a second access
token store or provide an accepted receipt/retry queue.
CompositeFrontendSink fans out and isolates adapter failures.

```ts
import { configureFrontendObservability, emitFrontendCode, FRONTEND_OBS_CODES } from '@zero/framework/react';

configureFrontendObservability({ console: false, http: false });
emitFrontendCode(FRONTEND_OBS_CODES.FRONTEND_RENDER_ERROR, {
  message: 'Example widget could not render',
  metadata: { component: 'example-widget' },
});
```

This synthetic example disables actual export; production apps choose their
reviewed sink/endpoint policy. getFrontendObservabilitySink lazily creates
defaults when not configured.

## Safe Payload And Lifecycle

Frontend events include level/category/code/message with optional prefix/
metadata/error/requestId/traceId. Generic metadata redaction is shallow and
credential-key based. Error instances serialize name/message/stack, so do not
embed secrets/PII in them. There is no universal nested-content sanitization.

emitFrontendEvent is void/best-effort and observes async failures internally.
It does not confirm server storage. SSR/browser capabilities are guarded at
the transport boundary; don't send operational reports from every render.

ErrorBoundary, hydration and auth/storage/resource actions use this boundary.
A browser-submitted code is not trusted proof that its named action happened.
The backend byte-limited ingest owns validation; readable events require a
different access policy.

## Cascader Content-Free Failure Events

The [Cascader](./components/cascader.md) working-source addition on top of Zero
2.2.1 introduces two error-level frontend observations. This is supplemental
source evidence, not a claim that those codes shipped in the page's original
2.1.1 baseline or the previously published 2.2.1 archive.

| Symbol / event code | Safe fields |
| --- | --- |
| `FRONTEND_CASCADER_LOAD_FAILED` / `frontend.cascader.load_failed` | Bounded `operation: 'children' | 'search'` and the safe `errorCode: 'CASCADER_LOAD_FAILED'`. |
| `FRONTEND_CASCADER_CALLBACK_FAILED` / `frontend.cascader.callback_failed` | Bounded `operation` (`selection`, `open`, `footer`), or `stage: 'load-error-callback'` with its loader operation. |

The emitted message is static. These calls omit raw exceptions, query text,
nodes, complete paths, selected values and application payloads. The public
loader error contains only its safe code, operation and message. A cancelled or
retired request cannot update a new scope's picker. Frontend observation is
still best-effort reporting, not a Guardian audit, permission grant or accepted
mutation receipt.

## Signature Pad Content-Free Failure Events

The [Signature Pad family](./components/signature-pad.md) is another authorized
unreleased source addition on top of Zero 2.2.1, not part of the page's original
2.1.1 baseline or the saved 2.2.1 archive.

| Symbol / event code | Safe fields |
| --- | --- |
| `FRONTEND_SIGNATURE_PAD_SAVE_FAILED` / `frontend.signature_pad.save_failed` | Bounded `operation`, such as `save` or `agreement-sign`. |
| `FRONTEND_SIGNATURE_PAD_CALLBACK_FAILED` / `frontend.signature_pad.callback_failed` | Bounded local action/notification operation, without the callback exception. |

Static messages and bounded metadata omit strokes, SVG, signer names, private
exceptions and agreement content. Save/sign feedback follows the submitted
draft; local change/stroke notifications follow the document/scope lifetime,
so accepted-edit notification failures remain observable until that scope is
retired. No completion updates or reports into a different UI lifetime.
These events do not establish a
legally verified signer, server persistence, a trusted date or an audit receipt.
Those remain application-owned signing/authorization boundaries.

## Verification And Related Guides

Use a synthetic custom sink to verify one safe event and failure containment,
then test your actual read/ingest permissions separately. Keep old identity/
tenant data out of logs during scope retirement.

- [Backend observability](../backend/observability/index.md) owns runtime/store/read policy.
- [Events/privacy](../backend/observability/events.md) explains generic redaction limits.
- [Runtime errors](./runtime/error-boundaries.md) owns rendering fallback/error boundaries.
