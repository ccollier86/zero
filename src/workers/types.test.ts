/** Compile-time facade contracts. This function is never called and creates no resources. */
import type { ProcessWorkPool } from './process-pool';
import type { WorkerService, ScopedWorkers } from './service';
import type { WorkerTaskInput, WorkerTaskOutput } from './worker-task';
import { sumTask } from './test-support/worker-entry';

function assertTypedWorkerFacades(pool: ProcessWorkPool, owner: WorkerService, scoped: ScopedWorkers) {
  const input: WorkerTaskInput<typeof sumTask> = [1, 2, 3];
  const a: Promise<WorkerTaskOutput<typeof sumTask>> = pool.run(sumTask, input);
  const b: Promise<number> = owner.run(sumTask, input);
  const c: Promise<number> = scoped.run(sumTask, input);
  const legacy: Promise<unknown> = scoped.run('fixture.sum', input);
  // @ts-expect-error Registered task references require their declared input.
  scoped.run(sumTask, 'not a numeric array');
  // @ts-expect-error An inferred numeric result cannot become a string result.
  const wrong: Promise<string> = owner.run(sumTask, input);
  void [a, b, c, legacy, wrong];
}
void assertTypedWorkerFacades;
