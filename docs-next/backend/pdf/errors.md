---
id: zero.pdf.errors
type: reference
audience: [developer, agent, operator]
owner: pdf
status: draft
visibility: internal
system: pdf
feature: errors-and-observability
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

# PDF Errors And Safe Events

[PDF index](./index.md) · [Documentation index](../../index.md)

PdfError exposes code and operational details, optionally retaining an internal
cause. It does not assign a universal HTTP status; your validated app endpoint
maps the result safely.

Codes: PDF_CONFIG_INVALID, PDF_DISABLED, PDF_INPUT_INVALID,
PDF_LIMIT_EXCEEDED, PDF_QUEUE_FULL, PDF_QUEUE_TIMEOUT,
PDF_BROWSER_UNAVAILABLE, PDF_RESOURCE_DENIED, PDF_RENDER_TIMEOUT,
PDF_RENDER_FAILED, PDF_OUTPUT_INVALID, PDF_STORAGE_UNAVAILABLE,
PDF_STORAGE_FAILED, PDF_SERVICE_CLOSED.

Unexpected render/storage adapter failures normalize to generic PDF render/
storage failures rather than reflect private vendor text. Raw cause/details
must not be serialized wholesale to browsers or external sinks.

## Operational Events

PDF_CONFIGURED/STOPPED, PDF_RENDER_STARTED/COMPLETED/FAILED and
PDF_STORED/STORAGE_FAILED use stable Zero codes. Managed-created service/plugin
now use their captured app-local emitter; later ambient configuration cannot
redirect them. Standalone calls may supply PdfServiceOptions.emitCode.

Fields include renderer/count/size/timing and selected storage target identifiers.
Source HTML, document body, credentials and rendered bytes do not belong in
metadata. A path can itself contain sensitive identifiers; choose safe targets
and reviewed sinks.

## Verification And Related Guides

The corrected synthetic six-file service/plugin/resource/scoped-writer suite
passed 22 tests / 63 assertions. It proves targeted orchestration/policy/ownership
regressions, not a real Chromium security/performance certification or released
package qualification.

- [Security](./security.md) owns URL diagnostic shaping.
- [Storage](./storage.md) owns accepted-write semantics.
- [Observability](../observability/index.md) owns app-local export/privacy.
