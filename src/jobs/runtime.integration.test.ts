/** Real file/WAL, SYSTEM admission coordinator and isolated Fabric actors. Synthetic identities/state only. */
import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { rename } from 'node:fs/promises';
import { join } from 'node:path';
import { applicationServiceDataScope, trustedSystemServiceDataScope, serviceDataScopeKey, type ServiceDataScope } from '../auth/service-data-scope';
import { installAuthAuthorityRevision } from '../auth/auth-authority-revision';
import { AuthorityCommitCoordinator } from '../databases/authority-commit-coordinator';
import { DatabaseActorAuthorityContext } from '../databases/database-actor-authority-context';
import { createReactiveDB } from '../sync/reactive-db';
import { ownedWorkerFixture } from '../workers/test-support/owned-fixture';
import { JobsRuntime } from './runtime';
import { resolveJobsPersistenceConfig } from './persistence-config';
import { inspectJobsOwnerSchema } from './owner-schema';

async function fixture() {
  const owned = await ownedWorkerFixture('jobs-runtime'), systemPath = join(owned.root, 'system.sqlite');
  let system: ReturnType<typeof createReactiveDB> | null = null, coordinator: AuthorityCommitCoordinator | null = null, runtime: JobsRuntime | null = null;
  try {
    system = createReactiveDB({ mode: 'file', path: systemPath }); installAuthAuthorityRevision(system);
    coordinator = new AuthorityCommitCoordinator(); const actorContext = new DatabaseActorAuthorityContext(system, systemPath);
    const config = resolveJobsPersistenceConfig({ rootDirectory: 'jobs', maxActiveDatabases: 2 }, owned.root);
    expect(existsSync(config.rootDirectory)).toBe(false); expect(inspectJobsOwnerSchema(system)).toBe('missing');
    const options = { config, system, installAllowed: true, authority: { coordinator, actorContext } };
    runtime = await JobsRuntime.open(options);
    return { root: owned.root, system, options, get runtime() { if (!runtime) throw new Error('Synthetic jobs runtime is stopped.'); return runtime; },
      async stop() { if (runtime) { await runtime.close(); runtime = null; } },
      async restart(installAllowed = true) { if (runtime) await runtime.close(); runtime = null; runtime = await JobsRuntime.open({ ...options, installAllowed }); },
      async close() { if (runtime) { await runtime.close(); runtime = null; } await coordinator!.close(); system!.dispose(); await owned.cleanup(); },
    };
  } catch (error) {
    if (runtime) await runtime.close(); if (coordinator) await coordinator.close(); system?.dispose(); await owned.cleanup(); throw error;
  }
}
const clock = Date.parse('2026-12-01T00:00:00Z');
const actor = (scope: ServiceDataScope) => ({ scopeId: serviceDataScopeKey(scope), userId: 'synthetic-user', principal: 'synthetic-session', manageAll: false });
const create = (scope: ServiceDataScope, id = 'schedule-one') => ({ actor: actor(scope), requestId: 'create-' + id, now: clock,
  admission: { id, scopeId: serviceDataScopeKey(scope), actorId: 'synthetic-user', principal: 'synthetic-session', definition: 'synthetic.report',
    definitionVersion: '1', definitionHash: 'a'.repeat(64), workflow: { name: 'synthetic.report', version: 1, definitionId: 'one', versionId: 'one-v1', fingerprint: 'b'.repeat(64) },
    input: { private: 'NEVER_BROADCAST' }, timing: { kind: 'once', at: new Date(clock + 60_000).toISOString() }, overlap: 'skip', runAs: 'actor' },
  seal: { authorityJson: '{"synthetic":true}', authorityMac: 'c'.repeat(64) } });

test('private runtime retains scoped files and receipts across restart with independent concurrent Fabric writes', async () => {
  const f = await fixture(), scopes = [applicationServiceDataScope(), trustedSystemServiceDataScope({ scopeKind: 'tenant', tenantId: 'synthetic' })];
  try {
    await Promise.all(scopes.map(scope => f.runtime.write(scope, 'jobs.schedule.create', create(scope), 'create-one', () => {})));
    await Promise.all(scopes.flatMap(scope => Array.from({ length: 4 }, (_, n) => f.runtime.write(scope, 'jobs.schedule.create', create(scope, 'schedule-' + n), 'create-' + n, () => {}))));
    expect(f.system.prepare('SELECT count(*) AS n FROM _jobs_owners WHERE established=1').get()).toEqual({ n: 2 });
    expect(f.runtime.retainedScopes().map(serviceDataScopeKey).sort()).toEqual(['application', 'tenant:synthetic']);
    await f.restart(false);
    for (const scope of scopes) {
      const page = await f.runtime.read<{ total: number }>(scope, 'jobs.schedules', { actor: actor(scope) }, () => {});
      expect(page.total).toBe(5);
      expect(await f.runtime.read(scope, 'jobs.receipt', { actor: actor(scope), requestId: 'create-schedule-one' }, () => {})).toMatchObject({ id: 'schedule-one', revision: 1 });
    }
    await expect(f.runtime.read(scopes[0]!, 'jobs.schedules', { actor: actor(scopes[1]!) }, () => {})).rejects.toMatchObject({ code: 'JOBS_STATE_INVALID' });
  } finally { await f.close(); }
}, 120_000);

test('missing established storage and changed roots require recovery rather than empty replacement', async () => {
  const f = await fixture(), scope = applicationServiceDataScope(); let moved = false;
  try {
    await f.runtime.write(scope, 'jobs.schedule.create', create(scope), 'create-one', () => {}); await f.stop();
    await expect(JobsRuntime.open({ ...f.options, config: { ...f.options.config, rootDirectory: join(f.root, 'different-jobs') } })).rejects.toMatchObject({ code: 'JOBS_STATE_INVALID' });
    await rename(f.options.config.rootDirectory, join(f.root, 'retained-jobs')); moved = true;
    await expect(JobsRuntime.open(f.options)).rejects.toMatchObject({ code: 'JOBS_STATE_INVALID' });
    await rename(join(f.root, 'retained-jobs'), f.options.config.rootDirectory); moved = false;
    await f.restart(false);
    expect(await f.runtime.read(scope, 'jobs.schedule', { actor: actor(scope), id: 'schedule-one' }, () => {})).toMatchObject({ id: 'schedule-one', revision: 1 });
  } finally {
    if (moved) await rename(join(f.root, 'retained-jobs'), f.options.config.rootDirectory);
    await f.close();
  }
}, 120_000);

test('revoked/async admission cannot provision owners and shutdown rejects new work', async () => {
  const f = await fixture(), scope = applicationServiceDataScope();
  try {
    await expect(f.runtime.write(scope, 'jobs.schedule.create', create(scope), 'async-denied', async () => {})).rejects.toMatchObject({ code: 'JOBS_CONFIG_INVALID' });
    await expect(f.runtime.read(scope, 'jobs.schedules', { actor: actor(scope) }, () => { throw new Error('Synthetic authority retired'); })).rejects.toThrow('Synthetic authority retired');
    expect(f.system.prepare('SELECT count(*) AS n FROM _jobs_owners').get()).toEqual({ n: 0 });
    const closed = f.runtime; await f.stop();
    await expect(closed.read(scope, 'jobs.schedules', { actor: actor(scope) }, () => {})).rejects.toMatchObject({ code: 'JOBS_NOT_READY' });
  } finally { await f.close(); }
}, 120_000);

test('live hints are scope/owner specific and idle reads, no-op controls and request replays do not generate changes', async () => {
  const f = await fixture(), scope = applicationServiceDataScope(), other = trustedSystemServiceDataScope({ scopeKind: 'tenant', tenantId: 'other' });
  let notices = 0, peerNotices = 0;
  const remove = f.runtime.subscribe(scope, () => { notices++; }, { ownerId: 'synthetic-user' });
  const removePeer = f.runtime.subscribe(scope, () => { peerNotices++; }, { ownerId: 'other-user' });
  try {
    await f.runtime.write(other, 'jobs.schedule.create', create(other), 'other-create', () => {}); expect(notices).toBe(0);
    await f.runtime.write(scope, 'jobs.schedule.create', create(scope), 'create-one', () => {});
    expect(notices).toBe(1); expect(peerNotices).toBe(0);
    await f.runtime.write(scope, 'jobs.schedule.create', create(scope), 'create-one', () => {}); expect(notices).toBe(1);
    await f.runtime.write(scope, 'jobs.schedule.create', create(scope), 'different-transport-replay', () => {}); expect(notices).toBe(1);
    await f.runtime.read(scope, 'jobs.schedules', { actor: actor(scope) }, () => {}); expect(notices).toBe(1);
    const pause = { actor: actor(scope), id: 'schedule-one', requestId: 'pause', expectedRevision: 1, action: 'pause', now: clock + 1 };
    await f.runtime.write(scope, 'jobs.schedule.change', pause, 'pause-one', () => {}); expect(notices).toBe(2);
    await f.runtime.write(scope, 'jobs.schedule.change', { ...pause, requestId: 'pause-again', expectedRevision: 2 }, 'pause-again', () => {}); expect(notices).toBe(2);
    remove(); await f.stop(); expect(notices).toBe(2);
  } finally { remove(); removePeer(); await f.close(); }
}, 120_000);

test('indexed wake discovery sleeps future/idle scopes and preserves due discovery across restart', async () => {
  const f = await fixture(), scope = applicationServiceDataScope();
  try {
    await f.runtime.write(scope, 'jobs.schedule.create', create(scope), 'future-create', () => {});
    expect(f.runtime.dueScopes(clock, 2)).toEqual([]);
    expect(f.runtime.dueScopes(clock + 60_000, 2).map(serviceDataScopeKey)).toEqual(['application']);
    await f.restart(false);
    expect(f.runtime.dueScopes(clock, 2)).toEqual([]);
    expect(f.runtime.dueScopes(clock + 60_000, 2).map(serviceDataScopeKey)).toEqual(['application']);
    await f.runtime.write(scope, 'jobs.schedule.change', { actor: actor(scope), id: 'schedule-one', requestId: 'pause-idle', expectedRevision: 1, action: 'pause', now: clock }, 'pause-idle', () => {});
    expect(f.system.prepare('SELECT wake_at FROM _jobs_owners').get()).toEqual({ wake_at: null });
    await f.runtime.read(scope, 'jobs.schedules', { actor: actor(scope) }, () => {});
    expect(f.runtime.dueScopes(clock + 60_000, 2)).toEqual([]);
    expect(f.system.prepare('SELECT wake_at FROM _jobs_owners').get()).toEqual({ wake_at: null });
    const tenants = ['keyset-a', 'keyset-b'].map(tenantId => trustedSystemServiceDataScope({ scopeKind: 'tenant', tenantId }));
    for (const target of [scope, ...tenants]) await f.runtime.write(target, 'jobs.schedule.create', create(target, 'keyset'), 'create-keyset', () => {});
    const first = f.runtime.dueScopePage(clock + 60_000, 1), second = f.runtime.dueScopePage(clock + 60_000, 1, first[0]!.cursor);
    const third = f.runtime.dueScopePage(clock + 60_000, 1, second[0]!.cursor);
    expect([first, second, third].flat().map(entry => serviceDataScopeKey(entry.scope)).sort()).toEqual(['application', 'tenant:keyset-a', 'tenant:keyset-b']);
    expect(f.runtime.dueScopePage(clock + 60_000, 1, third[0]!.cursor)).toEqual([]);
    const plan = JSON.stringify(f.system.prepare('EXPLAIN QUERY PLAN SELECT * FROM _jobs_owners WHERE established=1 AND wake_at<=? AND (wake_at,id)>(?,?) ORDER BY wake_at,id LIMIT ?')
      .all(clock + 60_000, first[0]!.cursor.wakeAt, first[0]!.cursor.id, 1));
    expect(plan).toContain('jobs_owner_due'); expect(plan).not.toContain('TEMP B-TREE');
  } finally { await f.close(); }
}, 120_000);
