/** Actual request Jobs facade with memory-only native realm/Torrent; no files or providers. */
import { expect, test } from 'bun:test';
import { memorySourceJobsFixture } from './test-support/memory-source-fixture';
import { JobsError } from './error';
import { DatabaseError } from '../databases/database-error';

test('an actor-owned schedule committed before caller cancellation reports unknown and reconciles its original receipt', async () => {
  const abort = new AbortController();
  const f = await memorySourceJobsFixture({ afterWrite(operation) { if (operation.name === 'jobs.schedule.create') abort.abort(); } });
  try {
    const request = f.request();
    await expect(request.schedules.create({ definition: f.requestDefinition, input: { value: 1 },
      timing: { kind: 'once', at: new Date(f.now() + 1000).toISOString(), maxLatenessMs: 60_000 } },
    { idempotencyKey: 'actor-postcommit-abort', signal: abort.signal })).rejects.toMatchObject({ code: 'JOBS_OUTCOME_UNKNOWN', outcome: 'unknown' });
    expect(await f.request().receipts.get('actor-postcommit-abort')).toMatchObject({ revision: 1, ownerId: 'synthetic-admin' });
    expect(f.commands.filter(operation => operation.name === 'jobs.schedule.create')).toHaveLength(1);
  } finally { await f.close(); }
});

for (const action of ['cancel', 'update'] as const) test('an actor-owned ' + action + ' committed before cancellation stays unknown with its exact receipt', async () => {
  const abort = new AbortController();
  const f = await memorySourceJobsFixture({ afterWrite(operation) { if (operation.name === 'jobs.schedule.change') abort.abort(); } });
  try {
    const request = f.request(), original = await request.schedules.create({ definition: f.requestDefinition, input: { value: 1 },
      timing: { kind: 'once', at: new Date(f.now() + 1000).toISOString(), maxLatenessMs: 60_000 } }, { idempotencyKey: 'original-actor-schedule' });
    const options = { expectedRevision: 1, idempotencyKey: action + '-postcommit-abort', signal: abort.signal };
    const operation = action === 'cancel' ? request.schedules.cancel(original.id, options)
      : request.schedules.update(original.id, { input: { value: 2 } }, options);
    await expect(operation).rejects.toMatchObject({ code: 'JOBS_OUTCOME_UNKNOWN', outcome: 'unknown' });
    expect(await f.request().receipts.get(options.idempotencyKey)).toMatchObject({ id: original.id, revision: 2,
      control: action === 'cancel' ? 'cancelled' : 'active', generation: action === 'cancel' ? 1 : 2 });
    expect(f.commands.filter(operation => operation.name === 'jobs.schedule.change')).toHaveLength(1);
  } finally { await f.close(); }
});

test('an actor request aborted before admission is known not-started and never opens private state', async () => {
  const f = await memorySourceJobsFixture();
  try {
    const abort = new AbortController(), reason = new JobsError('JOBS_NOT_READY'); abort.abort(reason);
    await expect(f.request().enqueue(f.requestDefinition, { value: 1 }, { idempotencyKey: 'never-started', signal: abort.signal })).rejects.toBe(reason);
    expect(f.stats().planes).toBe(0); expect(f.commands).toHaveLength(0);
  } finally { await f.close(); }
});

test('a proven actor revision rejection keeps its known outcome and does not append a command receipt', async () => {
  const f = await memorySourceJobsFixture();
  try {
    const request = f.request(), original = await request.enqueue(f.requestDefinition, { value: 1 }, { idempotencyKey: 'actor-original' });
    await expect(request.schedules.cancel(original.id, { expectedRevision: 2, idempotencyKey: 'wrong-revision' })).rejects.toMatchObject({ code: 'JOBS_REVISION_CONFLICT', outcome: 'not-started' });
    expect(await request.receipts.get('wrong-revision')).toBeNull();
    expect(f.commands.filter(operation => operation.name === 'jobs.schedule.change')).toHaveLength(0);
  } finally { await f.close(); }
});

test('a native database rejection before the actor write preserves its explicit non-commit evidence', async () => {
  const reason = new DatabaseError('DATABASE_BACKPRESSURE', 'Synthetic queue admission rejected.', { outcome: 'not-committed' });
  const f = await memorySourceJobsFixture({ beforeWrite(operation) { if (operation.name === 'jobs.schedule.create') throw reason; } });
  try {
    const request = f.request();
    await expect(request.enqueue(f.requestDefinition, { value: 1 }, { idempotencyKey: 'native-rejection' })).rejects.toBe(reason);
    expect(await request.receipts.get('native-rejection')).toBeNull();
    expect(f.commands.filter(operation => operation.name === 'jobs.schedule.create')).toHaveLength(0);
  } finally { await f.close(); }
});
