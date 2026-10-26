/** Synthetic installed-package proof only. This fixture must never target a consuming app's files. */
import { join } from 'node:path';
import { defineZeroConfig } from '@zero/framework/server';

const root = process.cwd();
export default defineZeroConfig({
  projectRoot: root,
  app: { name: 'Installed journal', publicUrl: 'https://journal.example.test' },
  db: { mode: 'file', path: join(root, 'state/application.db'), synchronous: 'FULL' },
  systemDb: { mode: 'file', path: join(root, 'state/system.db'), synchronous: 'FULL' },
  tables: {}, auth: { bootstrap: 'public' },
  blog: { authors: { requireAvatar: false }, content: { rootDirectory: join(root, 'state/blog'), metrics: { enabled: true } } },
  logging: { preset: 'compliance', rootDirectory: join(root, 'state/logging'),
    actors: { launch: { kind: 'source', entrypoint: join(root, 'server/logging-actor.ts') }, env: {} } },
  appDir: join(root, 'app'), outDir: join(root, 'public-build'), generatedDir: join(root, 'generated'), storageDir: join(root, 'state/storage'),
  seo: { indexing: true }, sitemap: true, themeFoundation: 'next',
  serverPluginsDir: false, serverMiddlewareDir: false, serverResourcesDir: false, serverEndpointsDir: false, serverRoutesDir: false,
  workflows: false, email: false, ai: false, vector: false, pdf: false, kv: false, stateSync: false,
  observability: { console: false, endpoint: false },
});
