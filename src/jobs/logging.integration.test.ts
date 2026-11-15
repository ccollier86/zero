/** Real private source transaction, supervised logging worker and Fabric investigator. No live identities/providers. */
import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { createReactiveDB } from '../sync/reactive-db';
import { installAuthAuthorityRevision } from '../auth/auth-authority-revision';
import { applicationServiceDataScope } from '../auth/service-data-scope';
import { AuthorityCommitCoordinator } from '../databases/authority-commit-coordinator';
import { DatabaseActorAuthorityContext } from '../databases/database-actor-authority-context';
import { ownedWorkerFixture } from '../workers/test-support/owned-fixture';
import { LoggingRuntime } from '../logging/logging-runtime';
import { resolveManagedLoggingConfig } from '../logging/logging-managed-config';
import { runWithLoggingAttribution } from '../logging/logging-attribution';
import { loggingContext } from '../logging/test-support/logging-fixture';
import { configureObservability } from '../observability';
import { resolveJobsPersistenceConfig } from './persistence-config';
import { JobsRuntime } from './runtime';
import { installJobsLogging } from './logging';

test('schedule controls append private attributed evidence once; replay, idle reads and occurrence leases add no audit rows', async () => {
  const owned = await ownedWorkerFixture('jobs-logging');
  let logging: LoggingRuntime | null = null, runtime: JobsRuntime | null = null, system: ReturnType<typeof createReactiveDB> | null = null, authority: AuthorityCommitCoordinator | null = null;
  try {
    const policy = resolveManagedLoggingConfig({ rootDirectory: join(owned.root, 'logs'), preset: 'activity' }, owned.root);
    if (!policy) throw new Error('Synthetic logging was not configured.');
    logging = await LoggingRuntime.open(policy, configureObservability(false));
    const systemPath = join(owned.root, 'system.sqlite');
    system = createReactiveDB({ mode: 'file', path: systemPath }); installAuthAuthorityRevision(system);
    authority = new AuthorityCommitCoordinator(); const coordinator = authority;
    runtime = await JobsRuntime.open({ config: resolveJobsPersistenceConfig({ rootDirectory: 'jobs' }, owned.root), system, installAllowed: true,
      authority: { coordinator, actorContext: new DatabaseActorAuthorityContext(system, systemPath) }, source: owner => installJobsLogging(logging!, owner, coordinator) });
    const scope = applicationServiceDataScope(), actor = { scopeId: 'application', userId: 'synthetic-owner', principal: 'synthetic-session', manageAll: false };
    const context = { ...loggingContext(null), policyVersion: policy.policyVersion, actor: { kind: 'user' as const, id: actor.userId, sessionId: actor.principal, initiatorId: null } };
    const now = Date.now();
    const create = (id: string, at: number) => ({ actor, requestId: 'create-' + id, now,
      admission: { id, scopeId: 'application', actorId: actor.userId, principal: actor.principal, definition: 'synthetic.report', definitionVersion: '1', definitionHash: 'a'.repeat(64),
        workflow: { name: 'synthetic.report', version: 1, definitionId: 'one', versionId: 'one-v1', fingerprint: 'b'.repeat(64) },
        input: { private: 'NEVER_CAPTURE_JOB_PAYLOAD' }, timing: { kind: 'once', at: new Date(at).toISOString() }, overlap: 'skip', runAs: 'actor' },
      seal: { authorityJson: 'NEVER_CAPTURE_AUTHORITY', authorityMac: 'c'.repeat(64) } });
    const write = (name: string, input: unknown) => runWithLoggingAttribution(logging!, context, () => {}, () => runtime!.write(scope, name, input, crypto.randomUUID(), () => {}));
    await write('jobs.schedule.create', create('first', now + 60_000));
    await write('jobs.schedule.create', create('first', now + 60_000));
    const pause = { actor, requestId: 'pause-first', id: 'first', expectedRevision: 1, action: 'pause', now };
    await write('jobs.schedule.change', pause); await write('jobs.schedule.change', pause);
    await write('jobs.schedule.create', create('second', now));
    await write('jobs.materialize', { scopeId: 'application', id: 'second', expectedRevision: 1, now });
    const pending = await runtime.read<{ id: string }[]>(scope, 'jobs.pending', { scopeId: 'application', now }, () => {});
    expect(pending).toHaveLength(1);
    await write('jobs.claim', { scopeId: 'application', id: pending[0]!.id, nonce: 'synthetic-claim', leaseMs: 1000, now });
    await runtime.read(scope, 'jobs.schedules', { actor }, () => {});
    const deadline = Date.now() + 20_000;
    let page = await logging.page('audit', { kind: 'application' });
    while (page.events.length < 3 && Date.now() < deadline) { await Bun.sleep(25); page = await logging.page('audit', { kind: 'application' }); }
    expect(page.events).toHaveLength(3);
    expect(page.events.every(row => row.event.actor.id === actor.userId)).toBe(true);
    expect(page.events.map(row => row.event.action).sort()).toEqual(['record.created', 'record.created', 'record.updated']);
    expect(page.events.find(row => row.event.action === 'record.updated')!.event.detail).toMatchObject({ kind: 'record-change', table: 'job_schedules', changes: expect.arrayContaining([
      { field: 'control', kind: 'value', beforePresent: true, afterPresent: true, before: 'active', after: 'paused' },
    ]) });
    expect(JSON.stringify(page)).not.toContain('NEVER_CAPTURE'); expect(JSON.stringify(page)).not.toContain('authority_json');
  } finally {
    if (runtime) await runtime.close(); if (logging) await logging.close(); if (authority) await authority.close(); system?.dispose(); await owned.cleanup();
  }
}, 120_000);
