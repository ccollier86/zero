/** Native extension responses retain outcomes but never repeat raw authored errors. No listener or database. */
import { expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { applyServerExtensionErrorHandler } from '../frontend/server/server-extension-error-handler';
import { WorkerError, type WorkerErrorCode } from './worker-error';

test('worker HTTP failures distinguish capacity, invalid input and unknown execution without enabling unsafe retry', async () => {
  const cases: [WorkerErrorCode, 'not-started' | 'unknown', number, boolean][] = [
    ['WORKER_CAPACITY', 'not-started', 429, true], ['WORKER_QUEUE_TIMEOUT', 'not-started', 503, true],
    ['WORKER_TASK_INVALID', 'not-started', 422, false], ['WORKER_EXECUTION_TIMEOUT', 'unknown', 504, false],
    ['WORKER_AUTHORITY_CHANGED', 'unknown', 503, false], ['WORKER_PROCESS_FAILED', 'unknown', 500, false],
  ];
  const app = applyServerExtensionErrorHandler(new Elysia()).get('/worker/:case', ({ params }) => {
    const [code, outcome] = cases[Number(params.case)]!;
    throw new WorkerError(code, 'PRIVATE_TASK_EXCEPTION_VALUE', outcome);
  }).compile();
  for (const [index, [code, outcome, status, retryable]] of cases.entries()) {
    const response = await app.handle(new Request('http://localhost/worker/' + index));
    expect(response.status).toBe(status); const body = await response.json() as { retryable?: boolean };
    expect(body).toMatchObject({ code, outcome }); expect(body.retryable === true).toBe(retryable);
    expect(JSON.stringify(body)).not.toContain('PRIVATE_TASK_EXCEPTION_VALUE');
  }
});
