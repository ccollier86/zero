/** Verifies frontend ingest byte limits before Elysia parses untrusted bodies. */

import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { OBS_CODES } from './codes';
import { MemoryEventStore } from './memory-event-store';
import { createObservabilityPlugin } from './plugin';

function fixture(maxPayloadBytes = 128, aot = true) {
  const store = new MemoryEventStore();
  const config = { console: false, store, endpoint: { maxPayloadBytes } };
  const app = new Elysia({ aot }).use(createObservabilityPlugin({
    config,
    runtime: { config, store, sink: store },
  }));
  return { app, store };
}

function request(body: string, headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/_zero/observability/events', {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body,
  });
}

describe('frontend event payload boundary', () => {
  test.each([0, -1, 1.5, NaN, Infinity])('rejects an invalid byte-limit configuration %s', (limit) => {
    expect(() => fixture(limit)).toThrow('positive safe integer');
  });

  test.each([{}, { 'content-length': '1' }] as Record<string, string>[])('rejects actual oversized bytes with headers %j', async (headers) => {
    const { app, store } = fixture();
    const response = await app.handle(request(JSON.stringify({
      message: 'Synthetic event', metadata: { detail: 'x'.repeat(256) },
    }), headers));
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'Payload too large' });
    expect(store.query({ code: OBS_CODES.FRONTEND_RENDER_ERROR.code }).count).toBe(0);
    expect(store.query({ code: OBS_CODES.OBSERVABILITY_FRONTEND_REJECTED.code }).count).toBe(1);
  });

  test.each([true, false])('preserves valid JSON and schema validation with aot=%s', async (aot) => {
    const { app, store } = fixture(128, aot);
    expect((await app.handle(request('{"message":"Hello"}'))).status).toBe(200);
    expect((await app.handle(request('{"message":42}'))).status).toBe(422);
    expect((await app.handle(request('{broken'))).status).toBe(400);
    expect(store.query({ code: OBS_CODES.APP_REQUEST_PARSE_REJECTED.code }).count).toBe(1);
  });

  test.each([true, false])('preserves URL-encoded parsing with aot=%s', async (aot) => {
    const { app } = fixture(128, aot);
    const response = await app.handle(request('message=Hello', {
      'content-type': 'application/x-www-form-urlencoded',
    }));
    expect(response.status).toBe(200);
  });

  test('counts UTF-8 bytes and permits an exact-boundary payload', async () => {
    const payload = JSON.stringify({ message: '界'.repeat(20) });
    const bytes = new TextEncoder().encode(payload).byteLength;
    expect((await fixture(bytes).app.handle(request(payload))).status).toBe(200);
    expect((await fixture(bytes - 1).app.handle(request(payload))).status).toBe(413);
  });

  test('cancels an oversized chunked stream without draining or parsing it', async () => {
    let pulls = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array(64).fill(120));
        if (pulls >= 100) controller.close();
      },
      cancel() { cancelled = true; },
    });
    const { app } = fixture();
    const response = await app.handle(new Request('http://localhost/api/_zero/observability/events', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body,
    }));
    expect(response.status).toBe(413);
    expect(pulls).toBeLessThan(100);
    expect(cancelled).toBe(true);
  });
});
