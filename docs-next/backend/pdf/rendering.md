---
id: zero.pdf.rendering
type: reference
audience: [developer, agent, operator]
owner: pdf
status: draft
visibility: internal
system: pdf
feature: document-and-print-contract
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

# Rendering HTML And CSS

[PDF index](./index.md) · [Documentation index](../../index.md)

render(input) accepts nonempty html, optional css/baseUrl/document metadata,
print options and a lower per-request timeout. It returns accepted
{bytes:Uint8Array,contentType:'application/pdf',size,renderer}.
In-memory rendering does not automatically retain a Storage object.

## Composition

composePdfDocument wraps fragments as complete HTML, or preserves full supplied
documents while inserting base/title/style and missing language metadata.
Metadata title/lang is escaped; default fragment lang is en.
Supplemental CSS cannot contain a closing style tag. Body HTML is supplied
by the application; the helper is not a generic HTML sanitizer.

baseUrl must be HTTP(S) without embedded credentials. It resolves relative
resources; actual loading still follows [security](./security.md). Do not use
an untrusted request Host to choose an internal server origin.

Standalone network-free renderer example:

```ts
import { PdfService, resolvePdfConfig, type PdfRenderer } from '@zero/framework/pdf';

const renderer: PdfRenderer = {
  name: 'synthetic',
  async render() {
    return { bytes: new TextEncoder().encode('%PDF-1.7\n%%EOF'), renderer: 'synthetic' };
  },
  async close() {},
};
const config = resolvePdfConfig({ renderer }, {});
if (!config) throw new Error('Expected synthetic PDF configuration');
const service = new PdfService(config);
try {
  const result = await service.render({ html: '<h1>Example</h1>' });
  if (result.contentType !== 'application/pdf') throw new Error('Unexpected content type');
} finally {
  await service.close();
}
```

This tests API composition/output signature only, not a real readable Chromium
document. Production rendering uses the configured browser or a reviewed adapter.

## Print Options

Configured defaults are Letter, printBackground:true, preferCSSPageSize:true
and tagged:true. Scale is left unset by Zero unless supplied; do not claim the
resolved config inserts scale1. Optional landscape/outline/header-footer
behavior follows the renderer.

Options include format, custom width/height, scale0.1–2, pageRanges, margin,
displayHeaderFooter/headerTemplate/footerTemplate, tagged/outline.
Width and height must appear together; merged custom dimensions remove inherited
format, and a requested format removes inherited custom dimensions.
Margins merge field by field. CSS @page sizing can override dimensions when
preferCSSPageSize is enabled.

HTML/base/document/header/footer content shares the maxHtmlBytes bound;
supplemental CSS has its own bound. Output is bounded and must begin %PDF-.
Signature admission is not deep PDF conformance/accessibility certification.

- [Configuration](./configuration.md) owns exact byte/print defaults.
- [Security](./security.md) owns resource/script admission.
- [Storage](./storage.md) owns optional persistence.
