/** Bundled task/catalog parity. Generated output has exact ownership and finally cleanup. No package install or real data. */
import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProcessWorkPool } from './process-pool';
import { tasks } from './test-support/worker-entry';
import { ownedWorkerFixture } from './test-support/owned-fixture';

test('a source parent uses the matching bundled worker without importing or booting the main application', async () => {
  const fixture = await ownedWorkerFixture('bundled');
  let owner: ProcessWorkPool | undefined, closed = false;
  try {
    const built = await Bun.build({ entrypoints: [fileURLToPath(new URL('./test-support/worker-entry.ts', import.meta.url))],
      target: 'bun', outdir: fixture.root, naming: 'worker.js', minify: true, metafile: true });
    expect(built.success).toBe(true);
    const metafile = typeof built.metafile === 'string' ? JSON.parse(built.metafile) : built.metafile;
    const imported = Object.keys(metafile!.inputs);
    expect(imported.filter(path => /frontend\/server\/app-factory|\/ai\/ai-service|node_modules\/(react|react-dom)\//.test(path))).toEqual([]);
    owner = new ProcessWorkPool({ tasks, launch: { kind: 'source', entrypoint: join(fixture.root, 'worker.js') }, processes: 1 });
    expect(await owner.run('fixture.echo', { bundle: true })).toMatchObject({ input: { bundle: true } });
    await owner.close(); closed = true;
  } finally {
    if (owner && !closed) { await owner.close(); closed = true; }
    if (!owner || closed) await fixture.cleanup();
  }
}, 30_000);
