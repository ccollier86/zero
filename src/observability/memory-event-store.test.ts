import { describe, expect, it } from 'bun:test';
import { OBS_CODES } from './codes';
import { MemoryEventStore } from './memory-event-store';
import {
  configureObservability,
  emitPlatformCode,
  emitPlatformCodeTo,
} from './sink';
import { emitAIRequestCompleted } from '../ai/ai-observability';
import type { PlatformObservabilityRuntime } from './types';

describe('MemoryEventStore', () => {
  it('retains only the newest events within the configured limit', () => {
    const store = new MemoryEventStore({ maxEvents: 2 });
    configureObservability({ console: false, store });

    emitPlatformCode(OBS_CODES.APP_CLIENT_BUNDLE_READY, { metadata: { n: 1 } });
    emitPlatformCode(OBS_CODES.APP_CLIENT_BUNDLE_FAILED, { metadata: { n: 2 } });
    emitPlatformCode(OBS_CODES.APP_SHUTDOWN_SIGNAL, { metadata: { n: 3 } });

    const page = store.query({ limit: 10 });
    expect(page.count).toBe(2);
    expect(page.events.map((event) => event.code)).toEqual([
      OBS_CODES.APP_CLIENT_BUNDLE_FAILED.code,
      OBS_CODES.APP_SHUTDOWN_SIGNAL.code,
    ]);
  });

  it('filters events by level, category, code, source, and cursor', () => {
    const store = new MemoryEventStore();
    configureObservability({ console: false, store });

    const first = emitPlatformCode(OBS_CODES.APP_CLIENT_BUNDLE_READY);
    emitPlatformCode(OBS_CODES.APP_CLIENT_BUNDLE_FAILED);
    const third = emitPlatformCode(OBS_CODES.FRONTEND_RENDER_ERROR, { source: 'frontend' });

    expect(store.query({ level: 'warn' }).events.map((event) => event.code)).toEqual([
      OBS_CODES.APP_CLIENT_BUNDLE_FAILED.code,
    ]);
    expect(store.query({ category: 'frontend' }).events[0].id).toBe(third.id);
    expect(store.query({ code: OBS_CODES.APP_CLIENT_BUNDLE_READY.code }).events[0].id).toBe(first.id);
    expect(store.query({ source: 'frontend' }).events[0].id).toBe(third.id);
    expect(store.query({ cursor: first.sequence }).events.map((event) => event.code)).toEqual([
      OBS_CODES.APP_CLIENT_BUNDLE_FAILED.code,
      OBS_CODES.FRONTEND_RENDER_ERROR.code,
    ]);
  });

  it('assigns sequences within each app runtime without sibling-volume gaps', () => {
    const firstStore = new MemoryEventStore();
    const secondStore = new MemoryEventStore();
    const firstRuntime: PlatformObservabilityRuntime = {
      sink: firstStore,
      store: firstStore,
      config: { console: false, store: firstStore },
    };
    const secondRuntime: PlatformObservabilityRuntime = {
      sink: secondStore,
      store: secondStore,
      config: { console: false, store: secondStore },
    };

    const first = emitPlatformCodeTo(
      firstRuntime,
      OBS_CODES.APP_CLIENT_BUNDLE_READY,
    );
    const sibling = emitPlatformCodeTo(
      secondRuntime,
      OBS_CODES.APP_CLIENT_BUNDLE_READY,
    );
    const second = emitPlatformCodeTo(
      firstRuntime,
      OBS_CODES.APP_SHUTDOWN_SIGNAL,
    );

    expect([first.sequence, second.sequence]).toEqual([1, 2]);
    expect(sibling.sequence).toBe(1);
    expect(firstStore.query().events.map((event) => event.id)).toEqual([
      'obs_1', 'obs_2',
    ]);
    expect(secondStore.query().events.map((event) => event.id)).toEqual([
      'obs_1',
    ]);
  });

  it('retains numeric AI usage while protecting canonical fields and credential metadata', () => {
    const store = new MemoryEventStore();
    configureObservability({ console: false, store });

    emitAIRequestCompleted({
      providerId: 'openai',
      providerType: 'openai',
      model: 'openai/gpt-4o-mini',
      inputTokens: 12,
      outputTokens: 4,
      totalTokens: 16,
      metadata: {
        providerId: 'spoofed-provider',
        inputTokens: 'not-a-count',
        apiToken: 'must-not-be-recorded',
        correlationId: 'corr_123',
        rawPrompt: 'another private prompt',
        nested: {
          requestId: 'req_123',
          messages: [{ role: 'user', content: 'private patient content' }],
          toolArguments: { patientId: 'private-patient-id' },
          requestBody: { note: 'private request body' },
          safe: 'retained',
        },
      },
    });

    const [event] = store.query({ code: OBS_CODES.AI_REQUEST_COMPLETED.code }).events;
    expect(event.metadata).toMatchObject({
      providerId: 'openai',
      inputTokens: 12,
      outputTokens: 4,
      totalTokens: 16,
      apiToken: '[redacted]',
      correlationId: 'corr_123',
      rawPrompt: '[redacted]',
      nested: {
        requestId: 'req_123',
        messages: '[redacted]',
        toolArguments: '[redacted]',
        requestBody: '[redacted]',
        safe: 'retained',
      },
    });
    expect(JSON.stringify(event.metadata)).not.toContain('private patient content');
    expect(JSON.stringify(event.metadata)).not.toContain('private-patient-id');
    expect(JSON.stringify(event.metadata)).not.toContain('private request body');
  });

  it('bounds cyclic and oversized AI metadata without losing safe correlation fields', () => {
    const store = new MemoryEventStore();
    configureObservability({ console: false, store });
    const cyclic: Record<string, unknown> = { trace: 'trace_123' };
    cyclic.self = cyclic;

    emitAIRequestCompleted({
      metadata: {
        cyclic,
        longValue: 'x'.repeat(2_000),
        many: Array.from({ length: 30 }, (_, index) => index),
      },
    });

    const [event] = store.query({ code: OBS_CODES.AI_REQUEST_COMPLETED.code }).events;
    expect(event.metadata?.cyclic).toEqual({ trace: 'trace_123', self: '[circular]' });
    expect(String(event.metadata?.longValue).length).toBeLessThan(600);
    expect(event.metadata?.many).toHaveLength(21);
  });

  it('omits unavailable canonical AI fields instead of reporting them as redacted values', () => {
    const store = new MemoryEventStore();
    configureObservability({ console: false, store });

    emitAIRequestCompleted({ providerId: 'openai', capability: 'text' });

    const [event] = store.query({ code: OBS_CODES.AI_REQUEST_COMPLETED.code }).events;
    expect(event.metadata).toEqual({ providerId: 'openai', capability: 'text' });
    expect(event.metadata).not.toHaveProperty('inputTokens');
    expect(event.metadata).not.toHaveProperty('durationMs');
  });
});
