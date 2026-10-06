/** Disposable compiler corpus helpers; never reads or writes application content. */
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export async function docsFixture(files: Readonly<Record<string, string | Uint8Array>>) {
  const scratch = '/Volumes/code-bank/tmp/scratch/zero-platform';
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(join(scratch, 'docs-content-'));
  for (const [source, contents] of Object.entries(files)) {
    const target = join(root, source); await mkdir(dirname(target), { recursive: true }); await Bun.write(target, contents);
  }
  return { root, async close() { await rm(root, { recursive: true, force: true }); } };
}

