/**
 * server-services.test.ts
 *
 * Verifies the app-facing backend `zero` service context. Route factory tests
 * prove Elysia integration; this file keeps canonical names and compatibility
 * aliases covered without mounting route plugins.
 */

import { describe, expect, test } from 'bun:test';

import {
  getAuthorizationKernel,
  getAuthStore,
  getTokenService,
} from '../../auth/auth.plugin';
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
import { getPdfService } from '../../pdf';
import { createLazyServerRouteServices, getServerRouteServices } from './server-services';
import { ZeroAppRuntime } from '../../runtime/zero-app-runtime';
import {
  ZERO_EMAIL_RUNTIME,
  ZERO_OBSERVABILITY_RUNTIME,
  ZERO_RESOURCE_REGISTRY,
  ZERO_SQLITE_SERVICE,
  ZERO_SYNC_DB,
} from '../../runtime/service-keys';
import type { ReactiveDB } from '../../sync';
import type { PlatformSQLiteService } from '../../persistence';
import type { ResourceRegistry } from '../../resources';
import type { EmailRuntime } from '../../email';
import type { PlatformCodeDefinition } from '../../observability';

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
    expect(zero.auth.authorization).toBe(getAuthorizationKernel());
    expect(zero.auth.authorizationKernel).toBe(zero.auth.authorization);
    expect(zero.auth.getAuthorizationKernel()).toBe(zero.auth.authorization);
    expect(zero.tokens).toBe(getPlatformTokenService());
    expect(zero.sql).toBe(getPlatformSQLiteService());
    expect(zero.sqlite).toBe(zero.sql);
    expect(zero.kv).toBe(getKvService());
    expect(zero.counter).toBe(getKvService()?.counters ?? null);
    expect(zero.limiter).toBe(getKvService()?.limiter ?? null);

    expect(zero.ai).toBe(getAI());
    expect(zero.vector).toBe(getVectorStore());
    expect(zero.vectors).toBe(zero.vector);
    expect(zero.pdf).toBe(getPdfService());
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
    expect(first.auth.getTokenService()).toBe(second.auth.getTokenService());
    expect(first.observability.emitCode).toBe(second.observability.emitCode);
  });

  test('binds database, email, resources, and observability to one app runtime', () => {
    const firstRuntime = createTestRuntime('first');
    const secondRuntime = createTestRuntime('second');
    const first = createLazyServerRouteServices(firstRuntime.runtime);
    const second = createLazyServerRouteServices(secondRuntime.runtime);

    expect(first.db).toBe(firstRuntime.db);
    expect(second.db).toBe(secondRuntime.db);
    expect(first.sql).toBe(firstRuntime.sqlite);
    expect(second.sql).toBe(secondRuntime.sqlite);
    expect(first.resources).toBe(firstRuntime.resources);
    expect(second.resources).toBe(secondRuntime.resources);
    expect(first.emailRuntime).toBe(firstRuntime.email);
    expect(second.emailRuntime).toBe(secondRuntime.email);

    const code: PlatformCodeDefinition = {
      code: 'test.runtime_bound',
      prefix: 'ZERO_TEST_RUNTIME_BOUND',
      category: 'system',
      level: 'info',
      message: 'runtime-bound event',
    };
    first.observability.emitCode(code);

    expect(firstRuntime.store.query().events).toHaveLength(1);
    expect(secondRuntime.store.query().events).toHaveLength(0);
  });
});

function createTestRuntime(label: string) {
  const runtime = new ZeroAppRuntime(`server-services-${label}`);
  const db = { label } as unknown as ReactiveDB;
  const sqlite = { label } as unknown as PlatformSQLiteService;
  const resources = { label } as unknown as ResourceRegistry;
  const email = {
    enabled: false,
    app: { name: label },
    config: false,
    provider: { name: 'test', async send() { throw new Error('not used'); } },
    service: { async send() { throw new Error('not used'); } },
  } as EmailRuntime;
  const store = new MemoryEventStore({ maxEvents: 5 });

  runtime.set(ZERO_SYNC_DB, db);
  runtime.set(ZERO_SQLITE_SERVICE, sqlite);
  runtime.set(ZERO_RESOURCE_REGISTRY, resources);
  runtime.set(ZERO_EMAIL_RUNTIME, email);
  runtime.set(ZERO_OBSERVABILITY_RUNTIME, {
    config: { console: false, store },
    sink: store,
    store,
  });

  return { runtime, db, sqlite, resources, email, store };
}
