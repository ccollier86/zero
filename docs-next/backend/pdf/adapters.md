---
id: zero.pdf.adapters
type: reference
audience: [developer, agent, operator]
owner: pdf
status: draft
visibility: internal
system: pdf
feature: renderer-and-writer-seams
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

# PDF Renderer And Storage Adapters

[PDF index](./index.md) · [Documentation index](../../index.md)

PdfRenderer requires name, async render(PreparedPdfRenderInput) and close(),
with optional status(). It returns {bytes:Uint8Array,renderer}.
The service passes composed bounded HTML/base/options/resource policy,
remaining timeout and waitForFonts. A custom adapter owns actual rendering,
security/time-budget behavior and resource cleanup; it is not magically
Chromium merely because its config accepted the interface.

PdfStorageWriter requires write(PdfStorageWriteInput):Promise<FileInfo>.
Input adds rendered bytes/renderer to the target. It owns destination
acceptance/authority/durability. ZeroPdfStorageWriter is the built-in Storage
adapter; [storage](./storage.md) owns the scoped integration.

PdfServiceOptions permits renderer/storage/emitCode. Renderer override wins
over config.renderer, then default Chromium. Explicit storage overrides the
built-in writer. The emitter can bind standalone operational events to an
owned runtime; managed-created service receives its owning app automatically.

A supplied prebuilt PdfService remains caller-owned: plugin composition does
not rewrite its private adapter/emitter policy. Inject correct dependencies
before handing it to the plugin. Raw adapter selection is never allowed from
an ordinary untrusted render request.

## Verification And Related Guides

Use small synthetic adapters for orchestration tests, including failure,
blocked/slow output, bad signature, size and close. A fake %PDF- prefix proves
only admission, not document fidelity. Qualify real browser adapters separately.

- [Rendering](./rendering.md) includes a network-free adapter example.
- [Lifecycle](./lifecycle.md) owns service queue/close contract.
- [Security](./security.md) owns default-renderer protections.
