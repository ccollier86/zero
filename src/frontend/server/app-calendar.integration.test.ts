/** Physical createApp/Guardian/calendar/logging path. Only marked synthetic private state is admitted. */
import { expect, test } from 'bun:test';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { allocateSyntheticFixture } from '../../test-support/synthetic-fixture';
import type { CalendarAppointmentPage, CalendarAvailabilityView, CalendarBlockPage, CalendarBlockView, CalendarBusyPage, CalendarCommandReceipt, CalendarHoldPage, CalendarHoldView, CalendarResourcePage } from '../../calendar/contracts';
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
      const call = (path: string, body?: unknown, method?: string) => fetch(origin + path, {
        method: method ?? (body === undefined ? 'GET' : 'POST'), headers,
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
      const defaultAvailability = await call('/api/calendar/availability/' + resource.id);
      expect(defaultAvailability.status).toBe(200);
      expect(await defaultAvailability.json() as CalendarAvailabilityView).toMatchObject({ resourceId: resource.id, resourceRevision: 1, timeZone: 'UTC', mode: 'unrestricted', windows: [] });
      const emptyBlocks = await call('/api/calendar/blocks/query', { query: range });
      expect(emptyBlocks.status).toBe(200); expect(await emptyBlocks.json()).toEqual({ items: [], truncated: false });
      const policy = { availability: { mode: 'windows', windows: [{ startAt: '2026-12-01T08:00:00.000Z', endAt: '2026-12-01T18:00:00.000Z' }] },
        options: { idempotencyKey: 'managed-availability', expectedRevision: 1 } };
      const availabilityResponse = await call('/api/calendar/availability/' + resource.id, policy);
      expect(availabilityResponse.status, await availabilityResponse.clone().text()).toBe(200);
      const availability = await availabilityResponse.json() as CalendarCommandReceipt;
      expect(availability).toMatchObject({ operation: 'resource.availability-changed', id: resource.id, revision: 2, changed: true });
      const availabilityReplay = await call('/api/calendar/availability/' + resource.id, policy);
      expect(availabilityReplay.status).toBe(200); expect(await availabilityReplay.json()).toEqual(availability);
      const availabilityReceipt = await call('/api/calendar/receipts/managed-availability');
      expect(availabilityReceipt.status).toBe(200); expect(await availabilityReceipt.json()).toEqual({ receipt: availability });
      const availabilityNoop = await call('/api/calendar/availability/' + resource.id, { ...policy,
        options: { idempotencyKey: 'managed-availability-noop', expectedRevision: 2 },
        availability: { mode: 'windows', windows: [{ startAt: '2026-12-01T08:00:00.000Z', endAt: '2026-12-01T12:00:00.000Z' },
          { startAt: '2026-12-01T12:00:00.000Z', endAt: '2026-12-01T18:00:00.000Z' }] } });
      expect(availabilityNoop.status).toBe(200); expect(await availabilityNoop.json()).toMatchObject({ revision: 2, changed: false });
      const currentAvailability = await call('/api/calendar/availability/' + resource.id);
      expect(currentAvailability.status).toBe(200);
      expect(await currentAvailability.json() as CalendarAvailabilityView).toMatchObject({ resourceId: resource.id, resourceRevision: 2, ...policy.availability });
      const input = { appointment: { resourceIds: [resource.id], title: 'PRIVATE_SYNTHETIC_APPOINTMENT',
        startAt: '2026-12-01T10:00:00.000Z', endAt: '2026-12-01T11:00:00.000Z', timeZone: 'UTC' },
        options: { idempotencyKey: 'managed-booking' } };
      const outsideAvailability = await call('/api/calendar/appointments', { ...input,
        appointment: { ...input.appointment, startAt: '2026-12-01T20:00:00.000Z', endAt: '2026-12-01T21:00:00.000Z' },
        options: { idempotencyKey: 'outside-availability' } });
      expect(outsideAvailability.status).toBe(409);
      expect(await outsideAvailability.json()).toMatchObject({ code: 'CALENDAR_AVAILABILITY_CONFLICT', outcome: 'not-committed' });
      const outsideReceipt = await call('/api/calendar/receipts/outside-availability');
      expect(outsideReceipt.status).toBe(200); expect(await outsideReceipt.json()).toEqual({ receipt: null });
      const created = await call('/api/calendar/appointments', input);
      expect(created.status, await created.clone().text()).toBe(200);
      const booking = await created.json() as CalendarCommandReceipt;
      expect(booking).toMatchObject({ operation: 'appointment.created', changed: true, revision: 1 });
      const page = await call('/api/calendar/appointments/query', { query: range });
      expect(page.status).toBe(200);
      expect((await page.json() as CalendarAppointmentPage).items.map(item => item.id)).toEqual([booking.id]);
      const conflictingBlock = await call('/api/calendar/blocks', { block: { ...input.appointment, title: 'PRIVATE_SYNTHETIC_CONFLICTING_BLOCK' },
        options: { idempotencyKey: 'conflicting-block' } });
      expect(conflictingBlock.status).toBe(409);
      expect(await conflictingBlock.json()).toMatchObject({ code: 'CALENDAR_BOOKING_CONFLICT', outcome: 'not-committed' });
      const rejectedBlockReceipt = await call('/api/calendar/receipts/conflicting-block');
      expect(rejectedBlockReceipt.status).toBe(200); expect(await rejectedBlockReceipt.json()).toEqual({ receipt: null });
      const blockInput = { block: { resourceIds: [resource.id], title: 'PRIVATE_SYNTHETIC_BLOCK',
        startAt: '2026-12-01T12:00:00.000Z', endAt: '2026-12-01T13:00:00.000Z', timeZone: 'UTC' },
        options: { idempotencyKey: 'managed-block' } };
      const blockCreated = await call('/api/calendar/blocks', blockInput);
      expect(blockCreated.status, await blockCreated.clone().text()).toBe(200);
      const blocked = await blockCreated.json() as CalendarCommandReceipt;
      expect(blocked).toMatchObject({ operation: 'block.created', revision: 1, changed: true });
      const blockReplay = await call('/api/calendar/blocks', blockInput);
      expect(blockReplay.status).toBe(200); expect(await blockReplay.json()).toEqual(blocked);
      const blockReceipt = await call('/api/calendar/receipts/managed-block');
      expect(blockReceipt.status).toBe(200); expect(await blockReceipt.json()).toEqual({ receipt: blocked });
      expect(JSON.stringify(blocked)).not.toContain('PRIVATE_SYNTHETIC'); expect(JSON.stringify(blocked)).not.toContain(blockInput.block.startAt);
      const blockedAppointment = await call('/api/calendar/appointments', { appointment: { ...input.appointment,
        startAt: blockInput.block.startAt, endAt: blockInput.block.endAt }, options: { idempotencyKey: 'block-occupied-booking' } });
      expect(blockedAppointment.status).toBe(409);
      expect(await blockedAppointment.json()).toMatchObject({ code: 'CALENDAR_BOOKING_CONFLICT', outcome: 'not-committed' });
      const moveBlock = { block: { startAt: '2026-12-01T13:00:00.000Z', endAt: '2026-12-01T14:00:00.000Z', timeZone: 'UTC' },
        options: { idempotencyKey: 'managed-block-move', expectedRevision: 1 } };
      const movedBlock = await call('/api/calendar/blocks/' + blocked.id + '/reschedule', moveBlock);
      expect(movedBlock.status, await movedBlock.clone().text()).toBe(200);
      const blockMoved = await movedBlock.json() as CalendarCommandReceipt;
      expect(blockMoved).toMatchObject({ operation: 'block.rescheduled', revision: 2, changed: true });
      const moveReplay = await call('/api/calendar/blocks/' + blocked.id + '/reschedule', moveBlock);
      expect(moveReplay.status).toBe(200); expect(await moveReplay.json()).toEqual(blockMoved);
      const moveNoop = await call('/api/calendar/blocks/' + blocked.id + '/reschedule', { ...moveBlock,
        options: { idempotencyKey: 'managed-block-move-noop', expectedRevision: 2 } });
      expect(moveNoop.status).toBe(200); expect(await moveNoop.json()).toMatchObject({ revision: 2, changed: false });
      const blockPage = await call('/api/calendar/blocks/query', { query: range });
      expect(blockPage.status).toBe(200);
      expect((await blockPage.json() as CalendarBlockPage).items).toMatchObject([{ id: blocked.id, title: blockInput.block.title, status: 'active', revision: 2, ...moveBlock.block }]);
      const busyResponse = await call('/api/calendar/busy/query', { query: range });
      expect(busyResponse.status).toBe(200);
      const busy = await busyResponse.json() as CalendarBusyPage;
      expect(busy.items).toEqual([{ resourceId: resource.id, startAt: input.appointment.startAt, endAt: input.appointment.endAt },
        { resourceId: resource.id, startAt: moveBlock.block.startAt, endAt: moveBlock.block.endAt }]);
      expect(busy.items.every(item => Object.keys(item).sort().join(',') === 'endAt,resourceId,startAt')).toBe(true);
      expect(JSON.stringify(busy)).not.toContain('PRIVATE_SYNTHETIC'); expect(JSON.stringify(busy)).not.toContain(blocked.id); expect(JSON.stringify(busy)).not.toContain(booking.id);
      const cancelBlock = { options: { idempotencyKey: 'managed-block-cancel', expectedRevision: 2 } };
      const blockCancelled = await call('/api/calendar/blocks/' + blocked.id + '/cancel', cancelBlock);
      expect(blockCancelled.status, await blockCancelled.clone().text()).toBe(200);
      const cancelledBlock = await blockCancelled.json() as CalendarCommandReceipt;
      expect(cancelledBlock).toMatchObject({ operation: 'block.cancelled', revision: 3, changed: true });
      const cancelReplay = await call('/api/calendar/blocks/' + blocked.id + '/cancel', cancelBlock);
      expect(cancelReplay.status).toBe(200); expect(await cancelReplay.json()).toEqual(cancelledBlock);
      const cancelBlockNoop = await call('/api/calendar/blocks/' + blocked.id + '/cancel', {
        options: { idempotencyKey: 'managed-block-cancel-noop', expectedRevision: 3 } });
      expect(cancelBlockNoop.status).toBe(200); expect(await cancelBlockNoop.json()).toMatchObject({ revision: 3, changed: false });
      const cancelledBlockRead = await call('/api/calendar/blocks/' + blocked.id);
      expect(cancelledBlockRead.status).toBe(200);
      expect(await cancelledBlockRead.json() as CalendarBlockView).toMatchObject({ id: blocked.id, status: 'cancelled', revision: 3, title: blockInput.block.title });
      const clearedBlocks = await call('/api/calendar/blocks/query', { query: range });
      expect(clearedBlocks.status).toBe(200); expect(await clearedBlocks.json()).toEqual({ items: [], truncated: false });
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
      const clearedBusy = await call('/api/calendar/busy/query', { query: range });
      expect(clearedBusy.status).toBe(200); expect(await clearedBusy.json()).toEqual({ items: [], truncated: false });

      // Holds use a separate unrestricted resource and dynamic future instants;
      // the established December availability/booking assertions remain unchanged.
      const holdResourceResponse = await call('/api/calendar/resources', { resource: { label: 'PRIVATE_SYNTHETIC_HOLD_CALENDAR', kind: 'person', timeZone: 'UTC' },
        options: { idempotencyKey: 'managed-hold-resource' } });
      expect(holdResourceResponse.status, await holdResourceResponse.clone().text()).toBe(200);
      const holdResource = await holdResourceResponse.json() as CalendarCommandReceipt;
      const holdNow = Date.now(), holdInput = { hold: { resourceIds: [holdResource.id],
        startAt: new Date(holdNow + 3_600_000).toISOString(), endAt: new Date(holdNow + 7_200_000).toISOString(),
        timeZone: 'UTC', bufferBeforeMinutes: 5, bufferAfterMinutes: 10, ttlSeconds: 900 }, options: { idempotencyKey: 'managed-hold' } };
      const heldResponse = await call('/api/calendar/holds', holdInput);
      expect(heldResponse.status, await heldResponse.clone().text()).toBe(200);
      const held = await heldResponse.json() as CalendarCommandReceipt;
      expect(held).toMatchObject({ operation: 'hold.acquired', revision: 1, changed: true });
      const holdReplay = await call('/api/calendar/holds', holdInput);
      expect(holdReplay.status).toBe(200); expect(await holdReplay.json()).toEqual(held);
      const holdReceipt = await call('/api/calendar/receipts/managed-hold');
      expect(holdReceipt.status).toBe(200); expect(await holdReceipt.json()).toEqual({ receipt: held });
      const holdRange = { resourceIds: [holdResource.id], startAt: holdInput.hold.startAt, endAt: holdInput.hold.endAt };
      const holdPage = await call('/api/calendar/holds/query', { query: holdRange });
      expect(holdPage.status).toBe(200); expect((await holdPage.json() as CalendarHoldPage).items).toMatchObject([{ id: held.id, status: 'held', appointmentId: null }]);
      const confirmInput = { appointment: { title: 'PRIVATE_SYNTHETIC_HOLD_APPOINTMENT' }, options: { idempotencyKey: 'managed-hold-confirm', expectedRevision: 1 } };
      const confirmResponse = await call('/api/calendar/holds/' + held.id + '/confirm', confirmInput);
      expect(confirmResponse.status, await confirmResponse.clone().text()).toBe(200);
      const confirmedHold = await confirmResponse.json() as CalendarCommandReceipt;
      expect(confirmedHold).toMatchObject({ operation: 'appointment.created', requestId: 'managed-hold-confirm', revision: 1, changed: true });
      expect(confirmedHold.id).not.toBe(held.id);
      const confirmReplay = await call('/api/calendar/holds/' + held.id + '/confirm', confirmInput);
      expect(confirmReplay.status).toBe(200); expect(await confirmReplay.json()).toEqual(confirmedHold);
      const confirmReceipt = await call('/api/calendar/receipts/managed-hold-confirm');
      expect(confirmReceipt.status).toBe(200); expect(await confirmReceipt.json()).toEqual({ receipt: confirmedHold });
      const confirmedRead = await call('/api/calendar/holds/' + held.id);
      expect(confirmedRead.status).toBe(200); expect(await confirmedRead.json() as CalendarHoldView).toMatchObject({ status: 'confirmed', revision: 2, appointmentId: confirmedHold.id });
      const confirmedAppointments = await call('/api/calendar/appointments/query', { query: holdRange });
      expect(confirmedAppointments.status).toBe(200);
      expect((await confirmedAppointments.json() as CalendarAppointmentPage).items).toMatchObject([{ id: confirmedHold.id, title: confirmInput.appointment.title,
        startAt: holdInput.hold.startAt, endAt: holdInput.hold.endAt, resourceIds: [holdResource.id], bufferBeforeMinutes: 5, bufferAfterMinutes: 10 }]);
      const consumedHolds = await call('/api/calendar/holds/query', { query: holdRange });
      expect(consumedHolds.status).toBe(200); expect(await consumedHolds.json()).toEqual({ items: [], truncated: false });

      const releaseInput = { hold: { ...holdInput.hold, startAt: new Date(holdNow + 10_800_000).toISOString(), endAt: new Date(holdNow + 14_400_000).toISOString(), ttlSeconds: 1 },
        options: { idempotencyKey: 'managed-release-hold' } };
      const releaseHeldResponse = await call('/api/calendar/holds', releaseInput);
      expect(releaseHeldResponse.status, await releaseHeldResponse.clone().text()).toBe(200);
      const releaseHeld = await releaseHeldResponse.json() as CalendarCommandReceipt;
      const initialReleaseRead = await call('/api/calendar/holds/' + releaseHeld.id);
      expect(initialReleaseRead.status).toBe(200); const releaseInitial = await initialReleaseRead.json() as CalendarHoldView;
      const expiresMs = Date.parse(releaseInitial.expiresAt), expiryDeadline = performance.now() + 1_100;
      while (Date.now() < expiresMs) {
        if (performance.now() >= expiryDeadline) throw new Error('Managed source hold did not reach its admitted one-second expiry.');
        await new Promise(resolve => setTimeout(resolve, Math.max(1, Math.min(20, expiresMs - Date.now()))));
      }
      for (let attempt = 0; attempt < 2; attempt++) {
        const expiredRead = await call('/api/calendar/holds/' + releaseHeld.id);
        expect(expiredRead.status).toBe(200); expect(await expiredRead.json() as CalendarHoldView).toMatchObject({ status: 'expired', revision: 1, expiresAt: releaseInitial.expiresAt });
      }
      const releaseRange = { resourceIds: [holdResource.id], startAt: releaseInput.hold.startAt, endAt: releaseInput.hold.endAt };
      const expiredBusy = await call('/api/calendar/busy/query', { query: releaseRange });
      expect(expiredBusy.status).toBe(200); expect(await expiredBusy.json()).toEqual({ items: [], truncated: false });
      const releaseControl = { options: { idempotencyKey: 'managed-hold-release', expectedRevision: 1 } };
      const releaseResponse = await call('/api/calendar/holds/' + releaseHeld.id + '/release', releaseControl);
      expect(releaseResponse.status, await releaseResponse.clone().text()).toBe(200);
      const released = await releaseResponse.json() as CalendarCommandReceipt;
      expect(released).toMatchObject({ id: releaseHeld.id, operation: 'hold.released', revision: 2, changed: true });
      const releaseReplay = await call('/api/calendar/holds/' + releaseHeld.id + '/release', releaseControl);
      expect(releaseReplay.status).toBe(200); expect(await releaseReplay.json()).toEqual(released);
      const releaseNoop = await call('/api/calendar/holds/' + releaseHeld.id + '/release', { options: { idempotencyKey: 'managed-hold-release-noop', expectedRevision: 2 } });
      expect(releaseNoop.status).toBe(200); expect(await releaseNoop.json()).toMatchObject({ id: releaseHeld.id, operation: 'hold.released', revision: 2, changed: false });
      const releaseReceipt = await call('/api/calendar/receipts/managed-hold-release');
      expect(releaseReceipt.status).toBe(200); expect(await releaseReceipt.json()).toEqual({ receipt: released });
      const releasedRead = await call('/api/calendar/holds/' + releaseHeld.id);
      expect(releasedRead.status).toBe(200); expect(await releasedRead.json() as CalendarHoldView).toMatchObject({ status: 'released', revision: 2, appointmentId: null });
      const lifecyclePolicy = { policy: { extended: true, cancellationReason: 'required', noShowReason: 'required' },
        options: { idempotencyKey: 'managed-lifecycle-policy', expectedRevision: 1 } };
      const policyResponse = await call('/api/calendar/lifecycle', lifecyclePolicy, 'PUT');
      expect(policyResponse.status, await policyResponse.clone().text()).toBe(200);
      expect(await policyResponse.json()).toMatchObject({ operation: 'lifecycle.policy-changed', id: 'policy', revision: 2, changed: true });
      const transitions = await call('/api/calendar/appointments/' + confirmedHold.id + '/transitions');
      expect(transitions.status).toBe(200);
      expect(await transitions.json()).toMatchObject({ id: confirmedHold.id, revision: 1, policyRevision: 2, status: 'confirmed',
        allowed: expect.arrayContaining([{ status: 'no-show', requiresReason: true }, { status: 'cancelled', requiresReason: true }]) });
      const missingReason = await call('/api/calendar/appointments/' + confirmedHold.id + '/cancel', { options: { idempotencyKey: 'managed-no-reason', expectedRevision: 1 } });
      expect(missingReason.status).toBe(409); expect(await missingReason.json()).toMatchObject({ code: 'CALENDAR_REASON_REQUIRED', outcome: 'not-committed' });
      const statusInput = { transition: { status: 'no-show', policyRevision: 2, reason: 'PRIVATE_SYNTHETIC_REASON' },
        options: { idempotencyKey: 'managed-no-show', expectedRevision: 1 } };
      const statusResponse = await call('/api/calendar/appointments/' + confirmedHold.id + '/transition', statusInput);
      expect(statusResponse.status, await statusResponse.clone().text()).toBe(200);
      const statusReceipt = await statusResponse.json() as CalendarCommandReceipt;
      expect(statusReceipt).toMatchObject({ operation: 'appointment.transitioned', id: confirmedHold.id, revision: 2, changed: true });
      const statusReplay = await call('/api/calendar/appointments/' + confirmedHold.id + '/transition', statusInput);
      expect(statusReplay.status).toBe(200); expect(await statusReplay.json()).toEqual(statusReceipt);
      const statusDetail = await call('/api/calendar/appointments/' + confirmedHold.id);
      expect(statusDetail.status).toBe(200); expect(await statusDetail.json()).toMatchObject({ revision: 2, status: 'confirmed',
        lifecycle: { status: 'no-show', reason: statusInput.transition.reason, policyRevision: 2 } });
      const terminalBusy = await call('/api/calendar/busy/query', { query: holdRange });
      expect(terminalBusy.status).toBe(200); expect((await terminalBusy.json() as { items: unknown[] }).items).toHaveLength(1);
      if (compliance) {
        await services!.logging!.flush();
        const evidence = await loggingClient.page('audit', { action: 'calendar.appointment.created' });
        expect(evidence.events).toHaveLength(2);
        expect(evidence.events.map(entry => entry.event.target?.id).sort()).toEqual([booking.id, confirmedHold.id].sort());
        expect(evidence.events.find(entry => entry.event.target?.id === booking.id)!.event).toMatchObject({ actor: { id: identity.user.userId },
          scope: { kind: 'application', tenantId: null }, outcome: 'succeeded',
          target: { type: 'calendar.appointment', id: booking.id } });
        expect(evidence.events.find(entry => entry.event.target?.id === confirmedHold.id)!.event).toMatchObject({ actor: { id: identity.user.userId },
          scope: { kind: 'application', tenantId: null }, outcome: 'succeeded', target: { type: 'calendar.appointment', id: confirmedHold.id } });
        const cancellation = await loggingClient.page('audit', { action: 'calendar.appointment.cancelled' });
        expect(cancellation.events).toHaveLength(1);
        const availabilityEvidence = await loggingClient.page('audit', { action: 'calendar.resource.availability-changed' });
        expect(availabilityEvidence.events).toHaveLength(1);
        expect(availabilityEvidence.events[0]!.event).toMatchObject({ actor: { id: identity.user.userId },
          target: { type: 'calendar.resource', id: resource.id }, outcome: 'succeeded', metadata: { revision: 2 } });
        const blockEvidence = await Promise.all(['created', 'rescheduled', 'cancelled'].map(action => loggingClient.page('audit', { action: 'calendar.block.' + action })));
        for (const [index, entry] of blockEvidence.entries()) {
          expect(entry.events).toHaveLength(1);
          expect(entry.events[0]!.event).toMatchObject({ actor: { id: identity.user.userId }, scope: { kind: 'application', tenantId: null },
            target: { type: 'calendar.block', id: blocked.id }, outcome: 'succeeded', metadata: { revision: index + 1 } });
          expect(Object.keys(entry.events[0]!.event.metadata).every(key => ['revision', 'resourceCount', 'status', 'sequence'].includes(key))).toBe(true);
        }
        const holdAcquired = await loggingClient.page('audit', { action: 'calendar.hold.acquired' });
        expect(holdAcquired.events).toHaveLength(2);
        expect(holdAcquired.events.map(entry => entry.event.target?.id).sort()).toEqual([held.id, releaseHeld.id].sort());
        for (const entry of holdAcquired.events) expect(entry.event).toMatchObject({ actor: { id: identity.user.userId },
          scope: { kind: 'application', tenantId: null }, outcome: 'succeeded', target: { type: 'calendar.hold' }, metadata: { revision: 1, resourceCount: 1, status: 'held' } });
        const holdEvidence = await Promise.all(['confirmed', 'released'].map(action => loggingClient.page('audit', { action: 'calendar.hold.' + action })));
        for (const [index, entry] of holdEvidence.entries()) {
          expect(entry.events).toHaveLength(1);
          expect(entry.events[0]!.event).toMatchObject({ actor: { id: identity.user.userId }, scope: { kind: 'application', tenantId: null }, outcome: 'succeeded',
            target: { type: 'calendar.hold', id: index === 0 ? held.id : releaseHeld.id }, metadata: { revision: 2, resourceCount: 1, status: index === 0 ? 'confirmed' : 'released' } });
        }
        const expiryEvidence = await loggingClient.page('audit', { action: 'calendar.hold.expired' });
        expect(expiryEvidence.events).toEqual([]);
        const lifecycleEvidence = await loggingClient.page('audit', { action: 'calendar.appointment.transitioned' });
        expect(lifecycleEvidence.events).toHaveLength(1);
        expect(lifecycleEvidence.events[0]!.event).toMatchObject({ actor: { id: identity.user.userId },
          target: { type: 'calendar.appointment', id: confirmedHold.id }, outcome: 'succeeded', metadata: { status: 'no-show', revision: 2, policyRevision: 2, reasonPresent: true } });
        const lifecyclePolicyEvidence = await loggingClient.page('audit', { action: 'calendar.lifecycle.policy-changed' });
        expect(lifecyclePolicyEvidence.events).toHaveLength(1);
        expect(lifecyclePolicyEvidence.events[0]!.event).toMatchObject({ actor: { id: identity.user.userId }, target: { type: 'calendar.lifecycle-policy', id: 'policy' }, outcome: 'succeeded' });
        for (const entry of [...holdAcquired.events, ...holdEvidence.flatMap(page => page.events)]) {
          expect(Object.keys(entry.event.metadata).every(key => ['revision', 'resourceCount', 'status', 'sequence'].includes(key))).toBe(true);
        }
        const serializedEvidence = JSON.stringify([evidence, cancellation, availabilityEvidence, ...blockEvidence, holdAcquired, ...holdEvidence, expiryEvidence, lifecycleEvidence, lifecyclePolicyEvidence]);
        expect(serializedEvidence).not.toMatch(/PRIVATE_SYNTHETIC|Fixture-only-password|calendar@example\.test/);
        for (const instant of [input.appointment.startAt, input.appointment.endAt, blockInput.block.startAt,
          blockInput.block.endAt, moveBlock.block.startAt, moveBlock.block.endAt, holdInput.hold.startAt, holdInput.hold.endAt,
          releaseInput.hold.startAt, releaseInput.hold.endAt, ...policy.availability.windows.flatMap(window => [window.startAt, window.endAt])]) {
          expect(serializedEvidence).not.toContain(instant);
        }
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
