import { describe, expect, test } from 'bun:test';
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { commitStagedScaffold } from './scaffold-transaction';

const cli = join(import.meta.dir, 'run.ts');

describe('create-zero in the current directory', () => {
  test.each([false, true])('creates in an empty cwd and preserves its directory (Finder metadata: %s)', async (finderMetadata) => {
    const root = await mkdtemp(join(tmpdir(), 'zero-create-cwd-'));
    const target = join(root, 'my-app');
    try {
      await mkdir(target);
      if (finderMetadata) await writeFile(join(target, '.DS_Store'), 'Finder metadata');
      const before = await lstat(target);
      const child = Bun.spawn([process.execPath, cli, '.'], {
        cwd: target, stdout: 'pipe', stderr: 'pipe',
      });
      const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
      expect(stderr).toBe('');
      expect(code).toBe(0);
      expect((await lstat(target)).ino).toBe(before.ino);
      expect(JSON.parse(await readFile(join(target, 'package.json'), 'utf8')).name).toBe('my-app');
      if (finderMetadata) {
        expect(await readFile(join(target, '.DS_Store'), 'utf8')).toBe('Finder metadata');
      }
      expect(await readdir(root)).toEqual(['my-app']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('refuses existing cwd content even with --force', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zero-create-cwd-'));
    try {
      await writeFile(join(root, 'keep.txt'), 'existing work');
      const child = Bun.spawn([process.execPath, cli, '.', '--force'], {
        cwd: root, stdout: 'pipe', stderr: 'pipe',
      });
      expect(await child.exited).toBe(1);
      expect(await new Response(child.stderr).text()).toContain('workspace, home directory');
      expect(await readdir(root)).toEqual(['keep.txt']);
      expect(await readFile(join(root, 'keep.txt'), 'utf8')).toBe('existing work');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('leaves the cwd empty when preparation fails or concurrent content appears', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zero-create-cwd-'));
    const target = join(root, 'app');
    const scaffoldUrl = pathToFileURL(join(import.meta.dir, 'scaffold.ts')).href;
    try {
      await mkdir(target);
      const before = await lstat(target);
      for (const concurrent of [false, true]) {
        const script = `
          import { scaffoldZeroApp } from ${JSON.stringify(scaffoldUrl)};
          await scaffoldZeroApp({ targetDir: '.', async prepareStagedApp() {
            if (${concurrent}) await Bun.write('keep.txt', 'concurrent work');
            else throw new Error('preparation failed');
          }});
        `;
        const child = Bun.spawn([process.execPath, '--eval', script], {
          cwd: target, stdout: 'pipe', stderr: 'pipe',
        });
        expect(await child.exited).toBe(1);
        expect(await new Response(child.stderr).text()).toContain(
          concurrent ? 'Target changed during generation' : 'preparation failed'
        );
        expect((await lstat(target)).ino).toBe(before.ino);
        expect(await readdir(target)).toEqual(concurrent ? ['keep.txt'] : []);
        expect(await readdir(root)).toEqual(['app']);
      }
      expect(await readFile(join(target, 'keep.txt'), 'utf8')).toBe('concurrent work');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('rolls back published entries when populating the cwd fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zero-create-cwd-'));
    const target = join(root, 'app');
    const staging = join(root, '.app.zero-stage-test');
    try {
      await mkdir(target);
      await mkdir(staging);
      await writeFile(join(staging, 'a.txt'), 'first');
      await writeFile(join(staging, 'b.txt'), 'second');
      const before = await lstat(target, { bigint: true });
      await expect(commitStagedScaffold(staging, target, {
        exists: true, dev: before.dev, ino: before.ino,
        ctimeNs: before.ctimeNs, mtimeNs: before.mtimeNs, preserveDirectory: true,
      }, {
        async rename(source, destination) {
          if (source === join(staging, 'b.txt')) throw new Error('injected publish failure');
          await rename(source, destination);
        },
        remove: (path) => rm(path, { force: true, recursive: true }),
      })).rejects.toThrow('injected publish failure');
      expect((await lstat(target, { bigint: true })).ino).toBe(before.ino);
      expect(await readdir(target)).toEqual([]);
      expect((await readdir(staging)).sort()).toEqual(['a.txt', 'b.txt']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
