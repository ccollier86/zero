/** Author metadata is SYSTEM identity-adjacent state, isolated by the same live app/org scope as Guardian. */
import type { Elysia } from 'elysia';
import type { ReactiveDB } from '../../sync/reactive-db';
import type { ZeroAppRuntime } from '../../runtime/zero-app-runtime';
import type { ResolvedConfig } from './types';
import type { AuthMiddlewareAuthorizationOptions } from '../../auth/auth.middleware';
import {
  ZERO_AUTH_STORE,
  ZERO_AUTH_TOKEN_SERVICE,
  ZERO_AUTH_TENANCY_SERVICE,
  ZERO_DATABASE_MANAGER,
  ZERO_AUTH_AUDIT_SERVICE,
} from '../../runtime/service-keys';
import { ZERO_GUARDIAN_AVATARS } from '../../auth/auth-user-avatar-service';
import { BlogService, ZERO_BLOG } from '../../blog/service';
import { createBlogPlugin } from '../../blog/plugin';
import { inspectBlogSchema } from '../../blog/schema';
export async function mountManagedBlog({
  app,
  runtime,
  systemDB,
  config,
  authorization,
  startAuth,
}: {
  app: Elysia;
  runtime: ZeroAppRuntime;
  systemDB: ReactiveDB;
  config: ResolvedConfig;
  authorization: AuthMiddlewareAuthorizationOptions;
  startAuth(): Promise<void>;
}): Promise<void> {
  if (config.auth === false) return;
  if (
    !config.blog.enabled &&
    (inspectBlogSchema(systemDB) !== 'ready' ||
      !systemDB
        .prepare('SELECT singleton FROM _blog_policy WHERE singleton=1')
        .get())
  )
    return;
  await startAuth();
  const users = runtime.require(ZERO_AUTH_STORE);
  const service = new BlogService({
    db: systemDB,
    users,
    tenancy: runtime.get(ZERO_AUTH_TENANCY_SERVICE),
    audit: runtime.require(ZERO_AUTH_AUDIT_SERVICE),
    config: config.blog,
    installAllowed:
      config.migrate ||
      runtime.require(ZERO_DATABASE_MANAGER).systemRuntime.sqlite.mode ===
        'ephemeral',
    publicAvatar: (userId) =>
      runtime.get(ZERO_GUARDIAN_AVATARS)?.publicDescriptorFor(userId) ?? null,
  });
  service.initialize();
  runtime.addCleanup(() => {
    service.close();
    runtime.clear(ZERO_BLOG, service);
  });
  if (!config.blog.enabled) return;
  runtime.set(ZERO_BLOG, service);
  app.use(
    createBlogPlugin({
      getService: () => runtime.get(ZERO_BLOG) ?? null,
      getTokenService: () => runtime.get(ZERO_AUTH_TOKEN_SERVICE),
      authorization,
    }),
  );
}
