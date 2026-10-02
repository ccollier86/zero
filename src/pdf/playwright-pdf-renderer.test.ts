/**
 * playwright-pdf-renderer.test.ts
 *
 * Runs one real Chromium render to prove browser CSS, print media, CSS page
 * sizing, and in-memory PDF output work together.
 */

import { expect, test } from 'bun:test';

import { resolvePdfConfig } from './pdf-config';
import { PdfService } from './pdf-service';

// A real browser launch is normally a few seconds, but this integration test
// runs alongside the rest of the suite and can be CPU-starved on CI hosts.
// Keep a bounded timeout without making the full suite flaky under contention.
test('Chromium renders print CSS and CSS page sizing', async () => {
  const config = resolvePdfConfig({
    browser: { launchTimeoutMs: 60_000 },
    resources: { allowDataUrls: false },
    // The production default remains 30 seconds. This real-browser integration
    // gate runs beside CPU-heavy package and database tests, so give Chromium a
    // test-only budget that still fails in bounded time under CI contention.
    limits: { timeoutMs: 90_000 },
  }, {});
  if (config === false) throw new Error('Expected PDF config.');
  const service = new PdfService(config);

  try {
    const result = await service.render({
      html: `
        <main class="sheet">
          <h1>Zero PDF integration</h1>
          <div class="grid"><span>Patient</span><span>Consent</span></div>
        </main>
      `,
      css: `
        @page { size: A5; margin: 12mm; }
        body { margin: 0; font-family: system-ui, sans-serif; }
        .sheet { color: #111827; background: #eef4ff; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        @media print { h1 { color: #155eef; } }
      `,
      document: { title: 'Zero PDF Test' },
    });

    expect(new TextDecoder().decode(result.bytes.slice(0, 8)).startsWith('%PDF-')).toBe(true);
    expect(result.size).toBeGreaterThan(2_000);
    expect(result.renderer).toBe('chromium');

    await expect(service.render({
      html: '<img alt="blocked" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==">',
    })).rejects.toMatchObject({ code: 'PDF_RESOURCE_DENIED' });
  } finally {
    await service.close();
  }
}, 120_000);
