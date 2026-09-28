import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { archivePath, command, publishMain, readStableRelease } from './stable-release';
import { runStableTool } from './run';
import { installTools } from './install';

test('saved packages exclude feature/uncommitted files; installed tools and main hooks use the archive', async () => {
  const root = await mkdtemp(join(tmpdir(), 'zero-stable-test-'));
  const repo = join(root, 'repo');
  const config = { repo, releases: join(root, 'releases'), scratch: join(root, 'scratch') };
  const envNames = ['ZERO_LOCAL_BIN_DIR', 'ZERO_LOCAL_TOOLS_DIR', 'ZERO_RELEASE_DIR', 'ZERO_TOOLS_SCRATCH_DIR'];
  const previous = envNames.map((name) => process.env[name]);
  try {
    await mkdir(repo);
    // Use the existing committed scaffolder/transaction/updater APIs as the fixture contract.
    const sourceRepo = resolve(import.meta.dir, '../..');
    const sourceTar = join(root, 'source.tar');
    await command(['git', 'archive', '--output', sourceTar, 'main', 'package.json', 'src/create-zero', 'src/update', 'examples/package-mode'], sourceRepo);
    await command(['tar', '-xf', sourceTar, '-C', repo], root);
    await writeFile(join(repo, 'src/marker.ts'), 'export const marker = "committed-main";\n');
    await command(['git', 'init', '-b', 'main'], repo);
    await command(['git', 'config', 'user.name', 'Zero Test'], repo);
    await command(['git', 'config', 'user.email', 'zero-test@example.invalid'], repo);
    await command(['git', 'add', '.'], repo);
    await command(['git', '-c', 'commit.gpgsign=false', 'commit', '-m', 'baseline'], repo);
    const main = await command(['git', 'rev-parse', 'HEAD'], repo);
    await command(['git', 'checkout', '-b', 'feature/unreleased'], repo);
    await writeFile(join(repo, 'src/marker.ts'), 'export const marker = "feature-commit";\n');
    await command(['git', 'add', 'src/marker.ts'], repo);
    await command(['git', '-c', 'commit.gpgsign=false', 'commit', '-m', 'unreleased feature'], repo);
    await writeFile(join(repo, 'src/marker.ts'), 'export const marker = "dirty-feature";\n');
    await writeFile(join(repo, 'src/untracked-feature.ts'), 'unreleased\n');
    await writeFile(join(repo, 'src/create-zero/scaffold.ts'), 'throw new Error("LIVE CHECKOUT EXECUTED");\n');
    const release = await publishMain(config);
    expect(release.commit).toBe(main);
    const bytes = await readFile(archivePath(config, release));
    const files = await new Bun.Archive(bytes).files();
    expect(await files.get('package/src/marker.ts')!.text()).toContain('committed-main');
    expect(files.has('package/src/untracked-feature.ts')).toBe(false);
    expect(await publishMain(config)).toEqual(release);

    process.env.ZERO_LOCAL_BIN_DIR = join(root, 'bin');
    process.env.ZERO_LOCAL_TOOLS_DIR = join(root, 'tools');
    process.env.ZERO_RELEASE_DIR = config.releases;
    process.env.ZERO_TOOLS_SCRATCH_DIR = config.scratch;
    await installTools(repo);
    const app = join(root, 'app');
    await command([join(root, 'bin/zero-new'), app, '--skip-install'], root);
    const appPackage = JSON.parse(await readFile(join(app, 'package.json'), 'utf8'));
    expect(appPackage.dependencies['@zero/framework']).toBe('file:./.zero/framework/zero-framework.tgz');
    expect(await readFile(join(app, '.zero/framework/zero-framework.tgz'))).toEqual(bytes);
    expect(JSON.parse(await readFile(join(app, 'zero-release.json'), 'utf8')).commit).toBe(main);
    await expect(runStableTool(config, 'new', [join(root, 'override'), '--zero', '*'])).rejects.toThrow('cannot override');
    await expect(runStableTool(config, 'update', [app, '--local', repo])).rejects.toThrow('cannot override');
    // The installed command works even when the source repository is unavailable.
    const { rename } = await import('node:fs/promises');
    await rename(repo, `${repo}-offline`);
    await command([join(root, 'bin/zero-new'), join(root, 'offline-app'), '--skip-install'], root);
    await rename(`${repo}-offline`, repo);

    // Feature commits do not refresh stable; main commits do, through the installed hook.
    await command(['git', 'add', '.'], repo);
    await command(['git', '-c', 'commit.gpgsign=false', 'commit', '-m', 'more feature work'], repo);
    expect((await readStableRelease(config)).commit).toBe(main);
    await command(['git', 'checkout', 'main'], repo);
    await writeFile(join(repo, 'src/marker.ts'), 'export const marker = "next-main";\n');
    await command(['git', 'add', '.'], repo);
    await command(['git', '-c', 'commit.gpgsign=false', 'commit', '-m', 'next main'], repo);
    const next = await readStableRelease(config);
    expect(next.commit).toBe(await command(['git', 'rev-parse', 'HEAD'], repo));
    expect(next.commit).not.toBe(main);
    expect(await readFile(join(app, '.zero/framework/zero-framework.tgz'))).toEqual(bytes);

    // A failed publication leaves the previous stable pointer intact.
    await command(['git', 'rm', 'src/create-zero/scaffold.ts'], repo);
    await command(['git', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', 'commit', '-m', 'broken main fixture'], repo);
    await expect(publishMain(config)).rejects.toThrow('missing');
    expect(await readStableRelease(config)).toEqual(next);
    await writeFile(archivePath(config, next), 'corrupted archive');
    await expect(runStableTool(config, 'new', [join(root, 'corrupt-app'), '--skip-install'])).rejects.toThrow('checksum');
    expect(await Bun.file(join(root, 'corrupt-app/package.json')).exists()).toBe(false);
  } finally {
    envNames.forEach((name, index) => {
      if (previous[index] === undefined) delete process.env[name]; else process.env[name] = previous[index];
    });
    await rm(root, { recursive: true, force: true });
  }
}, 120_000);
