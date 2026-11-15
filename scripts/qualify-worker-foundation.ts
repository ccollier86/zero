/** Focused core qualification, not the complete release gate. Owns a fresh frozen dependency tree and retires it on success/failure. */
import { lstat, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = await realpath(join(dirname(fileURLToPath(import.meta.url)), '..'));
const dependencies = join(root, 'node_modules');
const markerPath = join(dependencies, '.zero-worker-qualification-owner.json');
const marker = JSON.stringify({ project: 'zero-platform', purpose: 'worker-foundation-qualification', runId: crypto.randomUUID() });
const focus = Bun.argv.slice(2);
if (focus.some(path => !/^src\/[A-Za-z0-9_./-]+\.test\.tsx?$/.test(path) || path.split('/').includes('..'))) {
  throw new Error('Focused qualification accepts explicit repository test paths only.');
}
// Do not replace, borrow or remove another worktree/session's dependency tree.
await mkdir(dependencies);
const identity = await lstat(dependencies);
let cleanable = false;
try {
  await writeFile(markerPath, marker, { flag: 'wx', mode: 0o600 });
  cleanable = true;
  await run([process.execPath, '--no-env-file', 'install', '--frozen-lockfile', '--ignore-scripts', '--silent'], 180_000);
  const tests = focus.length ? focus : [
    'src/workers', 'src/jobs', 'src/scheduler', 'src/messaging/work-pool.test.ts', 'src/doctor/source-only-background-checks.test.ts',
    'src/databases/subprocess-database-server.test.ts', 'src/databases/subprocess-database-server-imports.test.ts',
    'src/workflows/workflow-runtime-ownership.test.ts',
    'src/workflows/workflow-deferred-start-bridge.test.ts', 'src/workflows/workflow-enqueue.test.ts',
    'src/workflows/workflow-system-start.test.ts', 'src/frontend/client/jobs-client.test.ts', 'src/frontend/client/sdk-jobs-retirement.test.ts',
    'src/frontend/server/app-workflow-execution-services.integration.test.ts',
    'src/frontend/server/workflow-execution-capability-topology.integration.test.ts',
    'src/workflows/workflow-execution-authority.integration.test.ts',
    'src/workflows/workflow-graph-runtime.test.ts', 'src/workflows/workflow-interaction-service.test.ts',
    'src/ai/ai-session.test.ts', 'src/ai/ai-embedding-operations.test.ts'];
  await run([process.execPath, '--no-env-file', 'test', '--timeout', '120000', ...tests], 600_000);
  await run([process.execPath, '--no-env-file', join(dependencies, 'typescript/bin/tsc'), '--noEmit', '--strict',
    '--skipLibCheck', '--module', 'preserve', '--moduleResolution', 'bundler', '--target', 'esnext',
    '--jsx', 'react-jsx', '--allowImportingTsExtensions', '--types', 'bun', '--esModuleInterop',
    'src/workers/index.ts', 'src/workers/types.test.ts', 'src/workers/work-pool.test.ts', 'src/workers/process-pool.test.ts', 'src/workers/worker-task.test.ts',
    'src/databases/database-actor-authority-commit.integration.test.ts',
    'src/build/jobs-realm-build-plugin.test.ts', 'src/jobs/public-types.test.ts', 'src/jobs/installed-fixture.test.ts',
    'src/jobs/test-support/installed-deployment/fixture.ts', 'src/jobs/test-support/installed-deployment/qualify.ts',
    'scripts/qualify-jobs-installed-linux.ts', 'scripts/qualify-worker-linux.ts', 'src/workers/torrent-managed.test.ts',
    'src/workers/managed.test.ts', 'src/jobs/runtime.ts', 'src/jobs/definition.ts', 'src/jobs/definition.test.ts',
    'src/jobs/realm.integration.test.ts', 'src/jobs/runtime.integration.test.ts', 'src/jobs/persistence-config.test.ts',
    'src/jobs/config.test.ts', 'src/jobs/managed.integration.test.ts', 'src/jobs/logging.integration.test.ts',
    'src/jobs/logging-managed.integration.test.ts', 'src/jobs/semantic-audit.test.ts', 'src/logging/logging-actor-source.test.ts',
    'src/jobs/native-service-progress.integration.test.ts', 'src/jobs/stream.test.ts', 'src/frontend/client/jobs-hooks.test.tsx',
    'src/databases/database-command-source-audit.ts', 'src/components/jobs/jobs-workspace-controller.test.tsx',
    'src/components/jobs/jobs-workspace.browser-fixture.tsx', 'src/components/jobs/jobs-workspace.browser.test.ts', 'scripts/preview-jobs-workspace.ts',
    'src/jobs/service.ts', 'src/jobs/runner.ts', 'src/jobs/runner.test.ts', 'src/jobs/operator-policy.test.ts', 'src/jobs/operator-views.test.ts',
    'src/jobs/stream.ts', 'src/jobs/watch.test.ts', 'src/frontend/client/jobs-client.test.ts', 'src/frontend/client/sdk-jobs-retirement.test.ts',
    'src/frontend/client/jobs-hooks.ts', 'src/frontend/exports/features/jobs.ts',
    'src/scheduler/index.ts', 'src/scheduler/scheduler-lifecycle.test.ts', 'src/doctor/source-only-background-checks.ts'], 600_000);
} finally {
  const current = await lstat(dependencies);
  if (!cleanable || current.isSymbolicLink() || current.dev !== identity.dev || current.ino !== identity.ino
    || await readFile(markerPath, 'utf8') !== marker) {
    throw new Error('Qualification dependency ownership changed; preserving ' + dependencies);
  }
  await rm(dependencies, { recursive: true });
}

async function run(command: string[], timeoutMs: number) {
  console.log(JSON.stringify({ stage: 'worker-core-qualification', command: command.slice(1) }));
  const child = Bun.spawn(command, { cwd: root, env: process.env, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
  const tail = async (stream: ReadableStream<Uint8Array>) => {
    let output = ''; const decoder = new TextDecoder();
    for await (const chunk of stream) output = (output + decoder.decode(chunk, { stream: true })).slice(-32_000);
    return output + decoder.decode();
  };
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, timeoutMs);
  const hardStop = setTimeout(() => child.kill('SIGKILL'), timeoutMs + 5000);
  try {
    const [code, stdout, stderr] = await Promise.all([child.exited, tail(child.stdout), tail(child.stderr)]);
    console.log((stdout + stderr).slice(-12_000));
    if (timedOut || code !== 0) throw new Error(`Core qualification command ${timedOut ? 'timed out' : 'failed with exit ' + code}.`);
  } finally { clearTimeout(timer); clearTimeout(hardStop); }
}
