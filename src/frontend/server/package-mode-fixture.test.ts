/**
 * package-mode-fixture.test.ts
 *
 * Verifies the generated-app starter consumes Zero through public package
 * exports. This test owns package-mode starter checks only; route-loader unit
 * behavior stays in server-route-loader.test.ts.
 */

import { rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';

describe('package-mode starter', () => {
  test('builds the app server through public @zero/framework exports', async () => {
    const outdir = join(process.cwd(), '.zero', 'package-mode-fixture-test-build');

    try {
      await spawnChecked([
        'bun',
        'build',
        'examples/package-mode/app/server.ts',
        '--target',
        'bun',
        '--outdir',
        outdir,
      ]);

      await expect(stat(join(outdir, 'server.js')).then((value) => value.isFile())).resolves.toBe(true);
    } finally {
      await rm(outdir, { recursive: true, force: true });
    }
  });
});

async function spawnChecked(cmd: string[]): Promise<void> {
  const proc = Bun.spawn(cmd, {
    cwd: process.cwd(),
    stdout: 'pipe',
    stderr: 'pipe',
    env: Bun.env,
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(`Command failed (${cmd.join(' ')}):\n${stdout}\n${stderr}`);
  }
}
