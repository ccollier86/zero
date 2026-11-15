/** Real native routes/timer/Torrent/source delivery/investigator. Observes the actual source registration without synthetic attribution or forced flushing. */
import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { createApp } from '../frontend/server/app-factory';
import { defineZeroPlugin } from '../frontend/server/server-extensions';
import type { LoggingRuntime } from '../logging/logging-runtime';
import type { DeliverySourceRegistration } from '../logging/logging-delivery-protocol';
import type { LoggingEvent } from '../logging/logging-contracts';
import { ownedWorkerFixture } from '../workers/test-support/owned-fixture';
import { flow, step } from '../workflows/workflow-dsl';
import { defineJob } from './definition';

for (const preset of ['activity', 'detailed'] as const) for (const dispatch of ['timer', 'request-wake'] as const) test(`native ${preset} controls retain their user while ${dispatch} observations deliver independently as system facts`, async () => {
  const owned = await ownedWorkerFixture('jobs-logging-native');
  let app: Awaited<ReturnType<typeof createApp>> | null = null, logging: LoggingRuntime | undefined, release!: () => void, entered = false, startupSettled = true;
  const held = new Promise<void>(resolve => { release = resolve; }), sources: DeliverySourceRegistration[] = [];
  const definition = defineJob({ name: 'synthetic.native', version: '1', workflow: { name: 'synthetic.native', version: 1 }, access: 'user', parseInput: input => input });
  try {
    try {
      app = await createApp({ projectRoot: owned.root, db: { mode: 'memory' }, tables: {},
        auth: { bootstrap: 'public', registration: { mode: 'public' }, accountEmails: { passwordReset: false } },
        jobs: { definitions: [definition], rootDirectory: join(owned.root, 'jobs') }, logging: { preset, rootDirectory: join(owned.root, 'logs') },
        workflows: { register(registry) {
          registry.registerActivity({ name: 'synthetic.native', version: '1', async handler() { entered = true; await held; return { private: 'NEVER_NATIVE_JOB_RESULT' }; } });
          registry.create({ name: 'synthetic.native', version: 1, flow: flow(step('work', { name: 'synthetic.native', version: '1' })) });
        } },
        serverExtensions: [defineZeroPlugin({ name: 'observe-native-job-source', setup({ zero }) {
          logging = zero.logging ?? undefined;
          if (!logging) throw new Error('Synthetic managed logging was unavailable.');
          const register = logging.registerDeliverySource.bind(logging);
          logging.registerDeliverySource = port => { const source = register(port); sources.push(source); return source; };
        } })],
        appDir: join(owned.root, 'app'), outDir: join(owned.root, 'out'), storageDir: join(owned.root, 'storage'),
        ai: false, email: false, vector: false, kv: false, pdf: false, observability: false, serverResourcesDir: false,
        serverPluginsDir: false, serverMiddlewareDir: false, serverEndpointsDir: false, serverRoutesDir: false, resourceRoutes: false,
      });
    } catch (error) { if (error instanceof AggregateError) startupSettled = false; throw error; }
    app.listen({ hostname: '127.0.0.1', port: 0 }); const origin = 'http://127.0.0.1:' + app.server!.port;
    const request = (path: string, body: unknown, token?: string) => fetch(origin + path, { method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });
    const registered = await request('/auth/register', { username: 'native-jobs-owner', email: 'native-jobs@example.test', password: 'Synthetic-Jobs-Password-94!' });
    expect(registered.status).toBe(200);
    const user = await registered.json() as { accessToken: string; user: { userId: string } };
    const command = { schedule: { definition: definition.name, input: { private: 'NEVER_NATIVE_JOB_INPUT' }, timing: { kind: 'once', at: new Date(Date.now() + 8000).toISOString() } }, options: { idempotencyKey: 'native-semantic-job' } };
    const path = dispatch === 'timer' ? '/jobs/schedules' : '/jobs/enqueue';
    const body = dispatch === 'timer' ? command : { definition: definition.name, input: { private: 'NEVER_NATIVE_JOB_INPUT' }, idempotencyKey: 'native-semantic-job' };
    const response = await request(path, body, user.accessToken); expect(response.status).toBe(202);
    const accepted = await response.json() as { id: string };
    let events: LoggingEvent[] = [];
    const read = async () => { events = (await logging!.page('audit', { kind: 'application' }, { family: 'workflow', limit: 100 })).events.map(row => row.event).filter(event => event.action.startsWith('jobs.')); };
    await until(async () => { await read(); return events.some(event => event.action === 'jobs.schedule.created'); });
    expect(events.find(event => event.action === 'jobs.schedule.created')!.actor).toMatchObject({ kind: 'user', id: user.user.userId, initiatorId: null });
    expect(sources).toHaveLength(1);
    const idle = () => { const state = sources[0]!.diagnostics(); return !state.pending && !state.active && state.queued === 0; };
    // Future scheduling additionally proves handoff wakes an already idle
    // source. Immediate enqueue proves HTTP-triggered work loses request ALS.
    if (dispatch === 'timer') await until(async () => idle());
    await until(async () => { await read(); return entered && events.some(event => event.action === 'jobs.occurrence.handed-off'); });
    await until(async () => idle()); // Terminal delivery must wake an idle source again, not ride the create/handoff flush.
    release();
    await until(async () => { await read(); return events.some(event => event.action === 'jobs.occurrence.terminal-observed'); });
    expect(events).toHaveLength(3);
    const created = events.find(event => event.action === 'jobs.schedule.created')!;
    expect(created.target).toEqual({ type: 'job.schedule', id: accepted.id });
    const observed = events.filter(event => event.action !== 'jobs.schedule.created');
    expect(observed.every(event => event.actor.kind === 'system' && event.actor.id === 'zero.database' && event.actor.sessionId === null && event.actor.initiatorId === null
      && event.origin === 'system' && event.scope.kind === 'application' && event.metadata.scheduleId === accepted.id && event.evidence === 'server-confirmed')).toBe(true);
    expect(observed.find(event => event.action === 'jobs.occurrence.terminal-observed')!.metadata.workflowStatus).toBe('completed');
    expect(new Set(events.map(event => event.id)).size).toBe(3); expect(JSON.stringify(events)).not.toContain('NEVER_NATIVE_JOB');
    const replay = await request(path, body, user.accessToken); expect(replay.status).toBe(202); expect(await replay.json()).toMatchObject({ id: accepted.id });
    await read(); expect(events).toHaveLength(3);
  } finally {
    release(); if (app) await app.stop(true);
    if (!startupSettled) throw new Error('Managed startup could not prove cleanup; preserving ' + owned.root);
    await owned.cleanup();
  }
}, 120_000);

async function until(check: () => Promise<boolean>): Promise<void> {
  const end = Date.now() + 30_000;
  while (!await check()) { if (Date.now() >= end) throw new Error('Native jobs source evidence did not settle.'); await Bun.sleep(20); }
}
