import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { describe, expect, test } from 'bun:test';

import { runCreateZeroCli } from './run';
import { scaffoldZeroApp } from './scaffold';
import { commitStagedScaffold } from './scaffold-transaction';

async function tempRoot(): Promise<string> {
  const parent = join(process.cwd(), '.zero');
  await mkdir(parent, { recursive: true });
  return mkdtemp(join(parent, 'test-create-zero-safety-'));
}

describe('create-zero filesystem safety', () => {
  test('never treats --template value as a force target when the target is missing', async () => {
    const root = await tempRoot();
    const template = join(root, 'template');
    try {
      await mkdir(template);
      await writeFile(join(template, 'keep.txt'), 'original template');
      expect(await runCreateZeroCli(['--template', template, '--force'])).toBe(1);
      expect(await readFile(join(template, 'keep.txt'), 'utf8')).toBe('original template');
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  test('rejects symlinked templates and template contents', async () => {
    const root = await tempRoot();
    try {
      const template = join(root, 'template');
      const templateLink = join(root, 'template-link');
      await mkdir(template);
      await writeFile(join(template, 'regular.txt'), 'safe');
      await symlink(template, templateLink, 'dir');
      await expect(scaffoldZeroApp({ targetDir: join(root, 'app-a'), templateDir: templateLink }))
        .rejects.toThrow('Template must be a real directory');

      await symlink(join(template, 'regular.txt'), join(template, 'linked.txt'));
      await expect(scaffoldZeroApp({ targetDir: join(root, 'app-b'), templateDir: template }))
        .rejects.toThrow('Template contains a symlink');
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  test('rejects symlink targets and both directions of template overlap', async () => {
    const root = await tempRoot();
    try {
      const template = join(root, 'template');
      const target = join(root, 'target');
      await mkdir(template);
      await writeFile(join(template, 'starter.txt'), 'starter');
      await mkdir(target);
      await writeFile(join(target, 'keep.txt'), 'keep');

      const targetLink = join(root, 'target-link');
      await symlink(target, targetLink, 'dir');
      await expect(scaffoldZeroApp({ targetDir: targetLink, templateDir: template, force: true }))
        .rejects.toThrow('Target must be a real directory');
      await expect(scaffoldZeroApp({ targetDir: join(template, 'nested'), templateDir: template, force: true }))
        .rejects.toThrow('must not overlap');
      await expect(scaffoldZeroApp({ targetDir: target, templateDir: join(target, 'template'), force: true }))
        .rejects.toThrow('does not exist');

      const nestedTemplate = join(target, 'template');
      await mkdir(nestedTemplate);
      await writeFile(join(nestedTemplate, 'starter.txt'), 'starter');
      await expect(scaffoldZeroApp({ targetDir: target, templateDir: nestedTemplate, force: true }))
        .rejects.toThrow('must not overlap');
      expect(await readFile(join(target, 'keep.txt'), 'utf8')).toBe('keep');
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  test('refuses to replace Git repositories and never copies template Git metadata', async () => {
    const root = await tempRoot();
    try {
      const template = join(root, 'template');
      const target = join(root, 'target');
      await mkdir(join(template, '.git'), { recursive: true });
      await writeFile(join(template, '.git', 'config'), 'template repository metadata');
      await writeFile(join(template, 'starter.txt'), 'starter');
      await mkdir(join(target, '.git'), { recursive: true });
      await writeFile(join(target, '.git', 'config'), 'existing repository metadata');
      await writeFile(join(target, 'keep.txt'), 'keep');

      await expect(scaffoldZeroApp({ targetDir: target, templateDir: template, force: true }))
        .rejects.toThrow('containing a Git repository');
      expect(await readFile(join(target, 'keep.txt'), 'utf8')).toBe('keep');

      const parentTarget = join(root, 'sdk-parent');
      await mkdir(join(parentTarget, 'nested-sdk', '.git'), { recursive: true });
      await writeFile(join(parentTarget, 'nested-sdk', '.git', 'config'), 'nested repository');
      await expect(scaffoldZeroApp({
        targetDir: parentTarget, templateDir: template, force: true,
      })).rejects.toThrow('containing a Git repository');
      expect(await Bun.file(join(parentTarget, 'nested-sdk', '.git', 'config')).exists()).toBe(true);

      const generated = join(root, 'generated');
      await scaffoldZeroApp({ targetDir: generated, templateDir: template });
      expect(await Bun.file(join(generated, 'starter.txt')).exists()).toBe(true);
      expect(await Bun.file(join(generated, '.git', 'config')).exists()).toBe(false);

      const nestedTemplate = join(root, 'template-with-sdk');
      await mkdir(join(nestedTemplate, 'sdk', 'standalone', '.git'), { recursive: true });
      await writeFile(join(nestedTemplate, 'sdk', 'standalone', 'Cargo.toml'), '[workspace]');
      await expect(scaffoldZeroApp({
        targetDir: join(root, 'nested-template-output'), templateDir: nestedTemplate,
      })).rejects.toThrow('Template contains a nested Git repository');
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  test('rejects broad workspace, home, and filesystem-root targets', async () => {
    await expect(scaffoldZeroApp({ targetDir: process.cwd(), force: true }))
      .rejects.toThrow('workspace, home directory');
    await expect(scaffoldZeroApp({ targetDir: homedir(), force: true }))
      .rejects.toThrow('workspace, home directory');
    await expect(scaffoldZeroApp({ targetDir: '/', force: true }))
      .rejects.toThrow('dangerous broad target');
  });

  test('keeps the existing target when staged generation fails', async () => {
    const root = await tempRoot();
    const target = join(root, 'existing');
    try {
      await mkdir(target);
      await writeFile(join(target, 'keep.txt'), 'original');
      await expect(scaffoldZeroApp({
        targetDir: target,
        force: true,
        async prepareStagedApp() { throw new Error('injected preparation failure'); },
      })).rejects.toThrow('injected preparation failure');

      expect(await readFile(join(target, 'keep.txt'), 'utf8')).toBe('original');
      expect((await readdir(root)).some((entry) => entry.includes('.zero-stage-'))).toBe(false);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  test('fails closed when the target changes while the replacement is staged', async () => {
    const root = await tempRoot();
    const target = join(root, 'existing');
    try {
      await mkdir(target);
      await writeFile(join(target, 'keep.txt'), 'original');
      await expect(scaffoldZeroApp({
        targetDir: target,
        force: true,
        async prepareStagedApp() {
          await writeFile(join(target, 'late.txt'), 'concurrent data');
        },
      })).rejects.toThrow('Target changed during generation');

      expect(await readFile(join(target, 'keep.txt'), 'utf8')).toBe('original');
      expect(await readFile(join(target, 'late.txt'), 'utf8')).toBe('concurrent data');
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  test('rescans for a nested repository immediately before force replacement', async () => {
    const root = await tempRoot();
    const target = join(root, 'existing');
    const nested = join(target, 'sdk');
    try {
      await mkdir(nested, { recursive: true });
      await writeFile(join(target, 'keep.txt'), 'original');
      await expect(scaffoldZeroApp({
        targetDir: target,
        force: true,
        async prepareStagedApp() {
          await mkdir(join(nested, '.git'));
          await writeFile(join(nested, '.git', 'config'), 'concurrent repository');
        },
      })).rejects.toThrow('containing a Git repository');

      expect(await readFile(join(target, 'keep.txt'), 'utf8')).toBe('original');
      expect(await readFile(join(nested, '.git', 'config'), 'utf8'))
        .toBe('concurrent repository');
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  test('restores the original target when the staged rename fails', async () => {
    const root = await tempRoot();
    const target = join(root, 'existing');
    const staging = join(root, '.existing.zero-stage-test');
    try {
      await mkdir(target);
      await mkdir(staging);
      await writeFile(join(target, 'keep.txt'), 'original');
      await writeFile(join(staging, 'new.txt'), 'generated');
      const details = await lstat(target, { bigint: true });

      await expect(commitStagedScaffold(staging, target, {
        dev: details.dev,
        exists: true,
        ino: details.ino,
        ctimeNs: details.ctimeNs,
        mtimeNs: details.mtimeNs,
      }, {
        async rename(source, destination) {
          if (source === staging && destination === target) throw new Error('injected rename failure');
          await rename(source, destination);
        },
        remove: (path) => rm(path, { force: true, recursive: true }),
      })).rejects.toThrow('injected rename failure');

      expect(await readFile(join(target, 'keep.txt'), 'utf8')).toBe('original');
      expect((await readdir(root)).filter((entry) => entry.includes('zero-backup'))).toEqual([]);
      expect(await readFile(join(staging, 'new.txt'), 'utf8')).toBe('generated');
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  test('force replacement completes without leaving staging or backup directories', async () => {
    const root = await tempRoot();
    const target = join(root, 'existing');
    try {
      await mkdir(target);
      await writeFile(join(target, 'stale.txt'), 'stale');
      await scaffoldZeroApp({ targetDir: target, force: true });
      expect(await Bun.file(join(target, 'stale.txt')).exists()).toBe(false);
      expect(await Bun.file(join(target, 'package.json')).exists()).toBe(true);
      expect((await readdir(root)).filter((entry) => entry.includes(basename(target)))).toEqual(['existing']);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
