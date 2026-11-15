/** Synthetic fixed catalog. A direct invocation never boots a web app. */
import { defineWorkerTask } from '../worker-task';
import { runWorkerIfRequested } from '../worker-bootstrap';
import type { WorkerValue } from '../worker-value';

const identity = (value: WorkerValue) => value;
export const sumTask = defineWorkerTask({ name: 'fixture.sum', version: '1',
  parseInput(value) {
    if (!Array.isArray(value) || value.some(item => typeof item !== 'number')) throw new Error('Synthetic numeric array required.');
    return value as number[];
  },
  parseOutput(value) { if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Synthetic finite sum required.'); return value; },
  run: values => values.reduce((total, value) => total + value, 0),
});
export const tasks = [
  defineWorkerTask({ name: 'fixture.echo', version: '1', parseInput: identity, parseOutput: identity,
    run: input => ({ input, pid: process.pid }) }),
  defineWorkerTask({ name: 'fixture.cpu', version: '1', parseInput: value => {
    if (typeof value !== 'number' || value < 0 || value > 1000) throw new Error('Invalid synthetic duration.'); return value;
  }, parseOutput: identity, run: ms => { const startedAt = Date.now(), until = performance.now() + ms; let n = 0; while (performance.now() < until) n++; return { pid: process.pid, worked: n > 0, startedAt, finishedAt: Date.now() }; } }),
  defineWorkerTask({ name: 'fixture.env', version: '1', parseInput: identity, parseOutput: identity,
    run: () => ({ inheritedSecret: Object.hasOwn(process.env, 'ZERO_WORKER_SYNTHETIC_SECRET'),
      allowedValue: process.env.ZERO_WORKER_SYNTHETIC_ALLOWED === 'allowed' }) }),
  defineWorkerTask({ name: 'fixture.entered', version: '1', parseInput: value => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.marker !== 'string') throw new Error('Synthetic marker required.');
    return { marker: value.marker };
  }, parseOutput: identity, run: async value => {
    await Bun.write(value.marker, 'synthetic-task-entered');
    const until = performance.now() + 500;
    while (performance.now() < until) { /* Bounded test CPU; cannot outlive a crashed runner indefinitely. */ }
    return { pid: process.pid };
  } }),
  defineWorkerTask({ name: 'fixture.fail', version: '1', parseInput: identity, parseOutput: identity,
    run: () => { throw new Error('PRIVATE_SYNTHETIC_FAILURE_VALUE'); } }),
  defineWorkerTask({ name: 'fixture.exit', version: '1', parseInput: identity, parseOutput: identity,
    run: () => { process.exit(70); } }),
  defineWorkerTask({ name: 'fixture.idle-exit', version: '1', parseInput: identity, parseOutput: identity,
    run: () => { setTimeout(() => process.exit(70), 30); return { pid: process.pid }; } }),
  defineWorkerTask({ name: 'fixture.slow-close', version: '1', parseInput: identity, parseOutput: identity,
    run: () => {
      const delay = (message: unknown) => {
        if (!message || typeof message !== 'object' || (message as { type?: unknown }).type !== 'shutdown') return;
        process.off('message', delay);
        const until = performance.now() + 300;
        while (performance.now() < until) { /* Deliberately delay graceful ack, without an indefinite fixture. */ }
      };
      process.on('message', delay); return null;
    } }),
  defineWorkerTask({ name: 'fixture.hang', version: '1', parseInput: identity, parseOutput: identity,
    run: () => {
      // Ignore IPC/abort long enough to qualify forced parent-side termination.
      // Test-only dead-man fuse: a killed test runner must not strand an infinite
      // CPU loop. This is not a production parent-death containment claim.
      const hardStop = performance.now() + 10_000;
      while (performance.now() < hardStop) { /* Parent must terminate this exact generation first. */ }
      process.exit(70);
    } }),
  sumTask,
];

if (import.meta.main) {
  try { if (!await runWorkerIfRequested({ tasks })) process.exitCode = 64; }
  catch { process.exitCode = 70; }
}
