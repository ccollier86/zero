/** Managed preparation and Elysia startup share one notification owner; failed/retired composition cannot leave a live provider. */
import { expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { ZeroAppRuntime } from '../runtime/zero-app-runtime';
import { ZERO_NOTIFICATION_SERVICE } from '../runtime/service-keys';
import { SchedulerService } from '../scheduler/scheduler-service';
import { createReactiveDB } from '../sync/reactive-db';
import { createNotificationPlugin, getNotificationService } from './notification.plugin';

test('managed preparation, listen and stop use one provider and retire only its owned schedule', async () => {
  const db = createReactiveDB({ mode: 'memory' }), runtime = new ZeroAppRuntime(), scheduler = new SchedulerService();
  let initialize!: () => void, created = 0;
  const plugin = createNotificationPlugin({ db, runtime, getTokenService: () => null, getScheduler: () => scheduler,
    onInitializerCreated(value) { initialize = value; }, onServiceCreated() { created++; } });
  const app = new Elysia().use(plugin);
  let listening = false;
  try {
    expect(runtime.get(ZERO_NOTIFICATION_SERVICE)).toBeNull();
    initialize(); const service = runtime.require(ZERO_NOTIFICATION_SERVICE); initialize();
    expect(created).toBe(1); expect(getNotificationService()).toBe(service); expect(scheduler.has('notification-cleanup')).toBe(true);
    app.listen({ hostname: '127.0.0.1', port: 0 }); listening = true;
    expect(runtime.require(ZERO_NOTIFICATION_SERVICE)).toBe(service); expect(created).toBe(1);
    await app.stop(true);
    listening = false;
    expect(runtime.get(ZERO_NOTIFICATION_SERVICE)).toBeNull(); expect(getNotificationService()).toBeNull();
    expect(scheduler.has('notification-cleanup')).toBe(false);
    expect(initialize).toThrow('closed');
  } finally { if (listening) await app.stop(true); await runtime.dispose(); db.dispose(); }
});

test('composition failure and disposal before listen release registration without deleting a foreign schedule', async () => {
  const db = createReactiveDB({ mode: 'memory' }), runtime = new ZeroAppRuntime(), scheduler = new SchedulerService();
  scheduler.register({ name: 'notification-cleanup', pattern: '0 0 * * * *', run() {} });
  let initialize!: () => void;
  createNotificationPlugin({ db, runtime, getTokenService: () => null, getScheduler: () => scheduler,
    onInitializerCreated(value) { initialize = value; }, onServiceCreated() { throw new Error('Synthetic dependency failure.'); } });
  try {
    expect(initialize).toThrow('Synthetic dependency failure.');
    expect(runtime.get(ZERO_NOTIFICATION_SERVICE)).toBeNull(); expect(getNotificationService()).toBeNull();
    expect(scheduler.has('notification-cleanup')).toBe(true);
    await runtime.dispose(); expect(initialize).toThrow('closed');
  } finally { scheduler.unregister('notification-cleanup'); await runtime.dispose(); db.dispose(); }
});

test('a retiring provider does not unregister a replacement job installed under the same name', async () => {
  const db = createReactiveDB({ mode: 'memory' }), runtime = new ZeroAppRuntime(), scheduler = new SchedulerService();
  let initialize!: () => void;
  createNotificationPlugin({ db, runtime, getTokenService: () => null, getScheduler: () => scheduler, onInitializerCreated(value) { initialize = value; } });
  try {
    initialize(); expect(scheduler.unregister('notification-cleanup')).toBe(true);
    const replacement = () => {};
    scheduler.register({ name: 'notification-cleanup', pattern: '0 0 * * * *', run: replacement });
    await runtime.dispose();
    expect(scheduler.has('notification-cleanup')).toBe(true);
    expect(scheduler.unregister('notification-cleanup', () => {})).toBe(false);
    expect(scheduler.unregister('notification-cleanup', replacement)).toBe(true);
  } finally { scheduler.unregister('notification-cleanup'); await runtime.dispose(); db.dispose(); }
});
