/** Disposable deployment qualification, not an application scaffold or production configuration. */
import { join } from 'node:path';
import { defineZeroConfig, defineEndpoint, defineRouter } from '@zero/framework/server';

const root = process.cwd();
export default defineZeroConfig({
  projectRoot: root,
  db: { mode: 'file', path: join(root, 'state/application.db'), synchronous: 'FULL' },
  systemDb: { mode: 'file', path: join(root, 'state/system.db'), synchronous: 'FULL' },
  tables: {}, auth: { bootstrap: 'public', registration: { mode: 'public' }, accountEmails: { passwordReset: false } },
  logging: { preset: 'compliance', rootDirectory: join(root, 'state/logging'),
    actors: { launch: { kind: 'source', entrypoint: join(root, 'server/logging-actor.ts') }, env: {} } },
  workflows: false, email: false, ai: false, vector: false, kv: false, pdf: false,
  appDir: join(root, 'app'), outDir: join(root, 'public-build'), generatedDir: join(root, 'generated'), storageDir: join(root, 'state/storage'),
  themeFoundation: 'legacy', migrate: true, observability: { console: false },
  serverPluginsDir: false, serverMiddlewareDir: false, serverResourcesDir: false, serverEndpointsDir: false,
  serverRoutesDir: false, resourceRoutes: false,
  serverExtensions: [defineRouter({ name: 'deployment-proof', prefix: '/proof', auth: { user: 'required', credentials: ['session'] }, routes: [
    defineEndpoint({ method: 'POST', path: '/record', handler: async ({ zero }) => {
      await zero.logging!.record({ id: 'deployment.original-stage', family: 'workflow', action: 'app.deployment.prepared',
        occurredAt: 1800000000000, outcome: 'succeeded', evidence: 'server-confirmed', target: { type: 'report', id: 'opaque-report' } });
      return { retained: true };
    } }),
  ] })],
});
