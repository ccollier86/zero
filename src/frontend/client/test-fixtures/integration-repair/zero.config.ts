/** Synthetic package-consumer qualification only. Never point this fixture at application state. */
import { join } from 'node:path';
import { defineZeroConfig, defineEndpoint, defineRouter } from '@zero/framework/server';

const root = process.cwd();
export default defineZeroConfig({
  projectRoot: root,
  db: { mode: 'file', path: join(root, 'state/application.db'), synchronous: 'FULL' },
  systemDb: { mode: 'file', path: join(root, 'state/system.db'), synchronous: 'FULL' },
  tables: {},
  auth: { bootstrap: 'public', registration: { mode: 'public' }, accountEmails: { passwordReset: false },
    userProfile: { enabled: true, fields: { firstName: true, lastName: true, bio: true },
      avatars: { enabled: true, editable: true, shape: 'rounded', maxUploadBytes: 8 * 1024 * 1024,
        maxPixels: 16_000_000, outputSize: 512 } } },
  logging: { preset: 'compliance', rootDirectory: join(root, 'state/logging'),
    actors: { launch: { kind: 'source', entrypoint: join(root, 'server/logging-actor.ts') }, env: {} } },
  workflows: false, email: false, ai: false, vector: false, kv: false, pdf: false,
  loginPath: '/login', postLoginPath: '/workspace', publicPaths: ['/login'],
  appDir: join(root, 'app'), outDir: join(root, 'public-build'), generatedDir: join(root, 'generated'),
  storageDir: join(root, 'state/storage'), themeFoundation: 'next', migrate: true, observability: { console: false },
  serverPluginsDir: false, serverMiddlewareDir: false, serverResourcesDir: false, serverEndpointsDir: false,
  serverRoutesDir: false, resourceRoutes: false,
  serverExtensions: [defineRouter({ name: 'integration-repair-proof', prefix: '/proof',
    auth: { user: 'required', credentials: ['session'] }, routes: [
      defineEndpoint({ method: 'POST', path: '/diagnostics', handler: ({ zero }) => {
        zero.access.requirePlatformAdmin();
        for (const code of ['APP_TCM_TREATMENT_PLAN_WORKFLOW_REGISTERED', 'APP_BIOPSYCH_WORKFLOW_REGISTERED']) {
          zero.observability.emitEvent({ code, category: 'fixture', level: 'info', message: 'Synthetic diagnostic' });
        }
        return { emitted: 2 };
      } }),
    ] })],
});
