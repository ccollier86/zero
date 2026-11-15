/** Pure contract checks; no files, processes or providers are opened. */
import { expect, test } from 'bun:test';
import { defineWorkerTask, WorkerTaskCatalog } from './worker-task';

test('canonical normalization is detached, repeatable and runs the handler exactly once', async () => {
  let runs = 0;
  const task = defineWorkerTask({ name: 'canonical', version: '1',
    parseInput(value) { if (typeof value !== 'string') throw new Error('String required'); return value.trim(); },
    parseOutput(value) { if (typeof value !== 'string') throw new Error('String required'); return value; },
    run(value) { runs++; return value.toUpperCase(); },
  });
  expect(task.parseInput('   hello  ')).toBe('hello');
  expect(await task.invoke(task.parseInput('   hello  '))).toBe('HELLO'); expect(runs).toBe(1);
});

test('non-idempotent parsers fail before handler dispatch, with no authored failure text', async () => {
  let runs = 0;
  const task = defineWorkerTask({ name: 'unsafe-transform', version: '1',
    parseInput(value) { if (typeof value !== 'number') throw new Error('PRIVATE_INPUT'); return value + 1; },
    parseOutput: value => value,
    run(value) { runs++; return value; },
  });
  expect(() => task.parseInput(1)).toThrow();
  const failure = await task.invoke(1).catch(error => error);
  expect(failure).toMatchObject({ code: 'WORKER_TASK_INVALID', outcome: 'not-started' });
  expect(String(failure)).not.toContain('PRIVATE_INPUT'); expect(runs).toBe(0);
});

test('catalog fingerprint is portable by name/version and forged/duplicate definitions are rejected', () => {
  const make = (name: string) => defineWorkerTask({ name, version: '1', parseInput: value => value,
    parseOutput: value => value, run: value => value });
  const a = make('alpha'), b = make('beta');
  expect(new WorkerTaskCatalog([a, b]).fingerprint).toBe(new WorkerTaskCatalog([b, a]).fingerprint);
  expect(() => new WorkerTaskCatalog([a, a])).toThrow();
  expect(() => new WorkerTaskCatalog([{ ...a }])).toThrow();
});
