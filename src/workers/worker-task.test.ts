/** Pure contract checks; no files, processes or providers are opened. */
import { expect, test } from 'bun:test';
import { defineWorkerTask, WorkerTaskCatalog } from './worker-task';
import type { WorkerValue } from './worker-value';

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

for (const boundary of ['input', 'output'] as const) for (const pass of [1, 2]) {
  test(`${boundary} validators reject async results on canonical pass ${pass} without an unhandled rejection or then getter`, async () => {
    let calls = 0, thenReads = 0, runs = 0;
    const parse = (value: WorkerValue): unknown => {
      if (++calls !== pass) return value;
      const rejected = Promise.reject(new Error('PRIVATE_ASYNC_VALIDATOR_FAILURE'));
      Object.defineProperty(rejected, 'then', { get() { thenReads++; throw new Error('PRIVATE_THEN_GETTER'); } });
      return rejected;
    };
    const task = defineWorkerTask({ name: `async-${boundary}-${pass}`, version: '1',
      parseInput: boundary === 'input' ? parse : value => value,
      parseOutput: boundary === 'output' ? parse : value => value,
      run(value) { runs++; return value; },
    });
    let failure: unknown;
    try { if (boundary === 'input') task.parseInput(null); else task.parseOutput(null); }
    catch (error) { failure = error; }
    expect(failure).toMatchObject({ code: 'WORKER_TASK_INVALID', outcome: 'not-started' });
    expect(String(failure)).not.toContain('PRIVATE_'); expect(calls).toBe(pass); expect(runs).toBe(0);
    // An unconsumed rejection is a test failure after this turn, independently
    // of the returned synchronous error. The authored then getter stays inert.
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    expect(thenReads).toBe(0);
  });
}

test('validator thenables are rejected without inspecting or executing authored then access', () => {
  let thenReads = 0, thenCalls = 0;
  for (const result of [
    Object.defineProperty({}, 'then', { enumerable: true, get() { thenReads++; return () => { thenCalls++; }; } }),
    { then() { thenCalls++; } },
  ]) {
    const task = defineWorkerTask({ name: 'thenable', version: '1', parseInput: () => result, parseOutput: value => value, run: () => null });
    expect(() => task.parseInput(null)).toThrow(expect.objectContaining({ code: 'WORKER_TASK_INVALID' }));
  }
  expect(thenReads).toBe(0); expect(thenCalls).toBe(0);
});
