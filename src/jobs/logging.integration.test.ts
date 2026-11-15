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
import { DATABASE_ACTOR_OPERATIONS } from '../databases/database-actor-protocol';
import type { DeliverySourceRegistration } from '../logging/logging-delivery-protocol';
import type { ResolvedJobsPersistenceConfig } from './persistence-config';
import { JobsError } from './error';

test('schedule controls append private attributed semantic evidence once; replay, idle reads and occurrence leases add no audit rows', async () => {
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
    expect(page.events.map(row => row.event.action).sort()).toEqual(['jobs.schedule.created', 'jobs.schedule.created', 'jobs.schedule.paused']);
    expect(page.events.every(row => row.event.family === 'workflow' && row.event.evidence === 'server-confirmed')).toBe(true);
    expect(page.events.find(row => row.event.action === 'jobs.schedule.paused')!.event.metadata).toMatchObject({ previousControl: 'active', control: 'paused', revision: 2, generation: 1 });
    expect(JSON.stringify(page)).not.toContain('NEVER_CAPTURE'); expect(JSON.stringify(page)).not.toContain('authority_json');
  } finally {
    if (runtime) await runtime.close(); if (logging) await logging.close(); if (authority) await authority.close(); system?.dispose(); await owned.cleanup();
  }
}, 120_000);

test('a committed semantic command with retired post-reply authority wakes its idle source without replay or flushing', async () => {
  const owned = await ownedWorkerFixture('jobs-logging-unknown');
  let logging: LoggingRuntime | null = null, runtime: JobsRuntime | null = null, system: ReturnType<typeof createReactiveDB> | null = null, authority: AuthorityCommitCoordinator | null = null;
  const state = { armed: false, retired: false, committedReplies: 0 }, registration: { value: DeliverySourceRegistration | null } = { value: null };
  try {
    const policy = resolveManagedLoggingConfig({ rootDirectory: join(owned.root, 'logs'), preset: 'activity' }, owned.root);
    if (!policy) throw new Error('Synthetic logging was not configured.');
    const log = await LoggingRuntime.open(policy, configureObservability(false)); logging = log;
    const register = log.registerDeliverySource.bind(log);
    log.registerDeliverySource = port => { const source = register(port); registration.value = source; return source; };
    const systemPath = join(owned.root, 'system.sqlite'), db = createReactiveDB({ mode: 'file', path: systemPath }); system = db; installAuthAuthorityRevision(db);
    const coordinator = new AuthorityCommitCoordinator(); authority = coordinator;
    const base = resolveJobsPersistenceConfig({ rootDirectory: 'jobs' }, owned.root);
    const config: ResolvedJobsPersistenceConfig = { ...base, createExecutor(context) {
      const executor = base.createExecutor(context), execute = executor.execute.bind(executor);
      executor.execute = (async (request, options) => {
        const value = await execute(request, options);
        if (state.armed && request.operation === DATABASE_ACTOR_OPERATIONS.execute) {
          const operation = (request.payload as { operation?: { type?: string; name?: string } }).operation;
          if (operation?.type === 'command' && operation.name === 'jobs.schedule.change') {
            // This is the genuine actor reply after its source transaction committed,
            // not a fake accepted response or a guard retired before admission.
            state.committedReplies++; state.retired = true;
          }
        }
        return value;
      }) as typeof executor.execute;
      return executor;
    } };
    const jobs = await JobsRuntime.open({ config, system: db, installAllowed: true,
      authority: { coordinator, actorContext: new DatabaseActorAuthorityContext(db, systemPath) }, source: owner => installJobsLogging(log, owner, coordinator) }); runtime = jobs;
    const scope = applicationServiceDataScope(), actor = { scopeId: 'application', userId: 'synthetic-owner', principal: 'synthetic-session', manageAll: false };
    const context = { ...loggingContext(null), policyVersion: policy.policyVersion, actor: { kind: 'user' as const, id: actor.userId, sessionId: actor.principal, initiatorId: null } };
    const now = Date.now(), created = { actor, requestId: 'unknown-create', now,
      admission: { id: 'unknown-job', scopeId: 'application', actorId: actor.userId, principal: actor.principal, definition: 'synthetic.report', definitionVersion: '1', definitionHash: 'a'.repeat(64),
        workflow: { name: 'synthetic.report', version: 1, definitionId: 'one', versionId: 'one-v1', fingerprint: 'b'.repeat(64) },
        input: { private: 'NEVER_CAPTURE_UNCERTAIN_INPUT' }, timing: { kind: 'once', at: new Date(now + 60_000).toISOString() }, overlap: 'skip', runAs: 'actor' },
      seal: { authorityJson: 'NEVER_CAPTURE_UNCERTAIN_AUTHORITY', authorityMac: 'c'.repeat(64) } };
    await runWithLoggingAttribution(log, context, () => {}, () => jobs.write(scope, 'jobs.schedule.create', created, 'unknown-create-transport', () => {}));
    const wait = async (check: () => Promise<boolean>) => { const end = Date.now() + 20_000; while (!await check()) {
      if (Date.now() >= end) throw new Error('Uncertain committed source evidence did not settle.'); await Bun.sleep(20);
    } };
    await wait(async () => {
      const page = await log.page('audit', { kind: 'application' }, { family: 'workflow' }), source = registration.value?.diagnostics();
      return page.events.length === 1 && !!source && source.queued === 0 && !source.pending && !source.active;
    });
    state.armed = true;
    const guard = () => { if (state.retired) throw new JobsError('JOBS_AUTHORITY_RETIRED'); };
    await expect(runWithLoggingAttribution(log, context, guard, () => jobs.write(scope, 'jobs.schedule.change', {
      actor, requestId: 'unknown-pause', id: 'unknown-job', expectedRevision: 1, action: 'pause', now: now + 1,
    }, 'unknown-pause-transport', guard))).rejects.toMatchObject({ code: 'JOBS_OUTCOME_UNKNOWN', outcome: 'unknown' });
    expect(state.committedReplies).toBe(1);
    // No new source mutation, retry, public read under retired authority or
    // explicit flush/wake is allowed to rescue delivery in this regression.
    await wait(async () => (await log.page('audit', { kind: 'application' }, { family: 'workflow' })).events.length === 2);
    const events = (await log.page('audit', { kind: 'application' }, { family: 'workflow' })).events.map(row => row.event);
    expect(events.map(event => event.action).sort()).toEqual(['jobs.schedule.created', 'jobs.schedule.paused']);
    expect(events.find(event => event.action === 'jobs.schedule.paused')!.metadata).toMatchObject({ revision: 2, previousControl: 'active', control: 'paused' });
    expect(events.every(event => event.actor.id === actor.userId && event.evidence === 'server-confirmed')).toBe(true);
    expect(new Set(events.map(event => event.id)).size).toBe(2); expect(state.committedReplies).toBe(1); expect(JSON.stringify(events)).not.toContain('NEVER_CAPTURE');
  } finally {
    if (runtime) await runtime.close(); if (logging) await logging.close(); if (authority) await authority.close(); system?.dispose(); await owned.cleanup();
  }
}, 120_000);
