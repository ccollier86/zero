/** Reject unsafe runtimes before managed entrypoints inspect configuration or mutate an app. */
import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildZeroApp } from '../build/build-app';
import { scaffoldZeroApp } from '../create-zero/scaffold';
import { runPlatformDoctor } from '../doctor/platform-doctor';
import { createApp } from '../frontend/server/app-factory';
import { updateZeroProject } from '../update/run';
import { UnsupportedBunRuntimeError } from './bun-runtime';

let restore: (() => void) | undefined;
afterEach(() => { restore?.(); restore = undefined; });

describe('runtime admission boundaries', () => {
  test('server and Doctor do not read a rejected configuration', async () => {
    const versionCheck = spyOn(Bun.semver, 'satisfies').mockReturnValue(false);
    restore = () => versionCheck.mockRestore();
    const config = { db: { mode: 'ephemeral' as const }, tables: {},
      get projectRoot(): string { throw new Error('Configuration must not be read.'); } };
    await expect(createApp(config)).rejects.toBeInstanceOf(UnsupportedBunRuntimeError);
    const report = runPlatformDoctor(config);
    expect(report.ok).toBe(false);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]?.code).toBe('runtime.bun.unsupported');
  });

  test('build, scaffold and update reject before importing config or writing app files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zero-runtime-boundary-'));
    try {
      const configPath = join(root, 'zero.config.ts');
      const marker = join(root, 'config-imported');
      await writeFile(configPath, `await Bun.write(${JSON.stringify(marker)}, 'must-not-import'); export default {};`);
      const before = await readdir(root);
      const versionCheck = spyOn(Bun.semver, 'satisfies').mockReturnValue(false);
      restore = () => versionCheck.mockRestore();
      await expect(buildZeroApp({ configPath, compile: false })).rejects.toBeInstanceOf(UnsupportedBunRuntimeError);
      await expect(scaffoldZeroApp({ targetDir: join(root, 'new-app') })).rejects.toBeInstanceOf(UnsupportedBunRuntimeError);
      await expect(updateZeroProject({ projectDir: root })).rejects.toBeInstanceOf(UnsupportedBunRuntimeError);
      expect(await readdir(root)).toEqual(before);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
