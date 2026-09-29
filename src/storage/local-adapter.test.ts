import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalStorageAdapter } from './local-adapter';

const testDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    testDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe('LocalStorageAdapter temporary-file cleanup', () => {
  test('removes only adapter-owned orphaned upload files', async () => {
    const baseDir = await createTestDirectory();
    const tempDir = join(baseDir, 'tmp');
    await mkdir(tempDir, { recursive: true });

    const ownedUpload = join(
      tempDir,
      'upload_7e49fe73-052d-48da-81ee-02f9ce8b62a6'
    );
    const tenantDatabase = join(tempDir, 'tenant.sqlite');
    const uploadLookalike = join(tempDir, 'upload_not-a-uuid');
    const ownedNameDirectory = join(
      tempDir,
      'upload_aed5d379-2e24-474c-9da7-6e21c6af97c2'
    );

    await Promise.all([
      writeFile(ownedUpload, 'orphaned upload'),
      writeFile(tenantDatabase, 'unrelated database'),
      writeFile(uploadLookalike, 'unrelated file'),
      mkdir(ownedNameDirectory),
    ]);

    new LocalStorageAdapter(baseDir);

    expect(existsSync(ownedUpload)).toBe(false);
    expect(existsSync(tenantDatabase)).toBe(true);
    expect(existsSync(uploadLookalike)).toBe(true);
    expect(existsSync(ownedNameDirectory)).toBe(true);
  });
});

async function createTestDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'zero-local-storage-adapter-'));
  testDirectories.push(directory);
  return directory;
}
