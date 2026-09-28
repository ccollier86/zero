import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';

import { createReactiveDB } from '../sync/reactive-db';
import type { AuthRuntime } from './auth-runtime';
import { createAuthPlugin } from './auth.plugin';

describe('standalone auth startup readiness', () => {
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
    let runtime!: AuthRuntime;
    const app = new Elysia().use(createAuthPlugin({
      db,
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
      db.dispose();
    }
  });
});
