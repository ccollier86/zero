import { describe, expect, test } from 'bun:test';
import { rename, unlink } from 'node:fs/promises';
import { docsRuntimeFixture } from './test-fixture';
import { compileDocsSnapshot, docsContentRoot } from './build';
import { createDocsSnapshotRuntime } from './watch';
import { createDocsRequestHandler } from './handler';
import type { DocsSnapshot } from './types';

// macOS filesystem delivery shares the drive with other build workers; this bounds notification
// observation without changing the production debounce or weakening any admission/drain assertion.
async function eventually(condition: () => boolean, maximum = 8_000): Promise<void> {
  const start = performance.now(); while (!condition()) { if (performance.now() - start > maximum) throw new Error('Snapshot condition did not settle.'); await Bun.sleep(10); }
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(accept => { resolve = accept; }); return { promise, resolve }; }

describe('documentation development snapshot lifecycle', () => {
  test('edit, rename, delete and ignore changes replace the complete snapshot and retire attachment routes', async () => {
    const fixture = await docsRuntimeFixture({ 'index.md': '# Home', 'guide.md': '# Guide\n\n[Download](report.pdf)', 'report.pdf': '%PDF-1.7\nRETIRED_ASSET' });
    const context = fixture.context();
    const runtime = await createDocsSnapshotRuntime({ initial: fixture.snapshot, watchRoot: docsContentRoot(fixture.root, fixture.options),
      compile: () => compileDocsSnapshot(fixture.root, fixture.options, 'development', context.emitCode) });
    try {
      const handler = createDocsRequestHandler(runtime, fixture.options, context), oldAsset = fixture.snapshot.data.manifest.assets[0]!.route;
      await Bun.write(fixture.root + '/documentation/guide.md', '# Guide\n\nChanged content.\n\n[Download](report.pdf)');
      await eventually(() => runtime.current()?.data.manifest.pages.some(page => page.text.includes('Changed content')) === true);
      expect(JSON.stringify((await handler(new Request('http://localhost/docs/_api/search?q=Changed'))))).not.toContain('PRIVATE');
      await rename(fixture.root + '/documentation/guide.md', fixture.root + '/documentation/renamed.md');
      await eventually(() => runtime.current()?.data.manifest.pages.some(page => page.route === '/docs/renamed') === true);
      expect((await handler(new Request('http://localhost/docs/guide'))).status).toBe(404);
      await Bun.write(fixture.root + '/documentation/.docsignore', '/renamed.md\n');
      await eventually(() => runtime.current() !== null && !runtime.current()!.data.manifest.pages.some(page => page.route === '/docs/renamed'));
      expect((await handler(new Request('http://localhost' + oldAsset))).status).toBe(404);
      const projections = await Promise.all(['/docs/_api/manifest', '/docs/_api/search?q=Changed', '/docs/llms.txt', '/docs/_api/markdown?path=/docs/renamed'].map(async route => (await handler(new Request('http://localhost' + route))).text()));
      expect(projections.join('\n')).not.toContain('Changed content'); expect(projections.join('\n')).not.toContain('RETIRED_ASSET');
      await unlink(fixture.root + '/documentation/.docsignore'); await unlink(fixture.root + '/documentation/renamed.md');
      await eventually(() => runtime.current() !== null && runtime.current()!.data.manifest.pages.length === 1);
      await runtime.dispose(); const generation = runtime.generation(); await Bun.write(fixture.root + '/documentation/index.md', '# Changed after disposal'); await Bun.sleep(120);
      expect(runtime.current()).toBeNull(); expect(runtime.generation()).toBe(generation); expect((await handler(new Request('http://localhost/docs'))).status).toBe(503);
    } finally { await runtime.dispose(); await fixture.close(); }
  }, 15_000);

  test('overlapping rebuilds cannot publish a stale snapshot, failures stay closed, and later edits recover', async () => {
    const fixture = await docsRuntimeFixture({ 'index.md': '# Home', 'guide.md': '# PUBLIC_BEFORE_CHANGE' });
    const context = fixture.context(), barrier = deferred<DocsSnapshot>(); let calls = 0;
    const runtime = await createDocsSnapshotRuntime({ initial: fixture.snapshot, watchRoot: docsContentRoot(fixture.root, fixture.options), compile: async () => {
      calls++; if (calls === 2) return barrier.promise;
      return compileDocsSnapshot(fixture.root, fixture.options, 'development', context.emitCode);
    } });
    try {
      const handler = createDocsRequestHandler(runtime, fixture.options, context);
      await Bun.write(fixture.root + '/documentation/guide.md', '# Revised public'); await eventually(() => calls === 2);
      expect(runtime.current()).toBeNull(); expect((await handler(new Request('http://localhost/docs/_api/search?q=PUBLIC'))).status).toBe(503);
      await Bun.write(fixture.root + '/documentation/guide.md', '---\nvisibility: private\n---\n# NEVER_PUBLISH_NEW'); await eventually(() => runtime.generation() >= 3); await Bun.sleep(100);
      barrier.resolve(fixture.snapshot); await eventually(() => calls >= 3 && runtime.current() !== null);
      expect(JSON.stringify(runtime.current()!.data)).not.toContain('PUBLIC_BEFORE_CHANGE'); expect(JSON.stringify(runtime.current()!.data)).not.toContain('NEVER_PUBLISH_NEW');
      await Bun.write(fixture.root + '/documentation/index.md', '# Home\n\n[Broken](missing.md)'); await eventually(() => runtime.current() === null); await Bun.sleep(140);
      expect(runtime.current()).toBeNull(); expect((await handler(new Request('http://localhost/docs/llms.txt'))).status).toBe(503);
      await Bun.write(fixture.root + '/documentation/index.md', '# Recovered'); await eventually(() => runtime.current()?.data.manifest.pages[0]?.title === 'Recovered');
      expect((await handler(new Request('http://localhost/docs'))).status).toBe(200);
    } finally { barrier.resolve(fixture.snapshot); await runtime.dispose(); await fixture.close(); }
  }, 15_000);

  test('shutdown awaits in-flight compilation, is idempotent, and late results cannot reactivate the disposed mount', async () => {
    const fixture = await docsRuntimeFixture({ 'index.md': '# Home' }), context = fixture.context(), barrier = deferred<DocsSnapshot>(); let calls = 0;
    const runtime = await createDocsSnapshotRuntime({ initial: fixture.snapshot, watchRoot: docsContentRoot(fixture.root, fixture.options), compile: async () => ++calls === 2 ? barrier.promise : fixture.snapshot });
    try {
      await Bun.write(fixture.root + '/documentation/index.md', '# Later'); await eventually(() => calls === 2);
      let drained = false; const stop = runtime.dispose().then(() => { drained = true; }); const second = runtime.dispose(); await Bun.sleep(20); expect(drained).toBe(false);
      expect(runtime.current()).toBeNull(); barrier.resolve(fixture.snapshot); await Promise.all([stop, second]); expect(drained).toBe(true); expect(runtime.current()).toBeNull();
      await Bun.sleep(100); expect(calls).toBe(2);
    } finally { barrier.resolve(fixture.snapshot); await runtime.dispose(); await fixture.close(); }
  }, 15_000);
});
