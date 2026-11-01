/** The single admitted package-manager marker cannot hide package files, links, directories or blocking special files. */
import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertBunInstallTag, BUN_INSTALL_TAG_NAME } from './bun-install-metadata';

test('admits a bounded regular marker without interpreting it as archive integrity', async () => {
  const root = await mkdtemp(join(tmpdir(), 'zero-bun-install-marker-'));
  try {
    const path = join(root, BUN_INSTALL_TAG_NAME);
    await writeFile(path, 'synthetic-bun-cache-marker');
    await expect(assertBunInstallTag(path)).resolves.toBeUndefined();
    expect(await readFile(path, 'utf8')).toBe('synthetic-bun-cache-marker');
    await writeFile(path, 'x'.repeat(4_097));
    await expect(assertBunInstallTag(path)).rejects.toThrow('Invalid package-manager installation tag');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('refuses an installation marker link or directory without touching its target', async () => {
  const root = await mkdtemp(join(tmpdir(), 'zero-bun-install-marker-'));
  try {
    const target = join(root, 'outside'), link = join(root, BUN_INSTALL_TAG_NAME);
    await writeFile(target, 'must-not-change'); await symlink(target, link);
    await expect(assertBunInstallTag(link)).rejects.toThrow('Invalid package-manager installation tag');
    expect(await readFile(target, 'utf8')).toBe('must-not-change');
    const directory = join(root, 'directory'); await mkdir(directory);
    await expect(assertBunInstallTag(directory)).rejects.toThrow('Invalid package-manager installation tag');
  } finally { await rm(root, { recursive: true, force: true }); }
});
