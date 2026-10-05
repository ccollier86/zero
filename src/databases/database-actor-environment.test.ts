/** Uses one synthetic scratch dotenv file; never reads any existing app environment. */

import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rmdir, unlink } from 'node:fs/promises';
import { buildDatabaseActorCommand } from './subprocess-database-executor-factory';

test('source actor launch does not implicitly load secrets from a working-directory dotenv file', async () => {
  const scratchRoot = '/Volumes/code-bank/tmp/scratch/zero-platform';
  await mkdir(scratchRoot, { recursive: true });
  const directory = await mkdtemp(`${scratchRoot}/actor-environment-`);
  const entrypoint = `${directory}/probe.ts`;
  const envFile = `${directory}/.env`;
  try {
    await Bun.write(envFile, 'ZERO_ACTOR_SYNTHETIC_ENV_SECRET=synthetic-only\n');
    await Bun.write(entrypoint,
      'console.log(JSON.stringify({ inheritedFromDotenv: Bun.env.ZERO_ACTOR_SYNTHETIC_ENV_SECRET !== undefined }));\n');
    const command = buildDatabaseActorCommand({
      launch: { kind: 'source', entrypoint }, role: 'writer', slot: 0,
    });
    const child = Bun.spawn({ cmd: [...command], cwd: directory, env: {}, stdout: 'pipe', stderr: 'pipe' });
    const [output, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited]);
    expect(exitCode).toBe(0);
    expect(JSON.parse(output)).toEqual({ inheritedFromDotenv: false });
  } finally {
    await Promise.all([unlink(envFile), unlink(entrypoint)]);
    await rmdir(directory);
  }
}, 10_000);

test('compiled Bun actor launch retains its explicit environment boundary', async () => {
  const scratchRoot = '/Volumes/code-bank/tmp/scratch/zero-platform';
  const artifactRoot = '/Volumes/code-bank/artifacts/zero-platform/diagnostics';
  await Promise.all([mkdir(scratchRoot, { recursive: true }), mkdir(artifactRoot, { recursive: true })]);
  const directory = await mkdtemp(`${scratchRoot}/actor-bundle-environment-`);
  const artifactDirectory = await mkdtemp(`${artifactRoot}/actor-env-test-`);
  const source = `${directory}/probe.ts`;
  const envFile = `${directory}/.env`;
  const executable = `${artifactDirectory}/probe`;
  const parentSource = `${directory}/parent.ts`;
  try {
    await Bun.write(envFile, 'ZERO_ACTOR_SYNTHETIC_ENV_SECRET=synthetic-only\n');
    await Bun.write(source, `
      let identity;
      process.on('message', message => {
        if (message.type === 'handshake') {
          const { type, ...rest } = message;
          identity = rest;
          process.send({ ...identity, type: 'ready' });
        } else if (message.type === 'request') {
          process.send({ ...identity, type: 'response', requestId: message.requestId, ok: true,
            value: { inheritedFromDotenv: Bun.env.ZERO_ACTOR_SYNTHETIC_ENV_SECRET !== undefined,
              allowed: Bun.env.ZERO_ACTOR_SYNTHETIC_ALLOWED === 'allowed', cwd: process.cwd() } });
        } else if (message.type === 'shutdown') {
          process.send({ ...identity, type: 'shutdown-ack' });
          setTimeout(() => process.disconnect(), 10);
        }
      });
    `);
    const compilation = Bun.spawn({
      cmd: [process.execPath, '--no-env-file', 'build', source, '--compile', '--outfile', executable],
      cwd: directory, env: {}, stdout: 'ignore', stderr: 'pipe',
    });
    await new Response(compilation.stderr).text();
    expect(await compilation.exited).toBe(0);
    const factorySource = new URL('./subprocess-database-executor-factory.ts', import.meta.url).pathname;
    await Bun.write(parentSource, `
      import { createSubprocessDatabaseExecutorFactory } from ${JSON.stringify(factorySource)};
      import { existsSync } from 'node:fs';
      const factory = createSubprocessDatabaseExecutorFactory({
        launch: { kind: 'bundle', entrypoint: ${JSON.stringify(executable)} },
        env: { ZERO_ACTOR_SYNTHETIC_ALLOWED: 'allowed' },
      });
      const executor = factory({ role: 'reader', slot: 0 });
      try {
        const result = await executor.execute({ operation: 'environment', kind: 'read', payload: null });
        await executor.close();
        console.log(JSON.stringify({ inheritedFromDotenv: result.inheritedFromDotenv,
          allowed: result.allowed, isolated: result.cwd !== process.cwd(),
          directoryReleased: !existsSync(result.cwd), settled: executor.diagnostics().settled }));
      } finally { await executor.close(); }
    `);
    const child = Bun.spawn({ cmd: [process.execPath, '--no-env-file', parentSource], cwd: directory, env: {}, stdout: 'pipe', stderr: 'pipe' });
    const [output, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited]);
    expect(exitCode).toBe(0);
    expect(JSON.parse(output)).toEqual({ inheritedFromDotenv: false, allowed: true,
      isolated: true, directoryReleased: true, settled: true });
  } finally {
    await Promise.all([unlink(envFile), unlink(source)]);
    if (await Bun.file(parentSource).exists()) await unlink(parentSource);
    if (await Bun.file(executable).exists()) await unlink(executable);
    await Promise.all([rmdir(directory), rmdir(artifactDirectory)]);
  }
}, 30_000);
