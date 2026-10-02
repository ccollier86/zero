# PDF Rendering

Zero provides server-side, browser-grade HTML-to-PDF rendering through
`@zero/framework/pdf` and the backend `zero.pdf` service. The default adapter
uses Playwright Chromium, so documents use the same CSS layout engine as a
modern browser and support:

- CSS Grid and Flexbox
- web fonts
- `@media print`
- `@page` size and margins
- backgrounds and colors
- page breaks and fragmentation rules
- accessible tagged PDF output
- Chromium header/footer templates

PDF is internal server infrastructure. Zero does not mount a public PDF API
route. App routes, Torrent workflows, jobs, or services decide who may generate a
document and what HTML reaches the renderer.

## Browser Installation

PDF is opt-in. Install the Chromium revision pinned by Zero before the first
render:

```sh
bun run pdf:install
```

The underlying command is:

```sh
zero pdf install
zero pdf status
```

Linux images that also need Chromium system packages can use:

```sh
zero pdf install --with-deps
```

The browser binary is separate from the npm package because it is large and
platform-specific. Install it while building a deploy image, not during an
HTTP request. A built server still needs production dependencies installed
because the renderer loads Playwright from `node_modules` at runtime.

Use a system-managed Chromium binary when required by deployment policy:

```env
ZERO_PDF_EXECUTABLE_PATH=/usr/bin/chromium
```

Or set `pdf.browser.executablePath` directly.

## Enable PDF

Enable secure defaults in `zero.config.ts`:

```ts
import { defineZeroConfig } from '@zero/framework/server';

export default defineZeroConfig({
  // db, tables, and other systems...
  pdf: true,
});
```

The browser starts lazily on the first render and is shared across requests.
Each render gets an isolated browser context. Zero closes the browser during
the Elysia app shutdown lifecycle.

Explicit configuration:

```ts
pdf: {
  defaults: {
    format: 'Letter',
    printBackground: true,
    preferCSSPageSize: true,
    tagged: true,
    margin: { top: '0.5in', right: '0.5in', bottom: '0.5in', left: '0.5in' },
  },
  limits: {
    maxHtmlBytes: 2 * 1024 * 1024,
    maxCssBytes: 512 * 1024,
    maxOutputBytes: 25 * 1024 * 1024,
    timeoutMs: 30_000,
    maxConcurrency: 2,
    maxQueue: 50,
  },
  resources: {
    remote: 'deny',
    deniedBehavior: 'error',
    allowDataUrls: true,
    allowBlobUrls: false,
    blockPrivateNetworks: true,
  },
  browser: {
    executablePath: Bun.env.ZERO_PDF_EXECUTABLE_PATH,
    javaScriptEnabled: false,
  },
},
```

`maxHtmlBytes` covers source HTML, document metadata, base URL, and Chromium
header/footer templates together. `maxCssBytes` applies separately to
supplemental CSS. The timeout budget includes queue wait, browser startup, page
load, font readiness, and PDF generation.

## Render In Backend Code

Zero-native endpoints receive the lazy service as `zero.pdf`:

```ts
import { t } from 'elysia';
import { defineEndpoint } from '@zero/framework/server';

export default defineEndpoint({
  method: 'POST',
  path: '/api/intakes/:id/pdf',
  auth: 'user',
  params: t.Object({ id: t.String() }),
  handler: async ({ params, zero }) => {
    if (!zero.pdf) {
      return Response.json({ error: 'PDF is disabled' }, { status: 503 });
    }

    const intake = zero.db.queryOne('intakes', params.id);
    if (!intake) return Response.json({ error: 'Not found' }, { status: 404 });

    const result = await zero.pdf.render({
      html: `<main><h1>Patient intake</h1><p>${escapeHtml(String(intake.name))}</p></main>`,
      css: `
        @page { size: Letter; margin: 0.6in; }
        body { font-family: system-ui, sans-serif; color: #111827; }
        @media print { h1 { break-after: avoid; } }
      `,
      document: { title: `Intake ${params.id}`, lang: 'en' },
    });

    return new Response(result.bytes, {
      headers: {
        'content-type': result.contentType,
        'content-disposition': `attachment; filename="intake-${params.id}.pdf"`,
      },
    });
  },
});
```

`escapeHtml()` in this example represents an app-owned escaping/template
boundary. Do not interpolate unsanitized user content into HTML.

Outside route setup, use the server-only package import:

```ts
import { requirePdfService } from '@zero/framework/pdf';

const result = await requirePdfService().render({
  html: '<article>...</article>',
  css: '@page { size: A4; }',
});
```

## Full Documents And Fragments

`html` may be a complete document or a fragment. Zero preserves complete
documents and inserts supplemental CSS/base/title metadata into the head. It
wraps fragments with a UTF-8 HTML document automatically.

```ts
await zero.pdf?.render({
  html: '<section class="consent">...</section>',
  css: `
    @page { size: Letter; margin: 0.5in; }
    .consent { display: grid; gap: 16px; }
  `,
  document: {
    title: 'Consent to treatment',
    lang: 'en-US',
  },
});
```

Per-render print options override configured defaults:

```ts
await zero.pdf?.render({
  html,
  options: {
    landscape: true,
    format: 'A4',
    pageRanges: '1-3, 5',
    displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate: '<div style="font-size:9px;width:100%;text-align:center"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
  },
});
```

When CSS declares `@page { size: ... }`, the default
`preferCSSPageSize: true` lets CSS control paper dimensions.

## Render Directly To Storage

When platform storage is mounted, `renderToStorage()` renders bytes and writes
them through the existing storage metadata, MIME detection, deduplication, and
permission boundary:

```ts
return zero.pdf?.renderToStorage(
  {
    html,
    css: printCss,
    document: { title: 'Signed consent' },
  },
  {
    driveId: 'patient-documents',
    path: `/intakes/${intakeId}/consent.pdf`,
    createdBy: user.userId,
    overwrite: true,
    public: false,
    metadata: {
      intakeId,
      documentType: 'consent',
    },
  }
);
```

Platform storage currently mounts with auth because its permission model needs
authenticated users. `render()` works without auth; `renderToStorage()` fails
with `PDF_STORAGE_UNAVAILABLE` when storage is not mounted. A custom
`PdfStorageWriter` can replace that boundary for another object store.

## Torrent Workflows And Jobs

PDF uses the same process-wide service in Torrent activities and scheduled
jobs. Register this activity inside `AppConfig.workflows.register(registry)`:

```ts
import { requirePdfService } from '@zero/framework/pdf';

registry.registerActivity({
  name: 'pdf.generate-consent',
  version: '1',
  handler: async (ctx) => {
    ctx.signal?.throwIfAborted();
    const input = ctx.input as { intakeId: string; driveId: string; html: string };
    const result = await requirePdfService().renderToStorage(
      { html: input.html, css: '@page { size: Letter; margin: 0.5in; }' },
      {
        driveId: input.driveId,
        path: `/intakes/${input.intakeId}/consent.pdf`,
        metadata: { intakeId: input.intakeId },
      }
    );

    return {
      objectId: result.file.id,
      path: result.file.path,
      size: result.size,
    };
  },
});
```

Return storage metadata from durable workflow steps, not raw `Uint8Array`
bytes. This keeps workflow state small and JSON-safe. A workflow may be
re-driven after a crash, so use a deterministic object path and an explicit
overwrite/deduplication policy when duplicate rendering would be unsafe.
See [Torrent: Durable Workflows](./workflows.md) for registration timing, cancellation,
deadlines, retries, and recovery semantics.

## Resource Security

Chromium can otherwise turn HTML into a server-side network/file access
surface. Zero therefore defaults to:

- remote HTTP(S) denied
- `file:` and unsupported protocols denied
- loopback/private-network hosts denied
- JavaScript disabled
- service workers blocked
- downloads disabled
- data URLs allowed for inline images/fonts
- blocked resources fail the render instead of silently producing an
  incomplete document

Chromium request interception enforces HTTP(S)/protocol rules. A renderer CSP
enforces `data:`/`blob:` switches and disables scripts, workers, forms, and
embedded objects before document resources load. Violation diagnostics retain
only a bounded count and sanitized resource identifiers.

For a trusted CDN or app origin, use an exact allowlist:

```ts
pdf: {
  resources: {
    remote: 'allowlist',
    allowedOrigins: [
      'https://assets.example.com',
      'https://fonts.example.com',
    ],
  },
},
```

For relative resources, set a base URL and use same-origin mode:

```ts
pdf: {
  resources: { remote: 'same-origin' },
},

await zero.pdf?.render({
  html: '<img src="/brand/logo.png" alt="">',
  baseUrl: 'https://app.example.com/',
});
```

`remote: 'allow'`, disabling private-network blocking, and enabling JavaScript
are deliberate high-risk choices reported by Platform Doctor. Never pass
request-controlled Playwright options or resource policy directly into this
service. Zero exposes a bounded typed option set instead of raw Playwright
configuration for that reason.

Private-network blocking rejects direct loopback, link-local, and private IP
targets plus common local hostnames. It is not a replacement for deployment
egress policy or a trusted exact-origin allowlist when rendering hostile HTML;
DNS can change after policy evaluation. Keep `remote: 'deny'` for documents
whose assets can be inlined.

## Errors And Observability

PDF failures use `PdfError` with stable codes such as:

- `PDF_CONFIG_INVALID`
- `PDF_DISABLED`
- `PDF_INPUT_INVALID`
- `PDF_LIMIT_EXCEEDED`
- `PDF_QUEUE_FULL`
- `PDF_QUEUE_TIMEOUT`
- `PDF_BROWSER_UNAVAILABLE`
- `PDF_RESOURCE_DENIED`
- `PDF_RENDER_TIMEOUT`
- `PDF_RENDER_FAILED`
- `PDF_OUTPUT_INVALID`
- `PDF_STORAGE_UNAVAILABLE`
- `PDF_STORAGE_FAILED`
- `PDF_SERVICE_CLOSED`

Rendering emits stable Zero observability codes:

- `PDF_CONFIGURED`
- `PDF_RENDER_STARTED`
- `PDF_RENDER_COMPLETED`
- `PDF_RENDER_FAILED`
- `PDF_STORED`
- `PDF_STORAGE_FAILED`
- `PDF_STOPPED`

Events contain renderer, byte counts, durations, and destination metadata.
They never contain source HTML, document text, secrets, or URL query strings.

Run Doctor after changing PDF configuration:

```sh
bun run doctor
zero pdf status
```

## Custom Renderer Adapter

The application API depends on `PdfRenderer`, not Playwright:

```ts
import type { PdfRenderer } from '@zero/framework/pdf';

const renderer: PdfRenderer = {
  name: 'remote-renderer',
  async render(input) {
    const bytes = await callTrustedRenderer(input.html, input.options);
    return { bytes, renderer: 'remote-renderer' };
  },
  async close() {},
};

export default defineZeroConfig({
  // ...
  pdf: { renderer },
});
```

This is the extension point for a remote service, a future WeasyPrint adapter,
or deployment-specific browser pool. The adapter receives already-normalized
requests and must return valid PDF bytes.

## Migration From The Old Python Service

The old FastAPI/WeasyPrint request shape maps directly:

```ts
// Before: POST /generate-pdf { html, css, options }
// Now:
const pdf = await zero.pdf?.render({ html, css, options });
```

The important differences are intentional:

- no internal network hop or separate Python deployment
- browser/WebView CSS fidelity through Chromium
- no hard-coded shared API key
- no unrestricted URL/file fetcher
- strict input/output/concurrency/time limits
- lifecycle cleanup and centralized observability
- direct storage composition
- replaceable renderer and storage adapters
