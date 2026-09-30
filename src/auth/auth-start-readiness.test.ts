import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';

import { createEmailRuntime } from '../email/runtime';
import { MemoryEventStore, OBS_CODES } from '../observability';
import type { PlatformEvent } from '../observability/types';
import { ZERO_OBSERVABILITY_RUNTIME } from '../runtime/service-keys';
import { ZeroAppRuntime } from '../runtime/zero-app-runtime';
import { createReactiveDB } from '../sync/reactive-db';
import { resolveAuthBehaviorConfig } from './auth-config';
import { AuthRuntime } from './auth-runtime';
import { createAuthPlugin } from './auth.plugin';

describe('standalone auth startup readiness', () => {
  test('reports a missing installed-profile guard through the auth invariant boundary', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    const events = new MemoryEventStore({ maxEvents: 20 });
    const appRuntime = new ZeroAppRuntime('auth-profile-guard-not-ready');
    appRuntime.set(ZERO_OBSERVABILITY_RUNTIME, {
      sink: events,
      store: events,
      config: { console: false },
    });
    const runtime = new AuthRuntime(
      { db, runtime: appRuntime },
      resolveAuthBehaviorConfig({ bootstrap: 'public' }),
      {
        runtime: appRuntime,
        getEmailRuntime: () => createEmailRuntime(false, {}),
        getPlatformTokenService: () => null,
      },
    );

    try {
      expect(() => runtime.assertCurrentProfile()).toThrow(expect.objectContaining({
        name: 'AuthError',
        code: 'AUTH_STATE_INVARIANT_FAILED',
        status: 500,
      }));
      expect(events.query({ code: OBS_CODES.AUTH_STATE_INVARIANT_FAILED.code }).events)
        .toContainEqual(expect.objectContaining({
          metadata: {
            component: 'auth-runtime',
            invariant: 'installed-profile-guard-ready',
          },
        }));
    } finally {
      await runtime.stop();
      db.dispose();
      await appRuntime.dispose();
    }
  });

  test('reports a malformed authority clock through the stable invariant boundary', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    db.exec('CREATE TABLE _auth_authority_revision (wrong_column TEXT)');
    const events = new MemoryEventStore({ maxEvents: 20 });
    const appRuntime = new ZeroAppRuntime('auth-malformed-authority-clock');
    appRuntime.set(ZERO_OBSERVABILITY_RUNTIME, {
      sink: events,
      store: events,
      config: { console: false },
    });
    const runtime = new AuthRuntime(
      { db, runtime: appRuntime },
      resolveAuthBehaviorConfig({ bootstrap: 'public' }),
      {
        runtime: appRuntime,
        getEmailRuntime: () => createEmailRuntime(false, {}),
        getPlatformTokenService: () => null,
      },
    );

    try {
      await expect(runtime.start()).rejects.toMatchObject({
        name: 'AuthError',
        code: 'AUTH_STATE_INVARIANT_FAILED',
        status: 500,
      });
    } finally {
      await runtime.stop();
      db.dispose();
      await appRuntime.dispose();
    }

    expect(events.query({ code: OBS_CODES.AUTH_STATE_INVARIANT_FAILED.code }).events)
      .toContainEqual(expect.objectContaining({
        metadata: {
          component: 'authority-revision',
          invariant: 'managed-trigger-contract',
        },
      }));
  });

  test('installs the profile guard before synchronous reconciliation observers run', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    const appRuntime = new ZeroAppRuntime('auth-reentrant-profile-observer');
    let runtime: AuthRuntime | null = null;
    let observedRegistryInitialization = false;
    let profileAssertionError: unknown;
    appRuntime.set(ZERO_OBSERVABILITY_RUNTIME, {
      sink: {
        emit(event: PlatformEvent) {
          if (event.code !== OBS_CODES.AUTH_AUTHORIZATION_REGISTRY_INITIALIZED.code) {
            return;
          }
          observedRegistryInitialization = true;
          try {
            runtime!.assertCurrentProfile();
          } catch (error) {
            profileAssertionError = error;
          }
        },
      },
      store: null,
      config: { console: false },
    });
    runtime = new AuthRuntime(
      { db, runtime: appRuntime },
      resolveAuthBehaviorConfig({ bootstrap: 'public' }),
      {
        runtime: appRuntime,
        getEmailRuntime: () => createEmailRuntime(false, {}),
        getPlatformTokenService: () => null,
      },
    );

    try {
      await runtime.start();
      expect(observedRegistryInitialization).toBeTrue();
      expect(profileAssertionError).toBeUndefined();
    } finally {
      await runtime.stop();
      db.dispose();
      await appRuntime.dispose();
    }
  });

  test('rejects async lazy runtime dependencies through the app-local invariant boundary', async () => {
    const events = new MemoryEventStore({ maxEvents: 20 });
    const appRuntime = new ZeroAppRuntime('auth-async-runtime-dependencies');
    appRuntime.set(ZERO_OBSERVABILITY_RUNTIME, {
      sink: events,
      store: events,
      config: { console: false },
    });
    const emailDb = createReactiveDB({ mode: 'memory' });
    const emailRuntime = new AuthRuntime(
      { db: emailDb, runtime: appRuntime },
      resolveAuthBehaviorConfig({ bootstrap: 'public' }),
      {
        runtime: appRuntime,
        getEmailRuntime: (async () => createEmailRuntime(false, {})) as never,
        getPlatformTokenService: () => null,
      },
    );

    try {
      expect(() => emailRuntime.getEmailRuntime()).toThrow(expect.objectContaining({
        code: 'AUTH_STATE_INVARIANT_FAILED',
        message: '[auth] Email runtime resolver must be synchronous.',
      }));
      await Promise.resolve();
    } finally {
      await emailRuntime.stop();
      emailDb.dispose();
    }

    const platformDb = createReactiveDB({ mode: 'memory' });
    const platformRuntime = new AuthRuntime(
      { db: platformDb, runtime: appRuntime },
      resolveAuthBehaviorConfig({ bootstrap: 'public' }),
      {
        runtime: appRuntime,
        getEmailRuntime: () => createEmailRuntime(false, {}),
        getPlatformTokenService: (async () => null) as never,
      },
    );
    try {
      await expect(platformRuntime.start()).rejects.toThrow(expect.objectContaining({
        code: 'AUTH_STATE_INVARIANT_FAILED',
        message: '[auth] Platform token service resolver must be synchronous.',
      }));
      await Promise.resolve();
    } finally {
      await platformRuntime.stop();
      platformDb.dispose();
      await appRuntime.dispose();
    }

    expect(events.query({ code: OBS_CODES.AUTH_STATE_INVARIANT_FAILED.code }).events
      .map((event) => event.metadata)).toEqual(expect.arrayContaining([
      {
        component: 'auth-runtime',
        invariant: 'email-runtime-resolver-async',
      },
      {
        component: 'auth-runtime',
        invariant: 'platform-token-service-resolver-async',
      },
    ]));
  });

  test('rejects an asynchronous runtime-created composition callback', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    try {
      expect(() => createAuthPlugin({
        db,
        bootstrap: 'public',
        onRuntimeCreated: (async () => {
          throw new Error('private composition rejection');
        }) as never,
      })).toThrow(expect.objectContaining({
        code: 'AUTH_STATE_INVARIANT_FAILED',
        message: '[auth] onRuntimeCreated callback must be synchronous.',
      }));
      await Promise.resolve();
    } finally {
      db.dispose();
    }
  });

  test('holds auth requests until asynchronous startup is complete', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    let runtime!: AuthRuntime;
    let releaseStart!: () => void;
    let startEntered!: () => void;
    const release = new Promise<void>((resolve) => { releaseStart = resolve; });
    const entered = new Promise<void>((resolve) => { startEntered = resolve; });
    const app = new Elysia().use(createAuthPlugin({
      db,
      bootstrap: 'public',
      onRuntimeCreated(created) {
        runtime = created;
        const originalStart = created.start.bind(created);
        created.start = async () => {
          startEntered();
          await release;
          await originalStart();
        };
      },
    })).listen(0);

    try {
      await entered;
      let settled = false;
      const response = fetch(`http://localhost:${app.server!.port}/auth/jwks`)
        .then((value) => {
          settled = true;
          return value;
        });
      await Bun.sleep(10);
      expect(settled).toBeFalse();

      releaseStart();
      expect((await response).status).toBe(200);
    } finally {
      releaseStart();
      await app.stop();
      await runtime.stop();
      db.dispose();
    }
  });

  test('contains a startup rejection and closes the standalone listener', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    const events = new MemoryEventStore({ maxEvents: 20 });
    const appRuntime = new ZeroAppRuntime('auth-start-failure');
    appRuntime.set(ZERO_OBSERVABILITY_RUNTIME, {
      sink: events,
      store: events,
      config: { console: false },
    });
    let runtime!: AuthRuntime;
    const app = new Elysia().use(createAuthPlugin({
      db,
      runtime: appRuntime,
      bootstrap: 'public',
      onRuntimeCreated(created) {
        runtime = created;
        created.start = async () => {
          throw new Error('forced standalone auth startup failure');
        };
      },
    })).listen(0);
    const url = `http://localhost:${app.server!.port}/auth/jwks`;

    try {
      await Bun.sleep(10);
      await expect(fetch(url)).rejects.toThrow();
    } finally {
      await app.stop();
      await runtime.stop();
      await appRuntime.dispose();
      db.dispose();
    }

    const failures = events.query({ code: OBS_CODES.AUTH_START_FAILED.code }).events;
    expect(failures).toHaveLength(1);
    expect(failures[0]?.metadata).toEqual({ plugin: 'auth' });
  });
});
