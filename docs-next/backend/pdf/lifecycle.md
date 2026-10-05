---
id: zero.pdf.lifecycle
type: operations
audience: [developer, agent, operator]
owner: pdf
status: draft
visibility: internal
system: pdf
feature: queue-timeout-and-shutdown
maturity: supported
applies_to: ["2.1.1 development source; not package-qualified"]
modes: [managed-server, standalone-server, scoped-storage]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Render Queue, Deadlines And Shutdown

[PDF index](./index.md) · [Documentation index](../../index.md)

Default maximum concurrency2 and queued waiters50 limit shared browser
pressure. With maxQueue0, a saturated renderer rejects rather than waiting.
An exhausted queue fails PDF_QUEUE_FULL. Queued work waits within the total
request budget and fails PDF_QUEUE_TIMEOUT at its deadline.

The remaining budget is passed to the renderer after slot acquisition.
Default Chromium enforces it and closes its context on timeout; custom
renderers must honor the explicit timeout/close contract. No caller AbortSignal
field exists in PdfRenderInput; don't document invented cancellation props.

## Service Close

close is idempotent, marks service closed, rejects queued/new work and awaits
renderer resource release. Renderer close owns handling its active process/
contexts. Future render calls fail PDF_SERVICE_CLOSED.

The named plugin captures cleanup in one promise and registers it with managed
runtime drain before publishing the service to an application callback. A
publication failure starts that same cleanup and throws PDF_CONFIG_INVALID;
runtime disposal can still await it rather than abandon the renderer. It clears
the exact service/compatibility registration only after
renderer cleanup. Managed app stop awaits runtime cleanup rather than trusting
a fire-and-forget Elysia onStop hook. Normal request facades cannot close the
shared service.

## Verification And Related Guides

Test one held renderer slot, queue full, waiter timeout, new request after close,
failed publication and a held renderer close proving runtime disposal waits. Use synthetic
barriers; actual browser fidelity/install is a separate gate.

- [Browser runtime](./browser-runtime.md) owns process launch/context cleanup.
- [Configuration](./configuration.md) owns limits.
- [Runtime shutdown](../runtime/shutdown.md) owns ordered app drain.
