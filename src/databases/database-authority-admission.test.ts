import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { defineAuthTables } from '../auth/auth-schema';
import { installAuthAuthorityRevision } from '../auth/auth-authority-revision';
import { createReactiveDB } from '../sync/reactive-db';
import { withReactiveDBCommitAdmission } from '../sync/reactive-db-commit-admission';
import { AuthorityCommitCoordinator } from './authority-commit-coordinator';
import { registerDatabaseAuthorityCommitGuard } from './database-authority-commit-guard';
import { DatabaseAuthorityCommitFileFence } from './database-authority-commit-file-fence';

async function fixture() {
  const scratch = Bun.env.PROJECT_SCRATCH_DIR ?? tmpdir();
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(join(scratch, 'auth-admission-'));
  const path = join(root, 'system.db');
  const db = createReactiveDB({ mode: 'file', path });
  defineAuthTables(db);
  db.insert('users', { user_id: 'u', username: 'u', email: 'u@example.test', role: 'user', status: 'active', created_at: Date.now() });
  installAuthAuthorityRevision(db);
  const coordinator = new AuthorityCommitCoordinator({ maxPending: 2 });
  const fence = new DatabaseAuthorityCommitFileFence(path);
  const remove = registerDatabaseAuthorityCommitGuard(db, coordinator, fence);
  return { db, path, coordinator, remove, async close() { remove(); await coordinator.close(); fence.close(); db.dispose(); await rm(root, { recursive: true, force: true }); } };
}

test('fair auth admission waits outside SQLite and later readers cannot barge', async () => {
  const h = await fixture(), order: string[] = [];
  const shared = await h.coordinator.acquireShared();
  const other = new Database(h.path, { strict: true });
  try {
    const pending = withReactiveDBCommitAdmission(h.db, () => {
      order.push('auth');
      h.db.transaction(() => h.db.prepare('UPDATE users SET role = ? WHERE user_id = ?').run('admin', 'u'));
    });
    const later = h.coordinator.acquireShared().then(lease => { order.push('reader'); lease.release(); });
    expect(h.coordinator.diagnostics()).toMatchObject({ pendingExclusive: 1, pendingShared: 1 });
    other.run('BEGIN IMMEDIATE');
    other.run('ROLLBACK');
    expect(order).toEqual([]);
    shared.release();
    await pending; await later;
    expect(order).toEqual(['auth', 'reader']);
    expect(h.db.prepare('SELECT role FROM users WHERE user_id = ?').get('u')).toEqual({ role: 'admin' });
  } finally { shared.release(); other.close(); await h.close(); }
});

test('timeout and cancellation never execute a queued auth transaction or leak priority', async () => {
  const h = await fixture(), shared = await h.coordinator.acquireShared();
  let calls = 0;
  try {
    await expect(withReactiveDBCommitAdmission(h.db, () => ++calls, { timeoutMs: 10 }))
      .rejects.toMatchObject({ code: 'DATABASE_CONFLICT', retryable: true, outcome: 'not-committed' });
    const controller = new AbortController();
    const pending = withReactiveDBCommitAdmission(h.db, () => ++calls, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'DATABASE_CONFLICT' });
    expect(calls).toBe(0);
    expect(h.coordinator.diagnostics()).toMatchObject({ pendingExclusive: 0, pendingShared: 0 });
  } finally { shared.release(); await h.close(); }
});

test('admission retains the cross-process final fence and rolls back a real unresolved race', async () => {
  const h = await fixture(), competing = new DatabaseAuthorityCommitFileFence(h.path);
  const shared = competing.tryAcquireShared()!;
  try {
    await expect(withReactiveDBCommitAdmission(h.db, () => {
      h.db.transaction(() => h.db.prepare('UPDATE users SET role = ? WHERE user_id = ?').run('admin', 'u'));
    })).rejects.toMatchObject({ code: 'DATABASE_CONFLICT', retryable: true, outcome: 'not-committed' });
    expect(h.db.prepare('SELECT role FROM users WHERE user_id = ?').get('u')).toEqual({ role: 'user' });
    expect(h.coordinator.diagnostics()).toMatchObject({ activeExclusive: false, activeShared: 0 });
  } finally { shared.release(); competing.close(); await h.close(); }
});

test('removing admission while it waits prevents a late write', async () => {
  const h = await fixture(), shared = await h.coordinator.acquireShared();
  let calls = 0;
  try {
    const pending = withReactiveDBCommitAdmission(h.db, () => ++calls);
    h.remove(); shared.release();
    await expect(pending).rejects.toMatchObject({ code: 'DATABASE_CLOSED' });
    expect(calls).toBe(0);
  } finally { shared.release(); await h.close(); }
});

test('a full admission queue fails safely and a throwing commit releases ownership', async () => {
  const h = await fixture(), shared = await h.coordinator.acquireShared();
  let calls = 0;
  try {
    const earlier = [0, 1].map(() => withReactiveDBCommitAdmission(h.db, () => ++calls));
    await expect(withReactiveDBCommitAdmission(h.db, () => ++calls))
      .rejects.toMatchObject({ code: 'DATABASE_CONFLICT', retryable: true, outcome: 'not-committed' });
    expect(calls).toBe(0);
    shared.release();
    expect(await Promise.all(earlier)).toEqual([1, 2]);
    const failure = new Error('synthetic commit failure');
    await expect(withReactiveDBCommitAdmission(h.db, () => { throw failure; })).rejects.toBe(failure);
    expect(h.coordinator.diagnostics()).toMatchObject({ activeExclusive: false, pendingExclusive: 0 });
    // Neither admission nor its final guard inherits the failed callback's turn.
    const next = await h.coordinator.acquireShared();
    try {
      expect(() => h.db.transaction(() => {
        h.db.prepare('UPDATE users SET role = ? WHERE user_id = ?').run('admin', 'u');
      })).toThrow(expect.objectContaining({ code: 'DATABASE_CONFLICT' }));
    } finally { next.release(); }
  } finally { shared.release(); await h.close(); }
});
