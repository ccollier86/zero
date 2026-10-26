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
  ZERO_DATABASE_COMMIT_AUTHORITY,
  ZERO_OBSERVABILITY_RUNTIME,
  ZERO_LOGGING_RUNTIME,
  ZERO_STORAGE_SERVICE,
} from '../../runtime/service-keys';
import { ZERO_GUARDIAN_AVATARS } from '../../auth/auth-user-avatar-service';
import { BlogService, ZERO_BLOG } from '../../blog/service';
import { createBlogPlugin } from '../../blog/plugin';
import { inspectBlogSchema } from '../../blog/schema';
import { BlogContentRuntime } from '../../blog/content-runtime';
import { BlogContentService } from '../../blog/content-service';
import { installBlogContentLogging } from '../../blog/content-logging';
import { createBlogContentPlugin } from '../../blog/content-plugin';
import { withReactiveDBCommitAdmission } from '../../sync/reactive-db-commit-admission';
import { installBlogContentOwnerSchema } from '../../blog/content-owner-schema';
import { BlogMediaService } from '../../blog/media-service';
import { emitPlatformCodeTo } from '../../observability/sink';
import { OBS_CODES } from '../../observability/codes';
import { BlogMetricsService } from '../../blog/metrics-service';
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
  await withReactiveDBCommitAdmission(systemDB, () => service.initialize());
  runtime.addCleanup(() => {
    service.close();
    runtime.clear(ZERO_BLOG, service);
  });
  if (!config.blog.enabled) return;
  const installAllowed = config.migrate || runtime.require(ZERO_DATABASE_MANAGER).systemRuntime.sqlite.mode === 'ephemeral';
  if (config.blogContent && inspectBlogSchema(systemDB) === 'ready' && (installAllowed || installBlogContentOwnerSchema(systemDB, false))) {
    const authority = runtime.require(ZERO_DATABASE_COMMIT_AUTHORITY), logging = runtime.get(ZERO_LOGGING_RUNTIME);
    const content = await BlogContentRuntime.open({ config: config.blogContent, system: systemDB, authority,
      observability: runtime.require(ZERO_OBSERVABILITY_RUNTIME),
      installAllowed,
      ...(logging ? { source: coordinator => installBlogContentLogging(logging, coordinator, authority.coordinator) } : {}),
    });
    runtime.addCleanup(() => content.close());
    const media = new BlogMediaService({ db: systemDB, content, storage: runtime.require(ZERO_STORAGE_SERVICE), config: config.blogContent, installAllowed,
      cleanupFailed: () => { try { emitPlatformCodeTo(runtime.require(ZERO_OBSERVABILITY_RUNTIME), OBS_CODES.BLOG_MEDIA_CLEANUP_RETRY); } catch { /* A diagnostic cannot change accepted media outcomes. */ } } });
    runtime.addCleanup(() => media.close());
    await media.initialize();
    const metrics = new BlogMetricsService(systemDB, content, config.blogContent.metrics, installAllowed);
    await metrics.initialize();
    service.attachContent(new BlogContentService(content, service, config.blog, logging ?? undefined, media, metrics));
  }
  runtime.set(ZERO_BLOG, service);
  app.use(
    createBlogPlugin({
      getService: () => runtime.get(ZERO_BLOG) ?? null,
      getTokenService: () => runtime.get(ZERO_AUTH_TOKEN_SERVICE),
      authorization,
      getLoggingRuntime: () => runtime.get(ZERO_LOGGING_RUNTIME),
    }),
  );
  app.use(createBlogContentPlugin({ getService: () => runtime.get(ZERO_BLOG) ?? null,
    getTokenService: () => runtime.get(ZERO_AUTH_TOKEN_SERVICE), authorization,
    getLoggingRuntime: () => runtime.get(ZERO_LOGGING_RUNTIME) }));
}
