import { describe, expect, it } from 'bun:test';
import { Elysia } from 'elysia';
import { OBS_CODES } from './codes';
import { MemoryEventStore } from './memory-event-store';
import { createObservabilityPlugin } from './plugin';
import { configureObservability, emitPlatformCode } from './sink';

describe('createObservabilityPlugin', () => {
  it('exposes recent events from the configured store in development mode', async () => {
    const store = new MemoryEventStore();
    const config = {
      console: false,
      store,
      endpoint: { read: 'development' as const },
    };
    configureObservability(config);

    emitPlatformCode(OBS_CODES.APP_CLIENT_BUNDLE_READY, {
      metadata: { publicPath: '/client.js' },
    });

    const app = new Elysia().use(createObservabilityPlugin({ config, authEnabled: false }));
    const response = await app.handle(new Request('http://localhost/api/_zero/observability/events?limit=5'));
    const body = await response.json() as { count: number; events: Array<{ code: string }> };

    expect(response.status).toBe(200);
    expect(body.count).toBe(1);
    expect(body.events[0].code).toBe(OBS_CODES.APP_CLIENT_BUNDLE_READY.code);
  });

  it('ingests frontend events through the write-only endpoint', async () => {
    const store = new MemoryEventStore();
    const config = {
      console: false,
      store,
      endpoint: { read: 'development' as const, frontendIngest: true },
    };
    configureObservability(config);

    const app = new Elysia().use(createObservabilityPlugin({ config, authEnabled: false }));
    const response = await app.handle(new Request('http://localhost/api/_zero/observability/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        level: 'error',
        category: 'frontend',
        code: OBS_CODES.FRONTEND_RENDER_ERROR.code,
        message: 'Render failed',
        metadata: { component: 'Dashboard' },
      }),
    }));

    expect(response.status).toBe(200);
    const page = store.query({ category: 'frontend' });
    expect(page.count).toBe(1);
    expect(page.events[0].message).toBe('Render failed');
  });
});
