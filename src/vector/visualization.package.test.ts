/** Focused public export smoke, outside the checkout and without booting a live app. */
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, test } from 'bun:test';
for (const target of ['browser', 'bun'] as const) test(`visualization ${target} package exports build as consumer imports`, async () => {
  const scratch = process.platform === 'darwin' ? '/Volumes/code-bank/tmp/scratch/zero-platform' : tmpdir();
  await mkdir(scratch, { recursive: true }); const directory = await mkdtemp(join(scratch, 'vector-exports-'));
  try {
    const entrypoint = `${import.meta.dir}/visualization.package-${target === 'browser' ? 'client-fixture.tsx' : 'server-fixture.ts'}`;
    const build = Bun.spawn([process.execPath, '--no-env-file', 'build', entrypoint,
      '--target', target, '--outdir', directory], { stdout: 'pipe', stderr: 'pipe', timeout: 40_000 });
    const [code, stdout, stderr] = await Promise.all([build.exited, new Response(build.stdout).text(), new Response(build.stderr).text()]);
    if (code !== 0) throw new Error(`Public ${target} visualization build failed: ${stderr || stdout}`);
    expect(code).toBe(0);
    expect(await Bun.file(`${directory}/visualization.package-${target === 'browser' ? 'client-fixture' : 'server-fixture'}.js`).exists()).toBe(true);
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 60_000);
