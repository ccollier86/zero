/** Opt-in messaging lifecycle and route composition. Resolves fixed private workers after Guardian/logging and never boots a second app. */
import type { Elysia } from 'elysia';
import type { ReactiveDB } from '../../sync/reactive-db';
import type { ZeroAppRuntime } from '../../runtime/zero-app-runtime';
import type { ResolvedConfig } from './types';
import type { AuthMiddlewareAuthorizationOptions } from '../../auth/auth.middleware';
import { ZERO_AUTH_STORE, ZERO_AUTH_TOKEN_SERVICE, ZERO_AUTH_TENANCY_SERVICE, ZERO_DATABASE_COMMIT_AUTHORITY, ZERO_DATABASE_MANAGER, ZERO_OBSERVABILITY_RUNTIME, ZERO_LOGGING_RUNTIME } from '../../runtime/service-keys';
import { ZERO_GUARDIAN_AVATARS } from '../../auth/auth-user-avatar-service';
import { MessagingRuntime } from '../../messaging/runtime';
import { ManagedMessagingDirectory } from '../../messaging/directory';
import { installMessagingLogging } from '../../messaging/logging-source';
import { MessagingService, ZERO_MESSAGING } from '../../messaging/service';
import { createMessagingPlugin } from '../../messaging/plugin';
export async function mountManagedMessaging(input: { app: Elysia; runtime: ZeroAppRuntime; systemDB: ReactiveDB; config: ResolvedConfig; authorization: AuthMiddlewareAuthorizationOptions; startAuth(): Promise<void> }): Promise<void> {
  const { app, runtime, systemDB, config, authorization } = input;
  if (!config.messaging || config.auth === false) return;
  await input.startAuth();
  const authority = runtime.require(ZERO_DATABASE_COMMIT_AUTHORITY), logging = runtime.get(ZERO_LOGGING_RUNTIME), installAllowed = config.migrate || runtime.require(ZERO_DATABASE_MANAGER).systemRuntime.sqlite.mode === 'ephemeral';
  const content = await MessagingRuntime.open({ config: config.messaging, system: systemDB, installAllowed, authority, observability: runtime.require(ZERO_OBSERVABILITY_RUNTIME),
    ...(logging ? { source: coordinator => installMessagingLogging(logging, coordinator, authority.coordinator) } : {}) });
  runtime.addCleanup(() => content.close());
  const directory = new ManagedMessagingDirectory({ db: systemDB, users: runtime.require(ZERO_AUTH_STORE), tenancy: runtime.get(ZERO_AUTH_TENANCY_SERVICE) ?? null,
    publicAvatar: id => runtime.get(ZERO_GUARDIAN_AVATARS)?.publicDescriptorFor(id)?.deliveryPath ?? null });
  const service = new MessagingService({ runtime: content, config: config.messaging, directory, ...(logging ? { logging } : {}) });
  runtime.set(ZERO_MESSAGING, service); runtime.addCleanup(() => { runtime.clear(ZERO_MESSAGING, service); });
  app.use(createMessagingPlugin({ getService: () => runtime.get(ZERO_MESSAGING) ?? null, getTokenService: () => runtime.get(ZERO_AUTH_TOKEN_SERVICE) ?? null, authorization, getLoggingRuntime: () => runtime.get(ZERO_LOGGING_RUNTIME) ?? null }));
}
