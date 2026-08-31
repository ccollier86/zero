import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import { defineAuthTables } from './auth-schema';
import { AuthEmailOutboxStore } from './auth-email-outbox-store';

describe('AuthEmailOutboxStore', () => {
  test('deduplicates, caps, leases, scrubs, and expires terminal jobs', () => {
    const db = prepareDb();
    const store = new AuthEmailOutboxStore(db, 'worker-a');
    try {
      expect(store.enqueue(request('one@test.com'), 100, 1_000, 1, 10)).toBe('enqueued');
      expect(store.enqueue(request('one@test.com'), 101, 1_000, 1, 10)).toBe('duplicate');
      expect(store.enqueue(request('two@test.com'), 101, 1_000, 1, 10)).toBe('capacity');
      const job = store.claim(100, 50)!;
      expect(job).toMatchObject({ recipient: 'one@test.com', attempts: 1 });
      expect(store.complete(job, 'delivered', 110)).toBe(true);
      expect(db.prepare(`SELECT recipient, native_continuation FROM _auth_email_outbox
        WHERE job_id = ?`).get(job.jobId)).toEqual({
        recipient: '', native_continuation: null,
      });
      expect(store.enqueue(request('one@test.com'), 200, 1_000, 1, 10)).toBe('duplicate');
      expect(store.enqueue(request('stored-cap@test.com'), 200, 1_000, 1, 1)).toBe('capacity');
      expect(store.enqueue(request('one@test.com'), 1_101, 1_000, 1, 10)).toBe('enqueued');
      expect(store.cleanup(111)).toBe(1);
    } finally { db.dispose(); }
  });

  test('recovers an expired processing lease with its attempt count', () => {
    const db = prepareDb();
    const store = new AuthEmailOutboxStore(db, 'worker-a');
    try {
      store.enqueue(request('lease@test.com'), 100, 1_000, 10, 100);
      expect(store.claim(100, 50)?.attempts).toBe(1);
      expect(store.recoverExpired(149)).toBe(0);
      expect(store.recoverExpired(150)).toBe(1);
      expect(store.claim(150, 50)?.attempts).toBe(2);
    } finally { db.dispose(); }
  });

  for (const mode of ['file', 'hot'] as const) {
    test(`survives a graceful ${mode}-mode restart`, async () => {
      const dir = await mkdtemp(join(tmpdir(), `zero-auth-outbox-${mode}-`));
      const path = join(dir, 'app.db');
      const snapshotPath = join(dir, 'app.snapshot.db');
      try {
        let db = prepareDb({ mode, path, snapshotPath, snapshotIntervalMs: 60_000 });
        new AuthEmailOutboxStore(db, 'first')
          .enqueue(request(`${mode}@test.com`), 100, 1_000, 10, 100);
        db.dispose();
        db = prepareDb({ mode, path, snapshotPath, snapshotIntervalMs: 60_000 });
        expect(new AuthEmailOutboxStore(db, 'second').claim(100, 50)?.recipient)
          .toBe(`${mode}@test.com`);
        db.dispose();
      } finally { await rm(dir, { recursive: true, force: true }); }
    });
  }
});

function request(recipient: string) {
  return { kind: 'password_reset' as const, recipient, nativeContinuation: '/native' };
}

function prepareDb(config: Parameters<typeof createReactiveDB>[0] = { mode: 'memory' }): ReactiveDB {
  const db = createReactiveDB(config);
  defineAuthTables(db);
  return db;
}
