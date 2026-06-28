/**
 * Platform Frontend — SERVER-ONLY exports.
 *
 * These require bun:sqlite and must only be imported in server code
 * (app.ts entry point, server plugins, API routes).
 *
 * NEVER import from this file in client/browser code — it will crash the bundler.
 *
 * @example
 * // In app server entry (app.ts):
 * import { createApp } from '../src/frontend/server';
 * import { createSchedulerPlugin } from '../src/frontend/server';
 */

// ─── App Factory ────────────────────────────────────────────────────────
export { createApp } from './server/app-factory';
export type { App } from './server/app-factory';
export { resolveConfig } from './server/types';
export type {
  AppConfig,
  AppTableInput,
  AutoLazyAction,
  ResolvedConfig,
  ResolvedSyncDefaults,
  ResolvedTableSyncDefault,
  SyncDefaultsConfig,
  TableSyncDefaultConfig,
} from './server/types';

// ─── Platform Doctor ───────────────────────────────────────────────────
export { runPlatformDoctor } from '../doctor/platform-doctor';
export type {
  PlatformDoctorFinding,
  PlatformDoctorOptions,
  PlatformDoctorReport,
  PlatformDoctorSeverity,
} from '../doctor/platform-doctor';

// ─── Route Config ───────────────────────────────────────────────────────
export type { RouteConfig, LoaderContext, PageMeta } from './router/types';

// ─── Auth ───────────────────────────────────────────────────────────────
export { createAuthPlugin, getAuthStore, getTokenService } from '../auth/auth.plugin';
export { createAuthMiddleware } from '../auth/auth.middleware';
export { AccountEmailService } from '../auth/account-email-service';
export { AuthActionTokenService } from '../auth/action-token-service';
export { defineAuthConfig, resolveAuthBehaviorConfig } from '../auth/auth-config';
export { UserPropertyService } from '../auth/user-property-service';
export { AuthError, AUTH_DEFAULTS } from '../auth/types';
export type {
  AuthAccountEmailConfig,
  AuthActionTokenRecord,
  AuthActionTokenType,
  AuthBehaviorConfig,
  AuthContext,
  AuthPluginConfig,
  AuthRegistrationConfig,
  AuthRegistrationMode,
  ResolvedAuthAccountEmailConfig,
  ResolvedAuthBehaviorConfig,
  ResolvedUserPropertyFieldConfig,
  UserStatus,
  UserPropertyEditableBy,
  UserPropertyFieldConfig,
  UserPropertyFieldType,
  UserRecord,
} from '../auth/types';

// ─── Schema ─────────────────────────────────────────────────────────────
export { defineSchema, defineTable, schema, field } from '../schema';
export type {
  SchemaDescriptor,
  TableDefinition,
  SchemaConfig,
  Schema,
  FieldType,
  FieldMeta,
  FieldDef,
  InferSchemaType,
  InferSchemaInput,
  Register,
  TableNames,
  TableRow as InferTableRow,
} from '../schema';

// ─── Rooms: Server ──────────────────────────────────────────────────────
export { createRoomPlugin, getRoomService } from '../rooms';
export { PresenceService } from '../rooms';
export type { PresenceStatus, PresenceData } from '../rooms';
export { ROOM_TABLES } from '../rooms/types';

// ─── Notifications: Server ──────────────────────────────────────────────
export { createNotificationPlugin, getNotificationService } from '../notifications';
export type { NotificationPluginConfig } from '../notifications';
export { NOTIFICATION_TABLES } from '../notifications/types';

// ─── Scheduler ──────────────────────────────────────────────────────────
export { createSchedulerPlugin, getScheduler } from '../scheduler';
export type { JobDefinition, JobStatus, SchedulerPluginConfig } from '../scheduler';

// ─── Workflows: Server ──────────────────────────────────────────────────
export { createWorkflowPlugin, getWorkflowService, getWorkflowRegistry } from '../workflows';
export { WORKFLOW_TABLES } from '../workflows';
export type {
  WorkflowPluginConfig,
} from '../workflows';

// ─── Storage: Server ────────────────────────────────────────────────────
export { createStoragePlugin, getStorageService } from '../storage';
export { StorageService, StorageError, defineStorageTables, LocalStorageAdapter } from '../storage';
export { createPresignedToken, verifyPresignedToken, detectMimeType } from '../storage';
export { STORAGE_TABLES } from '../storage';
export type {
  StorageAdapter,
  StoragePluginConfig,
  DriveRecord,
  FileInfo,
  CreateDriveParams,
  UploadOptions,
  ListResult,
  DriveUsage,
  PermissionLevel,
  GrantPermissionParams,
} from '../storage';

// ─── Email: Server ──────────────────────────────────────────────────────
export {
  ConsoleEmailProvider,
  EmailError,
  EmailService,
  MemoryEmailProvider,
  NoopEmailProvider,
  ResendEmailProvider,
  configureEmail,
  getEmailRuntime,
  getEmailService,
} from '../email';
export type {
  AppIdentityConfig,
  BuiltInEmailProvider,
  EmailConfig,
  EmailMessage,
  EmailProvider,
  EmailRuntime,
  EmailSendResult,
  ResendEmailProviderConfig,
} from '../email';

// ─── Observability: Server ──────────────────────────────────────────────
export {
  CompositeSink,
  ConsoleSink,
  MemoryEventStore,
  OBS_CODES,
  configureObservability,
  createObservabilityPlugin,
  emitPlatformCode,
  emitPlatformEvent,
  errorPlatform,
  getObservabilityRuntime,
  getPlatformEventStore,
  getPlatformSink,
  logPlatformInfo,
  setPlatformSink,
  warnPlatform,
} from '../observability';
export type {
  ObservabilityConfig,
  ObservabilityEndpointAccess,
  ObservabilityEndpointConfig,
  ObservabilityEndpointReadMode,
  ObservabilityPluginConfig,
  ObservabilityTraceConfig,
  PlatformCodeDefinition,
  PlatformCodeEmitOptions,
  PlatformEvent,
  PlatformEventInput,
  PlatformEventLevel,
  PlatformEventPage,
  PlatformEventQuery,
  PlatformEventSource,
  PlatformEventStore,
  PlatformObservabilityRuntime,
  PlatformSink,
} from '../observability';
