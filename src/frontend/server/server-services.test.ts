/**
 * server-services.test.ts
 *
 * Verifies the app-facing backend `zero` service context. Route factory tests
 * prove Elysia integration; this file keeps canonical names and compatibility
 * aliases covered without mounting route plugins.
 */

import { describe, expect, test } from 'bun:test';

import { getAuthStore, getTokenService } from '../../auth/auth.plugin';
import { getEmailRuntime, getEmailService } from '../../email';
import {
  MemoryEventStore,
  configureObservability,
  getObservabilityRuntime,
  getPlatformEventStore,
  getPlatformSink,
} from '../../observability';
import { getAI } from '../../ai';
import { getKvService } from '../../kv';
import { getVectorStore } from '../../vector';
import { getResourceRegistry } from '../../resources';
import { getPlatformTokenService } from '../../tokens';
import { getPlatformSQLiteService } from '../../persistence';
import { createLazyServerRouteServices, getServerRouteServices } from './server-services';

describe('server service context', () => {
  test('exposes canonical names and compatibility aliases lazily', () => {
    const store = new MemoryEventStore({ maxEvents: 5 });
    configureObservability({ console: false, store });

    const zero = createLazyServerRouteServices();

    expect(zero.auth.store).toBe(getAuthStore());
    expect(zero.auth.userStore).toBe(zero.auth.store);
    expect(zero.auth.tokens).toBe(getTokenService());
    expect(zero.auth.tokenService).toBe(zero.auth.tokens);
    expect(zero.auth.getStore()).toBe(zero.auth.store);
    expect(zero.auth.getUserStore()).toBe(zero.auth.userStore);
    expect(zero.auth.getTokenService()).toBe(zero.auth.tokenService);
    expect(zero.tokens).toBe(getPlatformTokenService());
    expect(zero.sql).toBe(getPlatformSQLiteService());
    expect(zero.sqlite).toBe(zero.sql);
    expect(zero.kv).toBe(getKvService());
    expect(zero.counter).toBe(getKvService()?.counters ?? null);
    expect(zero.limiter).toBe(getKvService()?.limiter ?? null);

    expect(zero.ai).toBe(getAI());
    expect(zero.vector).toBe(getVectorStore());
    expect(zero.vectors).toBe(zero.vector);
    expect(zero.resources).toBe(getResourceRegistry());
    expect(zero.email).toBe(getEmailService());
    expect(zero.emailRuntime).toBe(getEmailRuntime());

    expect(zero.observability.runtime).toBe(getObservabilityRuntime());
    expect(zero.observability.sink).toBe(getPlatformSink());
    expect(zero.observability.store).toBe(getPlatformEventStore());
    expect(zero.observability.getRuntime()).toBe(zero.observability.runtime);
    expect(zero.observability.getSink()).toBe(zero.observability.sink);
    expect(zero.observability.getStore()).toBe(zero.observability.store);
  });

  test('returns a fresh service object with equivalent lazy bindings', () => {
    const first = getServerRouteServices();
    const second = getServerRouteServices();

    expect(first).not.toBe(second);
    expect(first.auth.getTokenService).toBe(second.auth.getTokenService);
    expect(first.observability.emitCode).toBe(second.observability.emitCode);
  });
});
