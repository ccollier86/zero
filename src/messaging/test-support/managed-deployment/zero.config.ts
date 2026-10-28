/** Disposable installed Linux proof only. No production data, providers or app are used. */
import { join } from 'node:path';
import { defineZeroConfig } from '@zero/framework/server';
const root = process.cwd();
export default defineZeroConfig({ projectRoot: root, tables: {},
  db: { mode: 'file', path: join(root, 'state/application.db'), synchronous: 'FULL' },
  systemDb: { mode: 'file', path: join(root, 'state/system.db'), synchronous: 'FULL' },
  auth: { bootstrap: 'public', registration: { mode: 'public' }, accountEmails: { passwordReset: false } },
  messaging: { rootDirectory: join(root, 'state/messaging'), support: {}, assistant: { model: 'synthetic/chat', timeoutMs: 30000 }, jobs: { concurrency: 'max' },
    actors: { launch: { kind: 'source', entrypoint: join(root, 'server/messaging-actor.ts') }, env: {} } },
  logging: { preset: 'compliance', rootDirectory: join(root, 'state/logging'),
    actors: { launch: { kind: 'source', entrypoint: join(root, 'server/logging-actor.ts') }, env: {} } },
  ai: { autoDetect: false, providers: { synthetic: { type: 'openai-compatible', apiKey: 'synthetic-only', baseURL: 'http://127.0.0.1:4120/v1' } } },
  workflows: {}, email: false, vector: false, kv: false, pdf: false, migrate: true,
  appDir: join(root, 'app'), outDir: join(root, 'public-build'), generatedDir: join(root, 'generated'), storageDir: join(root, 'state/storage'),
  themeFoundation: 'legacy', observability: { console: false }, serverPluginsDir: false, serverMiddlewareDir: false, serverResourcesDir: false,
  serverEndpointsDir: false, serverRoutesDir: false, resourceRoutes: false,
});
