/** Verifies owned PDF lifecycle/render telemetry with synthetic renderer services only. */
import { afterEach, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { configureObservability, MemoryEventStore, OBS_CODES } from '../observability';
import { ZERO_OBSERVABILITY_RUNTIME, ZERO_PDF_SERVICE, ZERO_STORAGE_SERVICE } from '../runtime/service-keys';
import { ZeroAppRuntime } from '../runtime/zero-app-runtime';
import type { StorageService } from '../storage/storage-service';
import { resolvePdfConfig } from './pdf-config';
import { createPdfPlugin } from './pdf.plugin';

const running: Array<{ app: { stop: (closeActiveConnections?: boolean) => Promise<unknown> }, runtime: ZeroAppRuntime }> = [];
afterEach(async () => {
  for (const instance of running.splice(0).reverse()) {
    await instance.app.stop();
    await instance.runtime.dispose();
  }
});

test('managed PDF operations emit only to the owning app, not later ambient configuration', async () => {
  const first = startPdfApp('synthetic-pdf-first');
  const second = startPdfApp('synthetic-pdf-second');
  const ambient = configureObservability({ console: false });
  await first.runtime.require(ZERO_PDF_SERVICE).render({ html: '<p>synthetic</p>' });
  expect(first.events.query({ code: OBS_CODES.PDF_RENDER_COMPLETED.code }).count).toBe(1);
  expect(second.events.query({ code: OBS_CODES.PDF_RENDER_COMPLETED.code }).count).toBe(0);
  expect(ambient.store!.query({ code: OBS_CODES.PDF_RENDER_COMPLETED.code }).count).toBe(0);
  expect(first.events.query({ code: OBS_CODES.PDF_CONFIGURED.code }).count).toBe(1);
  expect(second.events.query({ code: OBS_CODES.PDF_CONFIGURED.code }).count).toBe(1);
});

test('managed PDF default storage writer resolves only its owning app storage', async () => {
  const first = startPdfApp('synthetic-pdf-storage-first');
  startPdfApp('synthetic-pdf-storage-second');
  const result = await first.runtime.require(ZERO_PDF_SERVICE).renderToStorage(
    { html: '<p>synthetic</p>' }, { driveId: 'synthetic-drive', path: '/result.pdf' },
  );
  expect(result.file.id).toBe('synthetic-pdf-storage-first');
});

test('failed service publication retains an awaited cleanup boundary and unregisters the service', async () => {
  const runtime = new ZeroAppRuntime('synthetic-pdf-publication-failed');
  const events = new MemoryEventStore();
  runtime.set(ZERO_OBSERVABILITY_RUNTIME, { sink: events, store: events, config: { console: false } });
  let closed = false;
  const config = resolvePdfConfig({ renderer: {
    name: 'synthetic-failed',
    async render() { return { bytes: new TextEncoder().encode('%PDF-1.7\n%%EOF'), renderer: 'synthetic-failed' }; },
    async close() { closed = true; },
  } }, {});
  if (!config) throw new Error('Expected synthetic PDF config');
  expect(() => createPdfPlugin({ config, runtime, onServiceCreated() { throw new Error('synthetic setup failure'); } })).toThrow();
  await runtime.dispose();
  expect(closed).toBe(true);
  expect(runtime.get(ZERO_PDF_SERVICE)).toBeNull();
});

function startPdfApp(id: string) {
  const runtime = new ZeroAppRuntime(id);
  const events = new MemoryEventStore({ maxEvents: 20 });
  runtime.set(ZERO_OBSERVABILITY_RUNTIME, { sink: events, store: events, config: { console: false } });
  // Narrow synthetic storage test double; no filesystem/metadata database is opened.
  runtime.set(ZERO_STORAGE_SERVICE, { objects: { async upload() {
    return {
      id, driveId: 'synthetic-drive', path: '/result.pdf', name: 'result.pdf', type: 'file',
      mimeType: 'application/pdf', sizeBytes: 16, checksum: 'synthetic', isPublic: false,
      metadata: {}, createdBy: null, createdAt: 1, updatedAt: 1,
    };
  } } } as unknown as StorageService);
  const config = resolvePdfConfig({ renderer: {
    name: 'synthetic',
    async render() { return { bytes: new TextEncoder().encode('%PDF-1.7\n%%EOF'), renderer: 'synthetic' }; },
    async close() {},
  } }, {});
  if (!config) throw new Error('Expected synthetic PDF config');
  const app = new Elysia({ name: id }).use(createPdfPlugin({ config, runtime }));
  app.listen(0);
  running.push({ app, runtime });
  return { app, runtime, events };
}
