/** Exact marker/identity-owned test root. The creating test closes every handle before cleanup(). */
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, rmdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export async function ownedWorkerFixture(label: string) {
  if (!/^[a-z][a-z-]{0,39}$/.test(label)) throw new Error('Invalid worker fixture label.');
  const parent = join(tmpdir(), 'zero-workers-tests');
  await mkdir(parent, { recursive: true });
  const physicalParent = await realpath(parent);
  const root = await mkdtemp(join(physicalParent, label + '-')), identity = await lstat(root);
  const markerName = '.storage-synthetic-fixture.json';
  const marker = JSON.stringify({ schema: 1, kind: 'synthetic-test-fixture', project: 'zero-platform',
    allocator: 'src/workers/test-support/owned-fixture.ts', run_id: crypto.randomUUID(), label });
  try { await writeFile(join(root, markerName), marker, { flag: 'wx', mode: 0o600 }); }
  catch (error) {
    // Allocation itself can fail before the caller receives its finally handle.
    // Only remove the exact, still-owned empty directory we just allocated.
    const current = await lstat(root);
    if (current.dev === identity.dev && current.ino === identity.ino && current.isDirectory()
      && !current.isSymbolicLink() && (await readdir(root)).length === 0) await rmdir(root);
    throw error;
  }
  return { root, async cleanup() {
    const current = await lstat(root);
    if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== identity.dev || current.ino !== identity.ino
      || await readFile(join(root, markerName), 'utf8') !== marker) throw new Error('Worker fixture ownership changed; preserving ' + root);
    const inspect = async (directory: string) => {
      for (const name of await readdir(directory)) {
        if (['.git', '.storage-keep', '.keep', '.pin', 'PINNED'].includes(name)) throw new Error('Worker fixture contains protected content; preserving ' + root);
        const path = join(directory, name), entry = await lstat(path);
        if (entry.isSymbolicLink() || entry.dev !== identity.dev || entry.isFile() && entry.nlink !== 1) throw new Error('Worker fixture contains an unowned link; preserving ' + root);
        if (entry.isDirectory()) await inspect(path);
      }
    };
    await inspect(root);
    const final = await lstat(root);
    if (final.ino !== identity.ino || final.dev !== identity.dev || final.isSymbolicLink()) throw new Error('Worker fixture replaced; preserving ' + root);
    await rm(root, { recursive: true });
  } };
}
