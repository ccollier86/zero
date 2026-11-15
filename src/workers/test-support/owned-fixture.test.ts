/** Prove immediate cleanup and ownership refusal using only this allocator's synthetic state. */
import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ownedWorkerFixture } from './owned-fixture';

test('a failed disposable phase still removes its own synthetic database and generated build', async () => {
  const fixture = await ownedWorkerFixture('cleanup-failure');
  const phase = async () => {
    try {
      await writeFile(join(fixture.root, 'synthetic-state.sqlite'), 'Not a real database; allocator-owned cleanup proof.');
      await writeFile(join(fixture.root, 'generated-worker.js'), '// Synthetic generated output only.');
      throw new Error('Synthetic phase failed.');
    } finally { await fixture.cleanup(); }
  };
  await expect(phase()).rejects.toThrow('Synthetic phase failed.');
  expect(existsSync(fixture.root)).toBe(false);
});

test('cleanup refuses changed ownership rather than deleting an unverified directory', async () => {
  const fixture = await ownedWorkerFixture('cleanup-ownership');
  const marker = join(fixture.root, '.storage-synthetic-fixture.json');
  const original = await readFile(marker, 'utf8');
  try {
    await writeFile(marker, '{"synthetic-test-marker-replaced":true}');
    await expect(fixture.cleanup()).rejects.toThrow('ownership changed');
    expect(existsSync(fixture.root)).toBe(true);
  } finally {
    // Restore only the exact marker this test just replaced, so its verified
    // synthetic allocation can be removed normally instead of leaking a fixture.
    await writeFile(marker, original); await fixture.cleanup();
  }
  expect(existsSync(fixture.root)).toBe(false);
});
