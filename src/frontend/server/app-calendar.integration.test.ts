/** Physical createApp/Guardian/calendar/logging path. Only marked synthetic private state is admitted. */
import { expect, test } from 'bun:test';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { allocateSyntheticFixture } from '../../test-support/synthetic-fixture';
import type { CalendarAppointmentPage, CalendarCommandReceipt, CalendarResourcePage } from '../../calendar/contracts';
import { createLoggingClient } from '../client/logging-client';
import type { FetchInit } from '../client/sdk';
import { createApp } from './app-factory';
import { defineZeroPlugin } from './server-extensions';
import type { ServerRouteServices } from './server-services';
import type { AppConfig } from './types';

function configuration(root: string, logging: boolean, inspect: (zero: ServerRouteServices) => void): AppConfig {
  return {
    projectRoot: root,
    db: { mode: 'file', path: join(root, 'application.db'), synchronous: 'FULL' },
    systemDb: { mode: 'file', path: join(root, 'system.db'), synchronous: 'FULL' },
    tables: {}, migrate: true,
    auth: { bootstrap: 'public', registration: { mode: 'public' }, accountEmails: { passwordReset: false } },
    calendar: { timezone: 'UTC', rootDirectory: join(root, 'private-calendar') },
    logging: logging ? { preset: 'compliance', rootDirectory: join(root, 'private-audit'),
      metadataKeys: ['revision', 'resourceCount', 'status', 'sequence'] } : false,
    workflows: false, jobs: false, workers: false, messaging: false, blog: false,
    email: false, ai: false, vector: false, kv: false, pdf: false,
    appDir: join(root, 'app'), outDir: join(root, 'build'), generatedDir: join(root, 'generated'), storageDir: join(root, 'storage'),
    themeFoundation: 'legacy', frontendBuild: { version: 1, frontend: { themeFoundation: 'legacy', plugins: {} }, pluginIdentities: {} },
    serverPluginsDir: false, serverResourcesDir: false, serverMiddlewareDir: false,
    serverEndpointsDir: false, serverRoutesDir: false, resourceRoutes: false,
    observability: { console: false },
    serverExtensions: [defineZeroPlugin({ name: 'calendar-managed-inspection', setup({ zero }) { inspect(zero); } })],
  };
}

for (const compliance of [false, true]) {
  test(`managed calendar preserves real HTTP admission, source outcomes and investigator evidence (compliance=${compliance})`, async () => {
    const parent = process.platform === 'darwin'
      ? '/Volumes/code-bank/tmp/scratch/zero-platform/calendar-managed-runtime'
      : join(tmpdir(), 'zero-calendar-managed');
    // The canonical allocator enforces the storage-integrity boundary. Never bypass
    // it or relabel an unexecuted physical run as passing memory qualification.
    const fixture = await allocateSyntheticFixture(parent, 'calendar-managed');
    let app: Awaited<ReturnType<typeof createApp>> | undefined;
    let services: ServerRouteServices | undefined;
    let primary: unknown;
    try {
      await mkdir(join(fixture.root, 'app'));
      app = await createApp(configuration(fixture.root, compliance, zero => { services = zero; }));
      app.listen({ hostname: '127.0.0.1', port: 0 });
      const origin = 'http://127.0.0.1:' + app.server!.port;
      const anonymous = await fetch(origin + '/api/calendar/resources');
      expect(anonymous.status).toBe(401);
      const registered = await fetch(origin + '/auth/register', { method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'calendar-fixture', email: 'calendar@example.test', password: 'Fixture-only-password-123!' }) });
      expect(registered.status, await registered.clone().text()).toBe(200);
      const identity = await registered.json() as { accessToken: string; user: { userId: string } };
      const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + identity.accessToken };
      const call = (path: string, body?: unknown) => fetch(origin + path, {
        method: body === undefined ? 'GET' : 'POST', headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const resourceInput = { resource: { label: 'PRIVATE_SYNTHETIC_CALENDAR', kind: 'person', timeZone: 'UTC' },
        options: { idempotencyKey: 'managed-resource' } };
      const loggingClient = createLoggingClient(async <T>(path: string, init?: FetchInit): Promise<T> => {
        const response = await fetch(origin + path, { method: init?.method ?? 'GET', headers, signal: init?.signal,
          ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) }) });
        if (!response.ok) throw new Error('Synthetic investigator request was rejected: ' + response.status);
        return (init?.json === false ? response : await response.json()) as T;
      });
      if (compliance) {
        expect((await call('/api/calendar/resources', resourceInput)).status).toBe(428);
        await loggingClient.observe([], { policyVersion: services!.logging!.config.policyVersion });
        await services!.logging!.flush();
      }
      const first = await call('/api/calendar/resources', resourceInput);
      expect(first.status, await first.clone().text()).toBe(200);
      const resource = await first.json() as CalendarCommandReceipt;
      expect(resource).toMatchObject({ operation: 'resource.created', changed: true, revision: 1 });
      const replay = await call('/api/calendar/resources', resourceInput);
      expect(replay.status).toBe(200); expect(await replay.json()).toEqual(resource);
      const catalog = await call('/api/calendar/resources');
      expect(catalog.status).toBe(200);
      expect((await catalog.json() as CalendarResourcePage).items).toMatchObject([{ id: resource.id, ownerId: identity.user.userId }]);
      const range = { resourceIds: [resource.id], startAt: '2026-12-01T00:00:00.000Z', endAt: '2026-12-02T00:00:00.000Z' };
      const input = { appointment: { resourceIds: [resource.id], title: 'PRIVATE_SYNTHETIC_APPOINTMENT',
        startAt: '2026-12-01T10:00:00.000Z', endAt: '2026-12-01T11:00:00.000Z', timeZone: 'UTC' },
        options: { idempotencyKey: 'managed-booking' } };
      const created = await call('/api/calendar/appointments', input);
      expect(created.status, await created.clone().text()).toBe(200);
      const booking = await created.json() as CalendarCommandReceipt;
      expect(booking).toMatchObject({ operation: 'appointment.created', changed: true, revision: 1 });
      const page = await call('/api/calendar/appointments/query', { query: range });
      expect(page.status).toBe(200);
      expect((await page.json() as CalendarAppointmentPage).items.map(item => item.id)).toEqual([booking.id]);
      const competing = await call('/api/calendar/appointments', { ...input, options: { idempotencyKey: 'competing-booking' } });
      expect(competing.status).toBe(409);
      expect(await competing.json()).toMatchObject({ code: 'CALENDAR_BOOKING_CONFLICT', outcome: 'not-committed' });
      const rejectedReceipt = await call('/api/calendar/receipts/competing-booking');
      expect(rejectedReceipt.status).toBe(200); expect(await rejectedReceipt.json()).toEqual({ receipt: null });
      const cancelled = await call('/api/calendar/appointments/' + booking.id + '/cancel',
        { options: { idempotencyKey: 'managed-cancel', expectedRevision: 1 } });
      expect(cancelled.status, await cancelled.clone().text()).toBe(200);
      expect(await cancelled.json()).toMatchObject({ operation: 'appointment.cancelled', revision: 2, changed: true });
      const noop = await call('/api/calendar/appointments/' + booking.id + '/cancel',
        { options: { idempotencyKey: 'managed-cancel-noop', expectedRevision: 2 } });
      expect(noop.status).toBe(200); expect(await noop.json()).toMatchObject({ revision: 2, changed: false });
      if (compliance) {
        await services!.logging!.flush();
        const evidence = await loggingClient.page('audit', { action: 'calendar.appointment.created' });
        expect(evidence.events).toHaveLength(1);
        expect(evidence.events[0]!.event).toMatchObject({ actor: { id: identity.user.userId },
          scope: { kind: 'application', tenantId: null }, outcome: 'succeeded',
          target: { type: 'calendar.appointment', id: booking.id } });
        const cancellation = await loggingClient.page('audit', { action: 'calendar.appointment.cancelled' });
        expect(cancellation.events).toHaveLength(1);
        expect(JSON.stringify([evidence, cancellation])).not.toMatch(/PRIVATE_SYNTHETIC|Fixture-only-password|calendar@example\.test/);
        services!.logging!.admission.invalidate();
        expect((await call('/api/calendar/resources')).status).toBe(428);
        await loggingClient.observe([], { policyVersion: services!.logging!.config.policyVersion });
        expect((await call('/api/calendar/resources')).status).toBe(200);
      } else expect(services!.logging).toBeNull();
      loggingClient.clear();
    } catch (error) { primary = error; throw error; }
    finally {
      let retired = !app;
      try { await app?.stop(true); retired = true; }
      catch (error) { if (!primary) throw error; }
      finally {
        // Never remove synthetic databases while failed shutdown may still own them.
        if (retired) await fixture.cleanup();
        else console.error('Synthetic calendar fixture retained after unconfirmed shutdown: ' + fixture.root);
      }
    }
  }, 60_000);
}
