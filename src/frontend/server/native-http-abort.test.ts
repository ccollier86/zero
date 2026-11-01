/** Execute actual native aborts in an isolated child: a process crash must fail, not take down or masquerade as a passing suite. */
import { expect, test } from 'bun:test';
import { join } from 'node:path';

test('native asynchronous HTTP responses survive mixed client cancellation without leaking requests', async () => {
  const child = Bun.spawn([process.execPath, '--no-env-file', join(import.meta.dir, 'test-fixtures/native-http-abort.fixture.ts')], {
    env: { PATH: Bun.env.PATH ?? '', TMPDIR: Bun.env.TMPDIR },
    stdin: 'ignore', stdout: 'pipe', stderr: 'pipe',
  });
  const stdout = new Response(child.stdout).text();
  const stderr = new Response(child.stderr).text();
  const deadline = setTimeout(() => child.kill('SIGKILL'), 20_000);
  try {
    const exit = await child.exited;
    const output = await stdout;
    const error = await stderr;
    expect({ exit, signal: child.signalCode, stderr: error }).toEqual({ exit: 0, signal: null, stderr: '' });
    const proof = JSON.parse(output);
    expect(proof.runtime).toBe(Bun.version);
    expect(proof.requests).toBe(2_000);
    expect(proof.completed + proof.aborted).toBe(proof.requests);
    expect(proof.completed).toBeGreaterThan(0);
    expect(proof.aborted).toBeGreaterThan(0);
    expect(proof.producerCancellations).toBeGreaterThan(0);
    expect(proof.pending).toBe(0);
  } finally {
    clearTimeout(deadline);
    if (child.exitCode === null) child.kill('SIGKILL');
    await child.exited;
    await Promise.all([stdout, stderr]);
  }
}, 25_000);
