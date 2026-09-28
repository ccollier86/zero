import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';

import { createPresignedToken } from '../../storage/presigned';
import { createApp } from './app-factory';

describe('managed app storage signing config', () => {
  test('passes the high-level signing secret into the mounted storage plugin', async () => {
    const baseDir = join(process.cwd(), '.zero');
    await mkdir(baseDir, { recursive: true });
    const root = await mkdtemp(join(baseDir, 'test-storage-signing-'));
    await mkdir(join(root, 'app'), { recursive: true });
    const signingSecret = 'managed-storage-signing-secret-with-32-bytes';
    let app: Awaited<ReturnType<typeof createApp>> | null = null;
    try {
      app = await createApp({
        db: { mode: 'memory' },
        tables: {},
        auth: { bootstrap: 'public' },
        storage: { signingSecret, defaultPresignedTTL: 900 },
        storageDir: join(root, 'storage'),
        appDir: join(root, 'app'),
        outDir: join(root, 'out'),
        migrate: false,
        serverResourcesDir: false,
        serverPluginsDir: false,
        serverMiddlewareDir: false,
        serverEndpointsDir: false,
        serverRoutesDir: false,
        resourceRoutes: false,
        observability: false,
        email: false,
        ai: false,
        vector: false,
        pdf: false,
        kv: false,
      });
      app.listen(0);
      const token = await createPresignedToken({
        driveId: 'missing-drive',
        path: '/missing.txt',
        method: 'download',
        expiresIn: 60,
        secret: signingSecret,
      });
      const response = await fetch(
        `http://localhost:${app.server!.port}/storage/presigned/${token}`,
      );

      // A valid capability reaches the storage lookup. A wiring regression
      // would reject the signature first with 403.
      expect(response.status).toBe(404);
    } finally {
      await app?.stop();
      await rm(root, { recursive: true, force: true });
    }
  }, 60_000);
});
