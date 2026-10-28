/** Opt-in messaging lifecycle and route composition. Resolves fixed private workers after Guardian/logging and never boots a second app. */
import type { Elysia } from 'elysia';
import type { ReactiveDB } from '../../sync/reactive-db';
import type { ZeroAppRuntime } from '../../runtime/zero-app-runtime';
import type { ResolvedConfig } from './types';
import type { AuthMiddlewareAuthorizationOptions } from '../../auth/auth.middleware';
import { ZERO_AUTH_STORE, ZERO_AUTH_TOKEN_SERVICE, ZERO_AUTH_TENANCY_SERVICE, ZERO_DATABASE_COMMIT_AUTHORITY, ZERO_DATABASE_MANAGER, ZERO_OBSERVABILITY_RUNTIME, ZERO_LOGGING_RUNTIME, ZERO_STORAGE_SERVICE, ZERO_AI_SERVICE, ZERO_SYNC_PRIVATE_MEMBERSHIP_CHANGED, ZERO_NOTIFICATION_SERVICE, ZERO_AUTHORIZATION_KERNEL, ZERO_AUTHORIZATION_ROLE_SERVICE } from '../../runtime/service-keys';
import { ZERO_GUARDIAN_AVATARS } from '../../auth/auth-user-avatar-service';
import { MessagingRuntime } from '../../messaging/runtime';
import { ManagedMessagingDirectory } from '../../messaging/directory';
import { installMessagingLogging } from '../../messaging/logging-source';
import { MessagingService, ZERO_MESSAGING } from '../../messaging/service';
import { createMessagingPlugin } from '../../messaging/plugin';
import { MessagingAttachmentService } from '../../messaging/attachment-service';
import { MessagingJobs, ZERO_MESSAGING_JOBS } from '../../messaging/jobs';
import { emitPlatformCodeTo } from '../../observability/sink';
import { OBS_CODES } from '../../observability/codes';
import { createMessagingRecipientPolicy, createMessagingAccessPolicy } from '../../messaging/recipient-policy';
import { assertNotificationEffectSchema } from '../../notifications/notification-effect-schema';
import { ManagedMessagingGroups } from '../../messaging/groups';
import { createMessagingVisitorRoutes } from '../../messaging/visitor-routes';
import { ZERO_SYNC_EPHEMERAL_CHANNEL } from '../../runtime/service-keys';
export async function mountManagedMessaging(input: { app: Elysia; runtime: ZeroAppRuntime; systemDB: ReactiveDB; config: ResolvedConfig; authorization: AuthMiddlewareAuthorizationOptions; startAuth(): Promise<void> }): Promise<void> {
  const { app, runtime, systemDB, config, authorization } = input;
  if (!config.messaging || config.auth === false) return;
  await input.startAuth();
  if (config.messaging.notifications) assertNotificationEffectSchema(systemDB);
  const authority = runtime.require(ZERO_DATABASE_COMMIT_AUTHORITY), logging = runtime.get(ZERO_LOGGING_RUNTIME), installAllowed = config.migrate || runtime.require(ZERO_DATABASE_MANAGER).systemRuntime.sqlite.mode === 'ephemeral';
  const content = await MessagingRuntime.open({ config: config.messaging, system: systemDB, installAllowed, authority, observability: runtime.require(ZERO_OBSERVABILITY_RUNTIME),
    onMembershipChanged: () => runtime.get(ZERO_SYNC_PRIVATE_MEMBERSHIP_CHANGED)?.(),
    ...(logging ? { source: coordinator => installMessagingLogging(logging, coordinator, authority.coordinator) } : {}) });
  runtime.addCleanup(() => content.close());
  const attachments = new MessagingAttachmentService({ db: systemDB, runtime: content, storage: runtime.require(ZERO_STORAGE_SERVICE), config: config.messaging, installAllowed,
    cleanupFailed: () => { try { emitPlatformCodeTo(runtime.require(ZERO_OBSERVABILITY_RUNTIME), OBS_CODES.MESSAGING_ATTACHMENT_CLEANUP_RETRY); } catch { /* Recovery evidence cannot change an accepted operation. */ } } });
  runtime.addCleanup(() => attachments.close()); await attachments.initialize();
  const accessPolicy = createMessagingAccessPolicy({ users: runtime.require(ZERO_AUTH_STORE), tenancy: runtime.get(ZERO_AUTH_TENANCY_SERVICE) ?? null,
    kernel: runtime.require(ZERO_AUTHORIZATION_KERNEL), roles: runtime.get(ZERO_AUTHORIZATION_ROLE_SERVICE) ?? null,
    assertCurrent: () => runtime.require(ZERO_AUTH_TOKEN_SERVICE).assertCurrentProfile() });
  const directory = new ManagedMessagingDirectory({ db: systemDB, users: runtime.require(ZERO_AUTH_STORE), tenancy: runtime.get(ZERO_AUTH_TENANCY_SERVICE) ?? null,
    assistantRecipient: (scope, userId, id) => Boolean(config.messaging && config.messaging.assistants[id] && accessPolicy(scope, userId, config.messaging.assistants[id].access)),
    groupRecipient: (scope, userId, id) => Boolean(config.messaging && config.messaging.groups[id] && accessPolicy(scope, userId, config.messaging.groups[id].members)),
    supportEntryRecipient: (scope, userId, id) => Boolean(config.messaging && config.messaging.supportEntries[id] && config.messaging.supportEntries[id].tenantId === scope.tenantId && accessPolicy(scope, userId, config.messaging.supportEntries[id].staff)),
    supportRecipient: createMessagingRecipientPolicy({ users: runtime.require(ZERO_AUTH_STORE), tenancy: runtime.get(ZERO_AUTH_TENANCY_SERVICE) ?? null,
      kernel: runtime.require(ZERO_AUTHORIZATION_KERNEL), roles: runtime.get(ZERO_AUTHORIZATION_ROLE_SERVICE) ?? null, support: config.messaging.support,
      assertCurrent: () => runtime.require(ZERO_AUTH_TOKEN_SERVICE).assertCurrentProfile() }),
    publicAvatar: id => runtime.get(ZERO_GUARDIAN_AVATARS)?.publicDescriptorFor(id)?.deliveryPath ?? null });
  const groups = new ManagedMessagingGroups({ system: systemDB, runtime: content, directory, config: config.messaging, ...(logging ? { logging } : {}),
    failed: () => { try { emitPlatformCodeTo(runtime.require(ZERO_OBSERVABILITY_RUNTIME), OBS_CODES.MESSAGING_OPERATION_REJECTED,
      { metadata: { operation: 'messaging.group.reconcile', failureCode: 'MESSAGING_GROUP_RECONCILIATION_REQUIRED' } }); } catch { /* No property values or identities in failure diagnostics. */ } } });
  runtime.addCleanup(() => groups.close());
  const jobs = config.workflows !== false ? new MessagingJobs({ system: systemDB, runtime: content, config: config.messaging, directory,
    ai: runtime.get(ZERO_AI_SERVICE) ?? null, logging: logging ?? null, notifications: config.messaging.notifications ? runtime.require(ZERO_NOTIFICATION_SERVICE) : runtime.get(ZERO_NOTIFICATION_SERVICE) ?? null,
    dispatchFailed: () => { try { emitPlatformCodeTo(runtime.require(ZERO_OBSERVABILITY_RUNTIME), OBS_CODES.MESSAGING_JOB_DISPATCH_RETRY); } catch { /* Durable work retains its original identity. */ } } }) : null;
  if (jobs) { runtime.set(ZERO_MESSAGING_JOBS, jobs); runtime.addCleanup(async () => { runtime.clear(ZERO_MESSAGING_JOBS, jobs); await jobs.close(); }); }
  const service = new MessagingService({ runtime: content, config: config.messaging, directory, attachments, groups, getEphemeral: () => runtime.get(ZERO_SYNC_EPHEMERAL_CHANNEL) ?? null, ...(logging ? { logging } : {}), ...(jobs ? { jobs } : {}) });
  runtime.set(ZERO_MESSAGING, service); runtime.addCleanup(() => { runtime.clear(ZERO_MESSAGING, service); });
  app.use(createMessagingVisitorRoutes(() => runtime.get(ZERO_MESSAGING) ?? null));
  app.use(createMessagingPlugin({ getService: () => runtime.get(ZERO_MESSAGING) ?? null, getTokenService: () => runtime.get(ZERO_AUTH_TOKEN_SERVICE) ?? null, authorization, getLoggingRuntime: () => runtime.get(ZERO_LOGGING_RUNTIME) ?? null }));
}
