/** Real file-fence admission: wait before SQLite, never replay the operation. */
import { expect, test } from 'bun:test';
import { mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installAuthAuthorityRevision } from '../auth/auth-authority-revision';
import { defineAuthTables } from '../auth/auth-schema';
import { createReactiveDB } from '../sync/reactive-db';
import { withReactiveDBCommitAdmission } from '../sync/reactive-db-commit-admission';
import { AuthorityCommitCoordinator } from './authority-commit-coordinator';
import { registerApplicationAuthorityCommitGuard } from './database-application-authority-commit-guard';
import { databaseAuthorityCommitFencePath, DatabaseAuthorityCommitFileFence } from './database-authority-commit-file-fence';
import { registerDatabaseAuthorityCommitGuard } from './database-authority-commit-guard';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'zero-authority-file-admission-'));
  const path = join(root, 'system.db');
  const system = createReactiveDB({ mode: 'file', path });
  const app = createReactiveDB({ mode: 'memory' });
  defineAuthTables(system);
  system.insert('users', { user_id: 'user-a', username: 'user-a', email: 'a@example.test',
    role: 'user', status: 'active', created_at: Date.now() });
  installAuthAuthorityRevision(system);
  app.defineTable('notes', { note_id: 'text primary key' });
  const coordinator = new AuthorityCommitCoordinator();
  const local = new DatabaseAuthorityCommitFileFence(path);
  const remote = new DatabaseAuthorityCommitFileFence(path);
  const remove = registerDatabaseAuthorityCommitGuard(system, coordinator, local);
  const removeApp = registerApplicationAuthorityCommitGuard(app, system, coordinator, local);
  return { path, system, app, coordinator, local, remote, remove,
    async close() { removeApp(); remove(); remote.close(); local.close(); await coordinator.close(); app.dispose(); system.dispose(); rmSync(root, { recursive: true, force: true }); } };
}

test('cross-process shared work delays admission before SQLite, then commits and projects exactly once', async () => {
  const h = fixture(), shared = h.remote.tryAcquireShared()!;
  let mutations = 0, projections = 0;
  const pending = withReactiveDBCommitAdmission(h.system, () => h.system.transaction(() => {
    mutations++;
    h.system.update('users', 'user-a', { role: 'admin' });
    h.system.afterCommitFence(() => { projections++; h.app.insert('notes', { note_id: 'projected' }); });
    return 'accepted';
  }));
  try {
    await Bun.sleep(20);
    expect(h.coordinator.diagnostics().activeExclusive).toBe(true);
    expect(h.system.getRawDatabase().inTransaction).toBe(false);
    expect(mutations).toBe(0);
    shared.release();
    expect(await pending).toBe('accepted');
    expect(mutations).toBe(1);
    expect(projections).toBe(1);
    expect(h.app.get('notes', 'projected')).not.toBeNull();
    expect(h.system.get('users', 'user-a')!.role).toBe('admin');
    expect(h.coordinator.diagnostics()).toMatchObject({ activeExclusive: false, activeShared: 0 });
  } finally { shared.release(); await h.close(); }
});

test('file-fence timeout, cancellation and retired registration never execute or replay an operation', async () => {
  for (const mode of ['timeout', 'cancel', 'retire'] as const) {
    const h = fixture(), shared = h.remote.tryAcquireShared()!;
    const abort = new AbortController();
    let mutations = 0;
    const pending = withReactiveDBCommitAdmission(h.system, () => { mutations++; }, { timeoutMs: 50, signal: abort.signal })
      .catch(error => error);
    try {
      await Bun.sleep(10);
      if (mode === 'cancel') abort.abort();
      if (mode === 'retire') h.remove();
      expect(await pending).toMatchObject({ code: mode === 'retire' ? 'DATABASE_CLOSED' : 'DATABASE_CONFLICT' });
      shared.release();
      await Bun.sleep(10);
      expect(mutations).toBe(0);
      const free = h.local.tryAcquireExclusive()!;
      expect(free).not.toBeNull(); free.release();
    } finally { shared.release(); await h.close(); }
  }
});

test('local queue wait and cross-process wait share one deadline rather than each spending a new budget', async () => {
  const h = fixture(), local = await h.coordinator.acquireShared(), remote = h.remote.tryAcquireShared()!;
  let mutations = 0;
  const started = performance.now();
  const pending = withReactiveDBCommitAdmission(h.system, () => { mutations++; }, { timeoutMs: 100 }).catch(error => error);
  try {
    await Bun.sleep(65); local.release();
    expect(await pending).toMatchObject({ code: 'DATABASE_CONFLICT' });
    expect(performance.now() - started).toBeLessThan(150);
    expect(mutations).toBe(0);
  } finally { local.release(); remote.release(); await h.close(); }
});

test('the admitted operation still rejects authority changed while waiting', async () => {
  const h = fixture(), shared = h.remote.tryAcquireShared()!;
  let mutations = 0;
  const pending = withReactiveDBCommitAdmission(h.system, () => h.system.transaction(() => {
    if (h.system.get('users', 'user-a')!.status !== 'active') throw new Error('synthetic authority revoked');
    mutations++;
    h.system.update('users', 'user-a', { role: 'admin' });
  })).catch(error => error);
  try {
    await Bun.sleep(10);
    // Independent SYSTEM authority changing during the wait, not after commit.
    h.system.prepare("UPDATE users SET status = 'suspended' WHERE user_id = 'user-a'").run();
    shared.release();
    expect((await pending).message).toBe('synthetic authority revoked');
    expect(mutations).toBe(0);
    expect(h.system.get('users', 'user-a')!.role).toBe('user');
  } finally { shared.release(); await h.close(); }
});

test('file-turn ownership does not authorize an application write against uncommitted Guardian state', async () => {
  const h = fixture();
  try {
    await expect(withReactiveDBCommitAdmission(h.system, () => h.system.transaction(() => {
      h.system.update('users', 'user-a', { role: 'admin' });
      h.app.insert('notes', { note_id: 'premature' });
    }))).rejects.toMatchObject({ code: 'DATABASE_AUTHORITY_CHANGED', outcome: 'not-committed' });
    expect(h.system.get('users', 'user-a')!.role).toBe('user');
    expect(h.app.get('notes', 'premature')).toBeNull();
  } finally { await h.close(); }
});

test('replaced file identity fails closed during waiting without running a write', async () => {
  const h = fixture(), shared = h.remote.tryAcquireShared()!;
  let mutations = 0;
  const pending = withReactiveDBCommitAdmission(h.system, () => { mutations++; }).catch(error => error);
  try {
    await Bun.sleep(10);
    const path = databaseAuthorityCommitFencePath(h.path);
    renameSync(path, `${path}.displaced`); writeFileSync(path, '');
    expect(await pending).toMatchObject({ code: 'DATABASE_OPEN_FAILED', retryable: false });
    expect(mutations).toBe(0);
  } finally { shared.release(); await h.close(); }
});

test('a final borrowed guard still rechecks file identity and rolls back without replay', async () => {
  const h = fixture();
  let calls = 0;
  try {
    await expect(withReactiveDBCommitAdmission(h.system, () => h.system.transaction(() => {
      calls++;
      h.system.update('users', 'user-a', { role: 'admin' });
      const path = databaseAuthorityCommitFencePath(h.path);
      renameSync(path, `${path}.displaced`); writeFileSync(path, '');
    }))).rejects.toMatchObject({ code: 'DATABASE_OPEN_FAILED', retryable: false, outcome: 'not-committed' });
    expect(calls).toBe(1);
    expect(h.system.get('users', 'user-a')!.role).toBe('user');
  } finally { await h.close(); }
});
