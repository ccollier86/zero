/** Bounded native child-response/file delivery probe; no framework, config, services or retained application state. */
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const root = await mkdtemp(join(tmpdir(), 'zero-native-response-file-'));
const child = Bun.spawn([process.execPath, '--no-env-file', '-e', 'process.stdout.write("native-fixture-output");'], {
  env: { PATH: Bun.env.PATH ?? '', TMPDIR: Bun.env.TMPDIR }, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe',
});
try {
  const [code, , error] = await Promise.all([child.exited,
    Bun.write(join(root, 'output'), new Response(child.stdout)), new Response(child.stderr).text()]);
  const output = await Bun.file(join(root, 'output')).text();
  if (code !== 0 || error || output !== 'native-fixture-output') throw new Error('Native response/file delivery lost child output.');
  process.stdout.write(`${JSON.stringify({ runtime: Bun.version, responseWriter: true })}\n`);
} finally {
  if (child.exitCode === null) child.kill('SIGKILL');
  await child.exited;
  await rm(root, { recursive: true, force: true });
}
