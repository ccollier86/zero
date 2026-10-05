/** Verifies PDF Elysia decoration, singleton visibility, and shutdown cleanup. */

import { Elysia } from 'elysia';
import { describe, expect, test } from 'bun:test';

import { resolvePdfConfig } from './pdf-config';
import { createPdfPlugin, getPdfService } from './pdf.plugin';
import { PdfService } from './pdf-service';
import type { PdfRenderer, PreparedPdfRenderInput } from './pdf-types';
import { ZERO_OBSERVABILITY_RUNTIME, ZERO_PDF_SERVICE } from '../runtime/service-keys';
import { ZeroAppRuntime } from '../runtime/zero-app-runtime';
import { MemoryEventStore } from '../observability';

describe('createPdfPlugin', () => {
  test('decorates handlers and closes the renderer on app stop', async () => {
    const renderer: PdfRenderer & { closed: boolean } = {
      name: 'test',
      closed: false,
      async render(_input: PreparedPdfRenderInput) {
        return {
          bytes: new TextEncoder().encode('%PDF-1.7\n%%EOF'),
          renderer: 'test',
        };
      },
      async close() {
        this.closed = true;
      },
    };
    const config = resolvePdfConfig({ renderer }, {});
    if (config === false) throw new Error('Expected PDF config.');
    const service = new PdfService(config, { renderer });
    const app = new Elysia()
      .use(createPdfPlugin({ config, service }))
      .get('/pdf-status', ({ pdf }) => pdf.status())
      .listen(0);

    try {
      const response = await fetch(`http://localhost:${app.server?.port}/pdf-status`);
      expect(response.status).toBe(200);
      expect((await response.json() as { renderer: string }).renderer).toBe('test');
      expect(getPdfService()).toBe(service);
    } finally {
      await app.stop();
    }

    expect(renderer.closed).toBe(true);
    expect(getPdfService()).toBeNull();
  });

  test('joins renderer shutdown at the managed runtime boundary', async () => {
    let releaseClose!: () => void;
    let closeEntered!: () => void;
    const release = new Promise<void>((resolve) => { releaseClose = resolve; });
    const entered = new Promise<void>((resolve) => { closeEntered = resolve; });
    const renderer: PdfRenderer = {
      name: 'managed-test',
      async render(_input: PreparedPdfRenderInput) {
        return {
          bytes: new TextEncoder().encode('%PDF-1.7\n%%EOF'),
          renderer: 'managed-test',
        };
      },
      async close() {
        closeEntered();
        await release;
      },
    };
    const config = resolvePdfConfig({ renderer }, {});
    if (config === false) throw new Error('Expected PDF config.');
    const service = new PdfService(config, { renderer });
    const runtime = new ZeroAppRuntime('pdf-stop-barrier');
    const events = new MemoryEventStore();
    runtime.set(ZERO_OBSERVABILITY_RUNTIME, { sink: events, store: events, config: { console: false } });
    createPdfPlugin({ config, service, runtime });

    const disposing = runtime.dispose();
    await entered;
    expect(runtime.get(ZERO_PDF_SERVICE)).toBe(service);

    releaseClose();
    await disposing;

    expect(runtime.get(ZERO_PDF_SERVICE)).toBeNull();
    expect(getPdfService()).toBeNull();
  });
});
